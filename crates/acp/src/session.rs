//! ACP session open/close: spawn → initialize → session/new → shutdown.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::{
    InitializeRequest, NewSessionRequest, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionNotification, SessionUpdate,
};
use agent_client_protocol::{
    Agent, ByteStreams, Client, ConnectionTo, on_receive_notification, on_receive_request,
};
use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::launch::LaunchConfig;
use crate::process::{ProcessTreeGuard, kill_process_tree, process_alive};
use crate::AgentError;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
struct HandshakeState {
    initialize: Option<Value>,
    session_new: Option<Value>,
    session_id: Option<String>,
    updates: usize,
}

/// Result of a successful ACP handshake.
#[derive(Debug, Clone)]
pub struct SessionOpenResult {
    pub session_id: String,
    pub pid: u32,
    pub backend: String,
    pub auth_methods: Value,
    pub available_modes: Value,
}

/// Open an ACP session, capture `session_id`, then **cleanly kill** the process.
///
/// B6 keeps this short-lived: prove spawn + handshake + no residual process.
/// Long-lived connections for streaming turns land in B7.
pub async fn open_session_handshake(
    launch: &LaunchConfig,
    cwd: impl AsRef<Path>,
) -> Result<SessionOpenResult, AgentError> {
    let cwd = cwd.as_ref().to_path_buf();
    let state = Arc::new(Mutex::new(HandshakeState::default()));

    let mut command = TokioCommand::new(&launch.executable);
    command
        .args(&launch.args)
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| AgentError::internal(format!("spawn {}: {e}", launch.backend)))?;
    let pid = child
        .id()
        .ok_or_else(|| AgentError::internal("spawned process has no pid"))?;
    let mut guard = ProcessTreeGuard::new(Some(pid));

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AgentError::internal("missing stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AgentError::internal("missing stdout"))?;
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_end(&mut bytes).await;
        }
        String::from_utf8_lossy(&bytes).into_owned()
    });

    let state_for_connection = Arc::clone(&state);
    let cwd_for_connection = cwd.clone();
    let handshake = async {
        run_handshake(stdin, stdout, state_for_connection, cwd_for_connection).await
    };

    let result = timeout(HANDSHAKE_TIMEOUT, handshake).await;
    // Always tear down the process after handshake (success or fail).
    kill_process_tree(&mut child).await;
    guard.disarm();

    let stderr = stderr_task
        .await
        .unwrap_or_else(|e| format!("stderr join: {e}"));

    // Residual check: pid should be gone shortly after kill.
    for _ in 0..10 {
        if !process_alive(pid) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if process_alive(pid) {
        return Err(AgentError::internal(format!(
            "process {pid} still alive after kill; stderr={stderr}"
        )));
    }

    match result {
        Ok(Ok(())) => {
            let state = state.lock().expect("handshake state");
            let session_id = state
                .session_id
                .clone()
                .ok_or_else(|| AgentError::internal("session/new returned no session_id"))?;
            let (auth_methods, available_modes) = match (&state.initialize, &state.session_new) {
                (Some(init), Some(session)) => (
                    env_value(init, "authMethods"),
                    env_value(session, "modes"),
                ),
                _ => (Value::Null, Value::Null),
            };
            Ok(SessionOpenResult {
                session_id,
                pid,
                backend: launch.backend.clone(),
                auth_methods,
                available_modes,
            })
        }
        Ok(Err(e)) => {
            let detail = if stderr.trim().is_empty() {
                e
            } else {
                format!("{e}; stderr: {stderr}")
            };
            Err(AgentError::internal(detail))
        }
        Err(_) => Err(AgentError::Timeout(format!(
            "ACP handshake timed out after {}s; stderr={stderr}",
            HANDSHAKE_TIMEOUT.as_secs()
        ))),
    }
}

async fn run_handshake(
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    state: Arc<Mutex<HandshakeState>>,
    cwd: PathBuf,
) -> Result<(), String> {
    let transport = ByteStreams::new(stdin.compat_write(), stdout.compat());
    let notification_state = Arc::clone(&state);
    let permission_state = Arc::clone(&state);

    Client
        .builder()
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                let mut state = notification_state
                    .lock()
                    .expect("handshake state poisoned");
                state.updates += 1;
                let _ = notification;
                // Drain agent message chunks so the peer does not stall.
                if let SessionUpdate::AgentMessageChunk(_) = &notification.update {
                    // ignore text during handshake-only open
                }
                Ok(())
            },
            on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                let option_id = request
                    .options
                    .first()
                    .map(|option| option.option_id.clone());
                let _ = permission_state;
                let outcome = option_id.map_or(RequestPermissionOutcome::Cancelled, |option_id| {
                    RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option_id))
                });
                responder
                    .respond(RequestPermissionResponse::new(outcome))
                    .map_err(|error| {
                        agent_client_protocol::Error::internal_error().data(error.to_string())
                    })
            },
            on_receive_request!(),
        )
        .connect_with(transport, async move |connection: ConnectionTo<Agent>| {
            let init = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            {
                let mut state = state.lock().expect("handshake state");
                state.initialize = Some(serde_json::to_value(&init)?);
            }

            let session = connection
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?;
            {
                let mut state = state.lock().expect("handshake state");
                state.session_id = Some(session.session_id.to_string());
                state.session_new = Some(serde_json::to_value(&session)?);
            }
            Ok(())
        })
        .await
        .map_err(|error| error.to_string())
}

fn env_value(value: &Value, key: &str) -> Value {
    value
        .get(key)
        .cloned()
        .or_else(|| {
            // camelCase / snake_case
            let snake = {
                let mut out = String::new();
                for (i, ch) in key.chars().enumerate() {
                    if ch.is_uppercase() && i != 0 {
                        out.push('_');
                    }
                    out.extend(ch.to_lowercase());
                }
                out
            };
            value.get(&snake).cloned()
        })
        .unwrap_or(Value::Null)
}

