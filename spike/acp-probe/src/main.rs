use std::collections::BTreeMap;
use std::io::Write;
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
use serde::Serialize;
use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command as TokioCommand};
use tokio::time::timeout;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

const PROBE_TIMEOUT: Duration = Duration::from_secs(180);
const PROMPT: &str = "Respond exactly with: ACP probe pass. Do not call tools or modify files.";

#[derive(Clone, Serialize)]
struct LaunchSpec {
    agent: &'static str,
    executable: &'static str,
    args: Vec<&'static str>,
    underlying_cli: &'static str,
    permission_model: &'static str,
}

fn launch_specs() -> [LaunchSpec; 3] {
    [
        LaunchSpec {
            agent: "claude",
            executable: "C:/Program Files/nodejs/npx.cmd",
            args: vec!["-y", "@agentclientprotocol/claude-agent-acp@0.39.0"],
            underlying_cli: "C:/Users/Administrator/.local/bin/claude",
            permission_model: "ACP client selects the first advertised permission option; no Claude skip-permissions flag is added.",
        },
        LaunchSpec {
            agent: "codex",
            executable: "C:/Program Files/nodejs/npx.cmd",
            args: vec!["-y", "@zed-industries/codex-acp@0.14.0"],
            underlying_cli: "C:/Users/Administrator/AppData/Roaming/npm/codex",
            permission_model: "ACP client selects the first advertised permission option; no Codex provider variables are added.",
        },
        LaunchSpec {
            agent: "grok",
            executable: "C:/Users/Administrator/.grok/bin/grok",
            args: vec!["agent", "stdio"],
            underlying_cli: "C:/Users/Administrator/.grok/bin/grok",
            permission_model: "ACP client selects the first advertised permission option; Grok uses its inherited local login state.",
        },
    ]
}

#[derive(Default)]
struct LiveState {
    initialize: Option<Value>,
    session_new: Option<Value>,
    output: String,
    updates: usize,
    permission_requests: Vec<Value>,
    stop_reason: Option<Value>,
}

#[derive(Serialize)]
struct ProbeReport {
    agent: &'static str,
    status: &'static str,
    launch: LaunchSpec,
    prompt: &'static str,
    inherited_relevant_env: BTreeMap<String, bool>,
    auth_methods: Value,
    available_modes: Value,
    permission_model: &'static str,
    permission_requests: Vec<Value>,
    streamed_output: String,
    updates: usize,
    stop_reason: Value,
    failure_step: Option<&'static str>,
    error: Option<String>,
}

enum ConnectionExit {
    Client(Result<(), String>),
    Process(std::io::Result<std::process::ExitStatus>),
}

struct ProcessTreeGuard {
    pid: Option<u32>,
    armed: bool,
}

impl ProcessTreeGuard {
    fn new(pid: Option<u32>) -> Self {
        Self { pid, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        if self.armed {
            if let Some(pid) = self.pid {
                kill_process_tree_now(pid);
            }
        }
    }
}

fn relevant_env() -> BTreeMap<String, bool> {
    [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_AUTH_TOKEN",
        "AIONUI_PROVIDER_ID",
        "AIONUI_PROVIDER_MODEL_ID",
        "AIONUI_CODEX_API_KEY",
        "AIONUI_CODEX_BASE_URL",
        "AIONUI_CODEX_MODEL",
        "XAI_API_KEY",
        "GROK_HOME",
    ]
    .into_iter()
    .map(|name| (name.to_string(), std::env::var_os(name).is_some()))
    .collect()
}

fn env_value(value: &Value, key: &str) -> Value {
    value
        .get(key)
        .cloned()
        .or_else(|| value.get(snake_case(key)).cloned())
        .unwrap_or(Value::Null)
}

fn snake_case(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 4);
    for (index, ch) in value.chars().enumerate() {
        if ch.is_uppercase() && index != 0 {
            output.push('_');
        }
        output.extend(ch.to_lowercase());
    }
    output
}

async fn run_connection(
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    state: Arc<Mutex<LiveState>>,
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
                    .expect("probe state mutex poisoned");
                state.updates += 1;
                if let SessionUpdate::AgentMessageChunk(chunk) = &notification.update
                    && let ContentBlock::Text(text) = &chunk.content
                {
                    print!("{}", text.text);
                    let _ = std::io::stdout().flush();
                    state.output.push_str(&text.text);
                }
                Ok(())
            },
            on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                let request_json = serde_json::to_value(&request).unwrap_or(Value::Null);
                let option_id = request
                    .options
                    .first()
                    .map(|option| option.option_id.clone());
                permission_state
                    .lock()
                    .expect("probe state mutex poisoned")
                    .permission_requests
                    .push(request_json);
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
            state.lock().expect("probe state mutex poisoned").initialize =
                Some(serde_json::to_value(&init)?);

            let session = connection
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?;
            state
                .lock()
                .expect("probe state mutex poisoned")
                .session_new = Some(serde_json::to_value(&session)?);

            let prompt_response = connection
                .send_request(PromptRequest::new(
                    session.session_id,
                    vec![ContentBlock::Text(TextContent::new(PROMPT))],
                ))
                .block_task()
                .await?;
            state
                .lock()
                .expect("probe state mutex poisoned")
                .stop_reason = Some(serde_json::to_value(prompt_response.stop_reason)?);
            Ok(())
        })
        .await
        .map_err(|error| error.to_string())
}

async fn kill_process_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        kill_process_tree_async(pid).await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn kill_process_tree_async(pid: u32) {
    #[cfg(windows)]
    {
        let _ = TokioCommand::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .await;
    }
    #[cfg(unix)]
    {
        let _ = TokioCommand::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .status()
            .await;
    }
}

fn kill_process_tree_now(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .status();
    }
}

async fn probe(spec: LaunchSpec, cwd: PathBuf) -> ProbeReport {
    let env_presence = relevant_env();
    let state = Arc::new(Mutex::new(LiveState::default()));
    let mut command = TokioCommand::new(spec.executable);
    command
        .args(&spec.args)
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    eprintln!("\n=== {} ===", spec.agent);
    eprintln!("launch: {} {}", spec.executable, spec.args.join(" "));
    eprintln!("cwd: {}", cwd.display());
    eprintln!("prompt: {}", PROMPT);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return ProbeReport {
                agent: spec.agent,
                status: "fail",
                permission_model: spec.permission_model,
                launch: spec,
                prompt: PROMPT,
                inherited_relevant_env: env_presence,
                auth_methods: Value::Null,
                available_modes: Value::Null,
                permission_requests: Vec::new(),
                streamed_output: String::new(),
                updates: 0,
                stop_reason: Value::Null,
                failure_step: Some("spawn"),
                error: Some(error.to_string()),
            };
        }
    };
    let pid = child.id();
    let mut guard = ProcessTreeGuard::new(pid);
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_end(&mut bytes).await;
        }
        String::from_utf8_lossy(&bytes).into_owned()
    });

    let client_result = match (stdin, stdout) {
        (Some(stdin), Some(stdout)) => {
            let state_for_connection = Arc::clone(&state);
            let client = run_connection(stdin, stdout, state_for_connection, cwd);
            tokio::pin!(client);
            match timeout(PROBE_TIMEOUT, async {
                tokio::select! {
                    result = &mut client => ConnectionExit::Client(result),
                    result = child.wait() => ConnectionExit::Process(result),
                }
            })
            .await
            {
                Ok(ConnectionExit::Client(result)) => result,
                Ok(ConnectionExit::Process(result)) => Err(match result {
                    Ok(status) => format!("CLI exited before ACP completed (status={status})"),
                    Err(error) => format!("failed waiting for CLI before ACP completed: {error}"),
                }),
                Err(_) => Err(format!(
                    "ACP probe timed out after {} seconds",
                    PROBE_TIMEOUT.as_secs()
                )),
            }
        }
        _ => Err("spawned CLI did not provide piped stdio".to_string()),
    };

    let exited_during_probe =
        matches!(&client_result, Err(error) if error.contains("CLI exited before"));
    if !exited_during_probe {
        kill_process_tree(&mut child).await;
    }
    guard.disarm();
    let stderr = stderr_task
        .await
        .unwrap_or_else(|error| format!("stderr reader failed: {error}"));
    let state = state.lock().expect("probe state mutex poisoned");
    let (auth_methods, available_modes) = match (&state.initialize, &state.session_new) {
        (Some(init), Some(session)) => {
            (env_value(init, "authMethods"), env_value(session, "modes"))
        }
        _ => (Value::Null, Value::Null),
    };
    let failure_step = if client_result.is_ok() {
        None
    } else if state.initialize.is_none() {
        Some("initialize")
    } else if state.session_new.is_none() {
        Some("session/new")
    } else {
        Some("session/prompt")
    };
    let error = client_result.err().map(|error| {
        let stderr = stderr.trim();
        if stderr.is_empty() {
            error
        } else {
            format!("{error}; stderr: {stderr}")
        }
    });
    ProbeReport {
        agent: spec.agent,
        status: if error.is_none() { "pass" } else { "fail" },
        permission_model: spec.permission_model,
        launch: spec,
        prompt: PROMPT,
        inherited_relevant_env: env_presence,
        auth_methods,
        available_modes,
        permission_requests: state.permission_requests.clone(),
        streamed_output: state.output.clone(),
        updates: state.updates,
        stop_reason: state.stop_reason.clone().unwrap_or(Value::Null),
        failure_step,
        error,
    }
}

fn selected_agents(argument: Option<&str>) -> Result<Vec<LaunchSpec>, String> {
    let specs = launch_specs();
    match argument.unwrap_or("all") {
        "all" => Ok(specs.into_iter().collect()),
        name @ ("claude" | "codex" | "grok") => specs
            .into_iter()
            .find(|spec| spec.agent == name)
            .map(|spec| vec![spec])
            .ok_or_else(|| format!("unknown agent: {name}")),
        other => Err(format!(
            "unknown agent: {other}; expected all, claude, codex, or grok"
        )),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let argument = std::env::args().skip(1).collect::<Vec<_>>();
    let selected = match argument.as_slice() {
        [] => selected_agents(None)?,
        [agent] if agent == "--agent" => return Err("--agent requires a value".into()),
        [flag, agent] if flag == "--agent" => selected_agents(Some(agent))?,
        _ => return Err("usage: cargo run -- [--agent all|claude|codex|grok]".into()),
    };
    let cwd = std::env::current_dir()?;
    let mut reports = Vec::new();
    for spec in selected {
        let report = probe(spec, cwd.clone()).await;
        println!("\n\n[{} streaming output complete]", report.agent);
        let results_dir = PathBuf::from("results");
        std::fs::create_dir_all(&results_dir)?;
        let path = results_dir.join(format!("{}.json", report.agent));
        std::fs::write(&path, serde_json::to_vec_pretty(&report)?)?;
        eprintln!("report: {}", path.display());
        reports.push(report);
    }
    let failed = reports
        .iter()
        .filter(|report| report.status == "fail")
        .count();
    println!(
        "\nprobe summary: {} passed, {} failed",
        reports.len() - failed,
        failed
    );
    if failed != 0 {
        std::process::exit(1);
    }
    Ok(())
}
