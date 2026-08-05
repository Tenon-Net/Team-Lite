use serde::{Deserialize, Serialize};

/// Minimal stream event set used by team crash detection / tests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum AgentStreamEvent {
    Start(StartEventData),
    #[serde(rename = "content")]
    Text(TextEventData),
    Error(ErrorEventData),
    Finish(FinishEventData),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StartEventData {
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TextEventData {
    pub content: String,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FinishEventData {
    #[serde(default)]
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEventData {
    pub message: String,
    #[serde(default)]
    pub code: Option<String>,
}

impl ErrorEventData {
    pub fn legacy(message: impl Into<String>, code: Option<String>) -> Self {
        Self {
            message: message.into(),
            code,
        }
    }
}
