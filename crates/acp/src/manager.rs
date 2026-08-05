//! `IWorkerTaskManager` implementation backed by short-lived ACP handshakes (B6).

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use team_common::{AgentKillReason, TimestampMs, now_ms};

use crate::launch::LaunchConfig;
use crate::session::open_session_handshake;
use crate::types::BuildTaskOptions;
use crate::{
    AcpAgentManager, AgentError, AgentInstance, IWorkerTaskManager,
};

struct ManagedTask {
    instance: AgentInstance,
    last_activity_at: TimestampMs,
}

/// In-memory task manager that validates ACP launch via M0-proven handshakes.
///
/// For each `get_or_build_task` with a known backend, we spawn the CLI, complete
/// `initialize` + `session/new`, record the `session_id`, then kill the process
/// (no residual). Long-lived streaming sessions are B7.
pub struct WorkerTaskManager {
    tasks: Mutex<HashMap<String, ManagedTask>>,
    default_workspace: PathBuf,
}

impl WorkerTaskManager {
    pub fn new(default_workspace: impl Into<PathBuf>) -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            default_workspace: default_workspace.into(),
        }
    }

    pub fn default_local() -> Self {
        Self::new(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    }
}

#[async_trait::async_trait]
impl IWorkerTaskManager for WorkerTaskManager {
    fn get_task(&self, conversation_id: &str) -> Option<AgentInstance> {
        self.tasks
            .lock()
            .expect("task map")
            .get(conversation_id)
            .map(|t| t.instance.clone())
    }

    async fn get_or_build_task(
        &self,
        conversation_id: &str,
        options: BuildTaskOptions,
    ) -> Result<AgentInstance, AgentError> {
        if let Some(existing) = self.get_task(conversation_id) {
            return Ok(existing);
        }

        let backend = options
            .backend
            .as_deref()
            .unwrap_or("grok")
            .to_ascii_lowercase();
        let launch = LaunchConfig::for_backend(&backend).ok_or_else(|| {
            AgentError::bad_request(format!("unsupported ACP backend: {backend}"))
        })?;

        let workspace = options
            .workspace
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_workspace.clone());

        let opened = open_session_handshake(&launch, workspace).await?;

        let manager = Arc::new(AcpAgentManager {
            conversation_id: conversation_id.to_owned(),
            session_id: Some(opened.session_id.clone()),
            backend: opened.backend.clone(),
            last_pid: Some(opened.pid),
        });
        let instance = AgentInstance::Acp(manager);

        self.tasks.lock().expect("task map").insert(
            conversation_id.to_owned(),
            ManagedTask {
                instance: instance.clone(),
                last_activity_at: now_ms(),
            },
        );

        Ok(instance)
    }

    fn kill(
        &self,
        conversation_id: &str,
        _reason: Option<AgentKillReason>,
    ) -> Result<(), AgentError> {
        let mut map = self.tasks.lock().expect("task map");
        map.remove(conversation_id);
        Ok(())
    }

    fn kill_and_wait(
        &self,
        conversation_id: &str,
        reason: Option<AgentKillReason>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let _ = self.kill(conversation_id, reason);
        Box::pin(async {})
    }

    async fn clear(&self) {
        self.tasks.lock().expect("task map").clear();
    }

    fn active_count(&self) -> usize {
        self.tasks.lock().expect("task map").len()
    }

    fn collect_idle(&self, idle_threshold_ms: TimestampMs) -> Vec<String> {
        let now = now_ms();
        self.tasks
            .lock()
            .expect("task map")
            .iter()
            .filter(|(_, t)| now.saturating_sub(t.last_activity_at) > idle_threshold_ms)
            .map(|(id, _)| id.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::process_alive;
    use crate::session::open_session_handshake;
    use crate::launch::LaunchConfig;

    #[tokio::test]
    async fn open_session_handshake_grok_gets_session_id_and_cleans_up() {
        // Skip if grok binary missing (CI-less local machine is expected).
        let launch = LaunchConfig::for_backend("grok").expect("grok launch");
        if !launch.executable.exists() {
            eprintln!("skip: grok not installed at {:?}", launch.executable);
            return;
        }
        let cwd = std::env::current_dir().unwrap();
        let opened = open_session_handshake(&launch, &cwd)
            .await
            .expect("grok handshake");
        assert!(!opened.session_id.is_empty(), "session_id empty");
        assert!(
            !process_alive(opened.pid),
            "pid {} should not remain after handshake",
            opened.pid
        );
    }

    #[tokio::test]
    async fn worker_task_manager_build_and_kill_grok() {
        let launch = LaunchConfig::for_backend("grok").expect("grok launch");
        if !launch.executable.exists() {
            eprintln!("skip: grok not installed");
            return;
        }
        let mgr = WorkerTaskManager::default_local();
        let opts = BuildTaskOptions {
            conversation_id: "conv-b6-test".into(),
            workspace: None,
            backend: Some("grok".into()),
            model: None,
        };
        let instance = mgr
            .get_or_build_task("conv-b6-test", opts)
            .await
            .expect("build");
        match &instance {
            AgentInstance::Acp(m) => {
                assert!(m.session_id.is_some());
                if let Some(pid) = m.last_pid {
                    assert!(!process_alive(pid), "no residual pid {pid}");
                }
            }
            _ => panic!("expected Acp instance"),
        }
        assert_eq!(mgr.active_count(), 1);
        assert!(mgr.get_task("conv-b6-test").is_some());
        mgr.kill("conv-b6-test", None).unwrap();
        assert_eq!(mgr.active_count(), 0);
    }
}
