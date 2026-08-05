use serde::{Deserialize, Serialize};

/// Options for building/resuming an agent task (minimal).
#[derive(Debug, Clone, Default)]
pub struct BuildTaskOptions {
    pub conversation_id: String,
    pub workspace: Option<String>,
    pub backend: Option<String>,
    pub model: Option<String>,
}

impl BuildTaskOptions {
    pub fn new(conversation_id: impl Into<String>) -> Self {
        Self {
            conversation_id: conversation_id.into(),
            ..Default::default()
        }
    }

    pub fn conversation_id(&self) -> &str {
        &self.conversation_id
    }

    pub fn apply_conversation_runtime_context(
        &mut self,
        _user_id: &str,
        conversation_id: &str,
        _helper_bin: Option<&str>,
        _base_url: Option<&str>,
        _runtime_token: Option<&str>,
    ) {
        self.conversation_id = conversation_id.to_owned();
    }
}

/// Placeholder message payload used by some team tests.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SendMessageData {
    pub content: String,
}
