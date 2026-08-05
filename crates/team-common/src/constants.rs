//! Team-related capability helpers (from upstream `aionui-common::constants`).

pub const AIONRS_RUNTIME_BACKEND: &str = "aionrs";

pub fn is_team_capable(backend: &str, agent_capabilities: Option<&serde_json::Value>) -> bool {
    if backend.trim().is_empty() {
        return false;
    }
    supports_team_mcp(backend, agent_capabilities) || supports_team_cli_fallback(agent_capabilities)
}

pub fn supports_team_mcp(backend: &str, agent_capabilities: Option<&serde_json::Value>) -> bool {
    if backend == AIONRS_RUNTIME_BACKEND {
        return true;
    }
    has_enabled_team_mcp_transport(agent_capabilities)
}

pub fn supports_team_cli_fallback(agent_capabilities: Option<&serde_json::Value>) -> bool {
    let Some(caps) = agent_capabilities else {
        return true;
    };
    !explicit_false(caps, &["shell"])
        && !explicit_false(caps, &["cli"])
        && !explicit_false(caps, &["supports_shell"])
        && !explicit_false(caps, &["supportsShell"])
        && !explicit_false(caps, &["supports_cli"])
        && !explicit_false(caps, &["supportsCli"])
        && !explicit_false(caps, &["execution", "shell"])
        && !explicit_false(caps, &["execution", "cli"])
}

fn has_enabled_team_mcp_transport(agent_capabilities: Option<&serde_json::Value>) -> bool {
    let Some(caps) = mcp_capability_object(agent_capabilities) else {
        return false;
    };
    bool_field(caps, "stdio") || bool_field(caps, "http")
}

fn mcp_capability_object(agent_capabilities: Option<&serde_json::Value>) -> Option<&serde_json::Value> {
    let caps = agent_capabilities?;
    caps.get("mcp_capabilities")
        .or_else(|| caps.get("mcpCapabilities"))
        .or_else(|| caps.get("mcp"))
}

fn bool_field(value: &serde_json::Value, key: &str) -> bool {
    value.get(key).and_then(|v| v.as_bool()) == Some(true)
}

fn explicit_false(value: &serde_json::Value, path: &[&str]) -> bool {
    let mut cursor = value;
    for key in path {
        let Some(next) = cursor.get(*key) else {
            return false;
        };
        cursor = next;
    }
    cursor.as_bool() == Some(false)
}
