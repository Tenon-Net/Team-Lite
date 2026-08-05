//! How to spawn each supported ACP backend (from M0 spike).

use std::path::PathBuf;

/// Command line used to start an ACP stdio agent.
#[derive(Debug, Clone)]
pub struct LaunchConfig {
    pub backend: String,
    pub executable: PathBuf,
    pub args: Vec<String>,
}

impl LaunchConfig {
    /// Resolve launch config from a backend id (`codex` / `grok` / `claude`).
    ///
    /// Claude is supported for completeness; host login may be required (see M0).
    pub fn for_backend(backend: &str) -> Option<Self> {
        let backend = backend.trim().to_ascii_lowercase();
        match backend.as_str() {
            "codex" => Some(Self {
                backend: "codex".into(),
                executable: npx_cmd(),
                args: vec![
                    "-y".into(),
                    "@zed-industries/codex-acp@0.14.0".into(),
                ],
            }),
            "grok" => Some(Self {
                backend: "grok".into(),
                executable: grok_bin(),
                args: vec!["agent".into(), "stdio".into()],
            }),
            "claude" => Some(Self {
                backend: "claude".into(),
                executable: npx_cmd(),
                args: vec![
                    "-y".into(),
                    "@agentclientprotocol/claude-agent-acp@0.39.0".into(),
                ],
            }),
            _ => None,
        }
    }
}

fn npx_cmd() -> PathBuf {
    // Prefer PATH resolution; fall back to Program Files.
    which("npx.cmd")
        .or_else(|| which("npx"))
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files\nodejs\npx.cmd"))
}

fn grok_bin() -> PathBuf {
    which("grok.exe")
        .or_else(|| which("grok"))
        .unwrap_or_else(|| PathBuf::from(r"C:\Users\Administrator\.grok\bin\grok.exe"))
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
