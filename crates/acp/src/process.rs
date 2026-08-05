//! Process-tree cleanup (Windows `taskkill /T`, Unix process-group kill).

use tokio::process::{Child, Command as TokioCommand};

/// Kill a process tree by pid, then ensure `child` is reaped.
pub async fn kill_process_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        kill_process_tree_async(pid).await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

pub async fn kill_process_tree_async(pid: u32) {
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

/// Best-effort synchronous kill for `Drop` paths.
pub fn kill_process_tree_now(pid: u32) {
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

/// Returns true if a process with `pid` still appears to be running.
pub fn process_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        // `tasklist` exit 0 always; parse output for the pid.
        let output = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output();
        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                text.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
    #[cfg(unix)]
    {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
}

/// Guard that kills the process tree on drop unless disarmed.
pub struct ProcessTreeGuard {
    pid: Option<u32>,
    armed: bool,
}

impl ProcessTreeGuard {
    pub fn new(pid: Option<u32>) -> Self {
        Self { pid, armed: true }
    }

    pub fn disarm(&mut self) {
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
