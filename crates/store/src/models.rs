use serde::{Deserialize, Serialize};
use team_common::TimestampMs;

// ── Team ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub workspace: String,
    pub workspace_mode: String,
    pub agents: String,
    pub lead_agent_id: Option<String>,
    pub session_mode: Option<String>,
    pub agents_version: String,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
    pub archived_at: Option<TimestampMs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxMessageRow {
    pub id: String,
    pub team_id: String,
    pub to_agent_id: String,
    pub from_agent_id: String,
    pub msg_type: String,
    pub content: String,
    pub summary: Option<String>,
    pub files: Option<String>,
    pub read: bool,
    pub created_at: TimestampMs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamTaskRow {
    pub id: String,
    pub team_id: String,
    pub subject: String,
    pub description: Option<String>,
    pub status: String,
    pub owner: Option<String>,
    pub blocked_by: String,
    pub blocks: String,
    pub metadata: Option<String>,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}

// ── Conversation ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub r#type: String,
    pub extra: String,
    pub model: Option<String>,
    pub status: Option<String>,
    pub source: Option<String>,
    pub channel_chat_id: Option<String>,
    pub pinned: bool,
    pub pinned_at: Option<TimestampMs>,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub msg_id: Option<String>,
    pub r#type: String,
    pub content: String,
    pub position: Option<String>,
    pub status: Option<String>,
    pub hidden: bool,
    pub created_at: TimestampMs,
}

// ── Agent metadata / assistants / provider ──────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMetadataRow {
    pub id: String,
    pub icon: Option<String>,
    pub name: String,
    pub name_i18n: Option<String>,
    pub description: Option<String>,
    pub description_i18n: Option<String>,
    pub backend: Option<String>,
    pub agent_type: String,
    pub agent_source: String,
    pub agent_source_info: Option<String>,
    pub enabled: bool,
    pub command: Option<String>,
    pub args: Option<String>,
    pub env: Option<String>,
    pub native_skills_dirs: Option<String>,
    pub behavior_policy: Option<String>,
    pub yolo_id: Option<String>,
    pub agent_capabilities: Option<String>,
    pub auth_methods: Option<String>,
    pub config_options: Option<String>,
    pub available_modes: Option<String>,
    pub available_models: Option<String>,
    pub available_commands: Option<String>,
    pub sort_order: i64,
    pub last_check_status: Option<String>,
    pub last_check_kind: Option<String>,
    pub last_check_error_code: Option<String>,
    pub last_check_error_message: Option<String>,
    pub last_check_guidance: Option<String>,
    pub last_check_latency_ms: Option<i64>,
    pub last_check_at: Option<TimestampMs>,
    pub last_success_at: Option<TimestampMs>,
    pub last_failure_at: Option<TimestampMs>,
    pub command_override: Option<String>,
    pub env_override: Option<String>,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantDefinitionRow {
    pub id: String,
    pub assistant_id: String,
    pub source: String,
    pub owner_type: String,
    pub source_ref: Option<String>,
    pub name: String,
    pub name_i18n: String,
    pub description: Option<String>,
    pub description_i18n: String,
    pub avatar_type: String,
    pub avatar_value: Option<String>,
    pub agent_id: String,
    pub rule_resource_type: String,
    pub rule_resource_ref: Option<String>,
    pub recommended_prompts: String,
    pub recommended_prompts_i18n: String,
    pub default_model_mode: String,
    pub default_model_value: Option<String>,
    pub default_permission_mode: String,
    pub default_permission_value: Option<String>,
    pub default_thought_level_mode: String,
    pub default_thought_level_value: Option<String>,
    pub default_skills_mode: String,
    pub default_skill_ids: String,
    pub custom_skill_names: String,
    pub default_disabled_builtin_skill_ids: String,
    pub default_mcps_mode: String,
    pub default_mcp_ids: String,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
    pub deleted_at: Option<TimestampMs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantOverlayRow {
    pub assistant_definition_id: String,
    pub enabled: bool,
    pub sort_order: i32,
    pub agent_id_override: Option<String>,
    pub last_used_at: Option<TimestampMs>,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub platform: String,
    pub name: String,
    pub base_url: String,
    pub api_key_encrypted: String,
    pub models: String,
    pub enabled: bool,
    pub capabilities: String,
    pub context_limit: Option<i64>,
    pub model_protocols: Option<String>,
    pub model_enabled: Option<String>,
    pub model_health: Option<String>,
    pub bedrock_config: Option<String>,
    pub is_full_url: bool,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}

// ── Params / helpers ────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct UpsertAgentMetadataParams<'a> {
    pub id: &'a str,
    pub icon: Option<&'a str>,
    pub name: &'a str,
    pub name_i18n: Option<&'a str>,
    pub description: Option<&'a str>,
    pub description_i18n: Option<&'a str>,
    pub backend: Option<&'a str>,
    pub agent_type: &'a str,
    pub agent_source: &'a str,
    pub agent_source_info: Option<&'a str>,
    pub enabled: bool,
    pub command: Option<&'a str>,
    pub args: Option<&'a str>,
    pub env: Option<&'a str>,
    pub native_skills_dirs: Option<&'a str>,
    pub behavior_policy: Option<&'a str>,
    pub yolo_id: Option<&'a str>,
    pub agent_capabilities: Option<&'a str>,
    pub auth_methods: Option<&'a str>,
    pub config_options: Option<&'a str>,
    pub available_modes: Option<&'a str>,
    pub available_models: Option<&'a str>,
    pub available_commands: Option<&'a str>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateAgentHandshakeParams<'a> {
    pub agent_capabilities: Option<Option<&'a str>>,
    pub auth_methods: Option<Option<&'a str>>,
    pub config_options: Option<Option<&'a str>>,
    pub available_modes: Option<Option<&'a str>>,
    pub available_models: Option<Option<&'a str>>,
    pub available_commands: Option<Option<&'a str>>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateAgentAvailabilitySnapshotParams<'a> {
    pub last_check_status: Option<&'a str>,
    pub last_check_kind: Option<&'a str>,
    pub last_check_error_code: Option<&'a str>,
    pub last_check_error_message: Option<&'a str>,
    pub last_check_guidance: Option<&'a str>,
    pub last_check_latency_ms: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct UpsertAssistantDefinitionParams<'a> {
    pub id: &'a str,
    pub assistant_id: &'a str,
    pub name: &'a str,
    pub agent_id: &'a str,
}

#[derive(Debug, Clone, Default)]
pub struct UpsertAssistantOverlayParams<'a> {
    pub assistant_definition_id: &'a str,
    pub enabled: bool,
    pub agent_id_override: Option<&'a str>,
}

#[derive(Debug, Clone)]
pub struct AgentBindingResolution {
    pub agent_id: String,
    pub agent_source: String,
    pub agent_type: String,
    pub runtime_backend: String,
}

pub fn runtime_backend_for_agent(row: &AgentMetadataRow) -> String {
    row.backend
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(row.agent_type.as_str())
        .to_owned()
}

pub fn binding_resolution_for_agent(row: &AgentMetadataRow) -> AgentBindingResolution {
    AgentBindingResolution {
        agent_id: row.id.clone(),
        agent_source: row.agent_source.clone(),
        agent_type: row.agent_type.clone(),
        runtime_backend: runtime_backend_for_agent(row),
    }
}

fn agent_match_rank(row: &AgentMetadataRow) -> i32 {
    if row.agent_source == "builtin" {
        0
    } else {
        1
    }
}

pub fn resolve_agent_binding_from_rows(
    rows: &[AgentMetadataRow],
    value: &str,
) -> Option<AgentBindingResolution> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    rows.iter()
        .filter(|row| row.id == value)
        .min_by_key(|row| agent_match_rank(row))
        .or_else(|| {
            rows.iter()
                .filter(|row| row.backend.as_deref() == Some(value))
                .min_by_key(|row| agent_match_rank(row))
        })
        .or_else(|| {
            rows.iter()
                .filter(|row| row.agent_type == value)
                .min_by_key(|row| agent_match_rank(row))
        })
        .map(binding_resolution_for_agent)
}
