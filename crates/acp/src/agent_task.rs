//! Task surface used by team unit tests.

use crate::{AgentError, AgentSendError, AgentStreamEvent};
use crate::types::SendMessageData;
use team_common::{AgentKillReason, AgentType, ConversationStatus, TimestampMs};
use tokio::sync::broadcast;

pub use crate::AgentInstance;

/// Minimal task surface used by some team tests (subset of upstream `IAgentTask`).
#[async_trait::async_trait]
pub trait IAgentTask: Send + Sync {
    fn agent_type(&self) -> AgentType;
    fn conversation_id(&self) -> &str;
    fn workspace(&self) -> &str {
        ""
    }
    fn status(&self) -> Option<ConversationStatus> {
        None
    }
    fn last_activity_at(&self) -> TimestampMs {
        0
    }
    fn subscribe(&self) -> broadcast::Receiver<AgentStreamEvent>;
    async fn send_message(&self, data: SendMessageData) -> Result<(), AgentSendError>;
    async fn cancel(&self) -> Result<(), AgentError> {
        Ok(())
    }
    fn kill(&self, _reason: Option<AgentKillReason>) -> Result<(), AgentError> {
        Ok(())
    }
}
