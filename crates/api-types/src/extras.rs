//! Extra DTOs that team routes still reference; expand as compile demands.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
        }
    }
}

impl ApiResponse<()> {
    pub fn success() -> Self {
        Self {
            success: true,
            data: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GetConfigOptionsResponse {
    #[serde(default, alias = "options")]
    pub config_options: Vec<AcpConfigOptionDto>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AcpConfigOptionDto {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub option_type: String,
    #[serde(default)]
    pub current_value: Option<String>,
    #[serde(default)]
    pub options: Vec<AcpConfigSelectOptionDto>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AcpConfigSelectOptionDto {
    pub value: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetModeRequest {
    pub mode: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SetConfigOptionResponse {
    #[serde(default)]
    pub applied: bool,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub confirmation: Option<ConfigOptionConfirmation>,
    #[serde(default)]
    pub config_options: Option<Vec<AcpConfigOptionDto>>,
}

impl SetConfigOptionResponse {
    pub fn observed() -> Self {
        Self {
            applied: true,
            message: None,
            confirmation: Some(ConfigOptionConfirmation::Observed),
            config_options: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigOptionConfirmation {
    Observed,
    Pending,
    Rejected,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConversationRuntimeSummary {
    pub conversation_id: String,
    pub status: Option<String>,
    pub mode: Option<String>,
    pub model: Option<String>,
}

/// Avatar helper used by team service response builder (upstream api-types).
pub fn assistant_avatar_response_value(
    avatar_type: &str,
    avatar_value: Option<&str>,
    assistant_id: &str,
) -> Option<String> {
    if matches!(avatar_type, "builtin_asset" | "user_asset") {
        return Some(format!("/api/assistants/{assistant_id}/avatar"));
    }

    let value = avatar_value.map(str::trim).filter(|value| !value.is_empty())?;
    if is_unsupported_direct_avatar_value(value) || is_local_avatar_value(value) {
        return None;
    }
    Some(value.to_owned())
}

fn is_unsupported_direct_avatar_value(value: &str) -> bool {
    value.starts_with("data:")
}

fn is_local_avatar_value(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() {
        return false;
    }
    if value.starts_with("file://") {
        return true;
    }
    if value.starts_with("/api/") || value.starts_with("/assets/") {
        return false;
    }
    if value.starts_with("//") || value.contains("://") || value.starts_with("data:") {
        return false;
    }
    value.contains('\\') || value.contains('/')
}
