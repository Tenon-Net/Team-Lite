//! Minimal shared primitives for Team-Lite (slice of upstream `aionui-common`).

pub mod constants;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::response::{IntoResponse, Response};
use http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Milliseconds since Unix epoch.
pub type TimestampMs = i64;

pub fn now_ms() -> TimestampMs {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as TimestampMs)
        .unwrap_or(0)
}

pub fn generate_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

pub fn generate_id_with_length(length: Option<usize>) -> String {
    match length {
        Some(len) if len < 36 => {
            let full = uuid::Uuid::new_v4().simple().to_string();
            full.chars().take(len).collect()
        }
        _ => generate_id(),
    }
}

pub fn generate_prefixed_id(prefix: &str) -> String {
    format!("{prefix}{}", generate_id())
}

pub fn generate_short_id() -> String {
    generate_id_with_length(Some(8))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentType {
    Acp,
    #[serde(rename = "openclaw-gateway")]
    OpenclawGateway,
    Nanobot,
    Remote,
    Aionrs,
    Gemini,
    Codex,
}

impl AgentType {
    pub fn serde_name(self) -> &'static str {
        match self {
            Self::Acp => "acp",
            Self::OpenclawGateway => "openclaw-gateway",
            Self::Nanobot => "nanobot",
            Self::Remote => "remote",
            Self::Aionrs => "aionrs",
            Self::Gemini => "gemini",
            Self::Codex => "codex",
        }
    }

    /// Types that may still appear in historical rows but cannot start new team conversations.
    pub fn supports_new_conversation(self) -> bool {
        matches!(self, Self::Acp | Self::Aionrs)
    }

    pub fn is_deprecated_runtime(self) -> bool {
        !self.supports_new_conversation()
    }

    pub fn full_auto_mode_id(self, backend: Option<&str>) -> &'static str {
        match self {
            Self::Acp => match backend {
                Some("claude") | Some("codebuddy") => "bypassPermissions",
                Some("codex") => "agent-full-access",
                Some("hermes") => "default",
                Some("opencode") => "build",
                Some("cursor") => "agent",
                _ => "yolo",
            },
            Self::Aionrs
            | Self::Gemini
            | Self::Codex
            | Self::OpenclawGateway
            | Self::Nanobot
            | Self::Remote => "yolo",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentKillReason {
    IdleTimeout,
    AgentErrorRecovery,
    TeamMcpRebuild,
    TeamDeleted,
    ConversationDeleted,
    UserCancelTimeout,
    RuntimeCapabilityChanged,
    AgentConfigChanged,
    Shutdown,
    Replace,
    Error,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderWithModel {
    pub provider_id: String,
    pub model: String,
    #[serde(default)]
    pub use_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResult<T> {
    pub items: Vec<T>,
    pub total: u64,
    pub has_more: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Payload too large: {0}")]
    PayloadTooLarge(String),
    #[error("Unsupported media type: {0}")]
    UnsupportedMediaType(String),
    #[error("Unauthorized: {0}")]
    Unauthorized(String),
    #[error("Forbidden: {0}")]
    Forbidden(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Internal error: {0}")]
    Internal(String),
    #[error("{message}")]
    Coded {
        status: StatusCode,
        code: &'static str,
        message: String,
        details: Option<Value>,
    },
    #[error("Workspace path is unavailable: {0}")]
    WorkspacePathUnavailable(String),
    #[error("Workspace path is unavailable during execution: {0}")]
    WorkspacePathRuntimeUnavailable(String),
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Forbidden(msg.into())
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }
    pub fn coded(
        status: StatusCode,
        code: &'static str,
        message: impl Into<String>,
        details: impl Into<Option<Value>>,
    ) -> Self {
        Self::Coded {
            status,
            code,
            message: message.into(),
            details: details.into(),
        }
    }

    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::PayloadTooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
            Self::UnsupportedMediaType(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Coded { status, .. } => *status,
            Self::WorkspacePathUnavailable(_) | Self::WorkspacePathRuntimeUnavailable(_) => {
                StatusCode::BAD_REQUEST
            }
        }
    }

    pub fn error_code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "NOT_FOUND",
            Self::BadRequest(_) => "BAD_REQUEST",
            Self::PayloadTooLarge(_) => "PAYLOAD_TOO_LARGE",
            Self::UnsupportedMediaType(_) => "UNSUPPORTED_MEDIA_TYPE",
            Self::Unauthorized(_) => "UNAUTHORIZED",
            Self::Forbidden(_) => "FORBIDDEN",
            Self::Conflict(_) => "CONFLICT",
            Self::Internal(_) => "INTERNAL",
            Self::Coded { code, .. } => code,
            Self::WorkspacePathUnavailable(_) => "WORKSPACE_PATH_UNAVAILABLE",
            Self::WorkspacePathRuntimeUnavailable(_) => "WORKSPACE_PATH_RUNTIME_UNAVAILABLE",
        }
    }

    pub fn error_details(&self) -> Option<Value> {
        match self {
            Self::Coded { details, .. } => details.clone(),
            Self::WorkspacePathUnavailable(path) => Some(json!({
                "field": "workspace",
                "workspace_path": path,
                "operation": "create",
            })),
            Self::WorkspacePathRuntimeUnavailable(path) => Some(json!({
                "field": "workspace",
                "workspace_path": path,
                "operation": "runtime",
            })),
            _ => None,
        }
    }
}

impl From<JsonRejection> for ApiError {
    fn from(err: JsonRejection) -> Self {
        match err.status() {
            StatusCode::PAYLOAD_TOO_LARGE => {
                Self::PayloadTooLarge("Request body is too large.".to_owned())
            }
            StatusCode::UNSUPPORTED_MEDIA_TYPE => {
                Self::UnsupportedMediaType("Unsupported media type.".to_owned())
            }
            _ => Self::BadRequest("Invalid JSON request body.".to_owned()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let code = self.error_code();
        let message = self.to_string();
        let details = match &self {
            Self::Coded { details, .. } => details.clone(),
            Self::WorkspacePathUnavailable(path) => Some(json!({
                "field": "workspace",
                "workspace_path": path,
                "operation": "create",
            })),
            Self::WorkspacePathRuntimeUnavailable(path) => Some(json!({
                "field": "workspace",
                "workspace_path": path,
                "operation": "runtime",
            })),
            _ => None,
        };
        let body = json!({
            "success": false,
            "error": message,
            "code": code,
            "details": details,
        });
        (status, Json(body)).into_response()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApiErrorLogContext {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationStatus {
    Active,
    Pending,
    Running,
    Finished,
    Archived,
    Deleted,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspacePathValidationError {
    Empty,
    DoesNotExist(String),
    NotDirectory(String),
    NotAccessible { path: String, reason: String },
}

pub fn validate_workspace_path_availability(
    workspace: &str,
) -> Result<String, WorkspacePathValidationError> {
    use std::fs;
    use std::path::Path;

    if workspace.trim().is_empty() {
        return Err(WorkspacePathValidationError::Empty);
    }
    let path = Path::new(workspace);
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => Ok(workspace.to_owned()),
        Ok(_) => Err(WorkspacePathValidationError::NotDirectory(workspace.to_owned())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Err(WorkspacePathValidationError::DoesNotExist(workspace.to_owned()))
        }
        Err(err) => Err(WorkspacePathValidationError::NotAccessible {
            path: workspace.to_owned(),
            reason: err.to_string(),
        }),
    }
}
