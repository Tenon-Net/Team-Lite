//! Single-turn ACP execution: spawn → handshake → prompt → stream → close (B7 core).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, ProtocolVersion,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionNotification, SessionUpdate, TextContent,
};
use agent_client_protocol::{
    Agent, ByteStreams, Client, ConnectionTo, on_receive_notification, on_receive_request,
};
use tokio::io::AsyncReadExt;
use tokio::process::Command as TokioCommand;
use tokio::sync::watch;
use tokio::time::timeout;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::launch::LaunchConfig;
use crate::process::{ProcessTreeGuard, kill_process_tree, process_alive};
use crate::AgentError;

const TURN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
struct TurnState {
    session_id: Option<String>,
    output: String,
    updates: usize,
    stop_reason: Option<String>,
}

/// Inputs for one ACP turn (framework-agnostic; team maps ports → this).
#[derive(Debug, Clone)]
pub struct AcpTurnInput {
    pub backend: String,
    pub workspace: PathBuf,
    pub prompt: String,
}

/// Result of a completed (or failed/cancelled) ACP turn.
#[derive(Debug, Clone)]
pub struct AcpTurnResult {
    pub session_id: Option<String>,
    pub response_text: String,
    pub updates: usize,
    pub stop_reason: Option<String>,
    pub cancelled: bool,
}

/// Run one full turn. Watches `cancel_rx`; when `true`, aborts ASAP and kills the process.
pub async fn run_acp_turn(
    input: AcpTurnInput,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<AcpTurnResult, AgentError> {
    if *cancel_rx.borrow() {
        return Ok(AcpTurnResult {
            session_id: None,
            response_text: String::new(),
            updates: 0,
            stop_reason: Some("cancelled".into()),
            cancelled: true,
        });
    }

    let launch = LaunchConfig::for_backend(&input.backend).ok_or_else(|| {
        AgentError::bad_request(format!("unsupported ACP backend: {}", input.backend))
    })?;
    let cwd = input.workspace;
    let state = Arc::new(Mutex::new(TurnState::default()));

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

    let state_for_conn = Arc::clone(&state);
    let prompt = input.prompt.clone();
    let turn_fut = run_turn_connection(stdin, stdout, state_for_conn, cwd, prompt);

    let result = timeout(TURN_TIMEOUT, async {
        tokio::select! {
            biased;
            _ = cancel_rx.wait_for(|c| *c) => {
                Err(AgentError::internal("turn cancelled".to_owned()))
            }
            r = turn_fut => r,
        }
    })
    .await;

    kill_process_tree(&mut child).await;
    guard.disarm();
    for _ in 0..10 {
        if !process_alive(pid) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let stderr = stderr_task
        .await
        .unwrap_or_else(|e| format!("stderr join: {e}"));
    let cancelled = *cancel_rx.borrow();

    match result {
        Ok(Ok(())) => {
            let state = state.lock().expect("turn state");
            Ok(AcpTurnResult {
                session_id: state.session_id.clone(),
                response_text: state.output.clone(),
                updates: state.updates,
                stop_reason: state.stop_reason.clone(),
                cancelled: false,
            })
        }
        Ok(Err(e)) if cancelled || e.to_string().contains("cancelled") => {
            let state = state.lock().expect("turn state");
            Ok(AcpTurnResult {
                session_id: state.session_id.clone(),
                response_text: state.output.clone(),
                updates: state.updates,
                stop_reason: Some("cancelled".into()),
                cancelled: true,
            })
        }
        Ok(Err(e)) => {
            let detail = if stderr.trim().is_empty() {
                e.to_string()
            } else {
                format!("{e}; stderr: {stderr}")
            };
            Err(AgentError::internal(detail))
        }
        Err(_) => Err(AgentError::Timeout(format!(
            "ACP turn timed out after {}s; stderr={stderr}",
            TURN_TIMEOUT.as_secs()
        ))),
    }
}

async fn run_turn_connection(
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    state: Arc<Mutex<TurnState>>,
    cwd: PathBuf,
    prompt: String,
) -> Result<(), AgentError> {
    let transport = ByteStreams::new(stdin.compat_write(), stdout.compat());
    let notification_state = Arc::clone(&state);

    Client
        .builder()
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                let mut state = notification_state.lock().expect("turn state");
                state.updates += 1;
                if let SessionUpdate::AgentMessageChunk(chunk) = &notification.update
                    && let ContentBlock::Text(text) = &chunk.content
                {
                    state.output.push_str(&text.text);
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
            let _init = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            let session = connection
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?;
            {
                let mut state = state.lock().expect("turn state");
                state.session_id = Some(session.session_id.to_string());
            }

            let prompt_response = connection
                .send_request(PromptRequest::new(
                    session.session_id,
                    vec![ContentBlock::Text(TextContent::new(prompt))],
                ))
                .block_task()
                .await?;
            {
                let mut state = state.lock().expect("turn state");
                state.stop_reason = Some(format!("{:?}", prompt_response.stop_reason));
            }
            Ok(())
        })
        .await
        .map_err(|e| AgentError::internal(e.to_string()))
}

/// Helper for tests: run a turn without cancel channel.
pub async fn run_acp_turn_uncancellable(input: AcpTurnInput) -> Result<AcpTurnResult, AgentError> {
    let (_tx, rx) = watch::channel(false);
    run_acp_turn(input, rx).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::launch::LaunchConfig;

    #[tokio::test]
    async fn grok_turn_returns_text() {
        let launch = LaunchConfig::for_backend("grok").expect("grok");
        if !launch.executable.exists() {
            eprintln!("skip: grok missing");
            return;
        }
        let cwd = std::env::current_dir().unwrap();
        let result = run_acp_turn_uncancellable(AcpTurnInput {
            backend: "grok".into(),
            workspace: cwd,
            prompt: "Respond exactly with: B7 turn pass. Do not call tools.".into(),
        })
        .await
        .expect("turn");
        assert!(!result.cancelled);
        assert!(!result.session_id.as_deref().unwrap_or("").is_empty());
        assert!(
            result.response_text.to_lowercase().contains("b7")
                || result.response_text.to_lowercase().contains("pass")
                || !result.response_text.is_empty(),
            "unexpected response: {:?}",
            result.response_text
        );
    }
}
