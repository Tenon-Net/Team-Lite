//! ACP runtime surface used by `crates/team` (B6 manager + B7 turn runner).

pub mod agent_task;
pub mod launch;
pub mod manager;
pub mod process;
pub mod protocol;
pub mod session;
pub mod turn;
pub mod types;

pub use agent_task::IAgentTask;
pub use launch::LaunchConfig;
pub use manager::WorkerTaskManager;
pub use session::{SessionOpenResult, open_session_handshake};
pub use turn::{AcpTurnInput, AcpTurnResult, run_acp_turn, run_acp_turn_uncancellable};

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use team_common::{AgentKillReason, AgentType, ConversationStatus, TimestampMs};

pub use protocol::events::AgentStreamEvent;
pub use types::BuildTaskOptions;

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum AgentError {
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Internal error: {0}")]
    Internal(String),
    #[error("Timeout: {0}")]
    Timeout(String),
    #[error("Send error: {0}")]
    Send(String),
}

/// Alias used by some team tests.
pub type AgentSendError = AgentError;

impl AgentError {
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }
}

/// ACP agent handle produced after a successful handshake (B6).
#[derive(Clone, Default)]
pub struct AcpAgentManager {
    pub conversation_id: String,
    pub session_id: Option<String>,
    pub backend: String,
    /// PID of the handshake process (already reaped after open).
    pub last_pid: Option<u32>,
}

/// Opaque Aionrs handle kept for match arms during the selective port.
#[derive(Clone, Default)]
pub struct AionrsAgentManager {
    pub conversation_id: String,
}

impl AcpAgentManager {
    pub async fn set_config_option(&self, _key: &str, _value: &str) -> Result<(), AgentError> {
        Ok(())
    }
    pub async fn set_mode(&self, _mode: &str) -> Result<(), AgentError> {
        Ok(())
    }
    pub fn get_mode(&self) -> Option<String> {
        None
    }
    pub fn get_session_key(&self) -> Option<String> {
        self.session_id.clone()
    }
    pub fn agent_type(&self) -> AgentType {
        AgentType::Acp
    }
}

impl AionrsAgentManager {
    pub async fn set_mode(&self, _mode: &str) -> Result<(), AgentError> {
        Ok(())
    }
    pub fn get_mode(&self) -> Option<String> {
        None
    }
    pub fn agent_type(&self) -> AgentType {
        AgentType::Aionrs
    }
}

/// Trait object for test mocks (subset of upstream `IMockAgent`).
#[async_trait::async_trait]
pub trait IMockAgent: IAgentTask {
    async fn set_mode(&self, _mode: &str) -> Result<(), AgentError> {
        Ok(())
    }
    async fn set_config_option(
        &self,
        _key: &str,
        _value: &str,
    ) -> Result<api_types::SetConfigOptionResponse, AgentError> {
        Ok(api_types::SetConfigOptionResponse {
            applied: true,
            ..Default::default()
        })
    }
    fn get_mode(&self) -> Option<String> {
        None
    }
    fn get_session_key(&self) -> Option<String> {
        None
    }
}

#[derive(Clone)]
pub enum AgentInstance {
    Acp(Arc<AcpAgentManager>),
    Aionrs(Arc<AionrsAgentManager>),
    #[cfg(any(test, feature = "test-support"))]
    Mock(Arc<dyn IMockAgent>),
}

impl AgentInstance {
    pub async fn set_config_option(
        &self,
        key: &str,
        value: &str,
    ) -> Result<api_types::SetConfigOptionResponse, AgentError> {
        match self {
            Self::Acp(m) => {
                m.set_config_option(key, value).await?;
                Ok(api_types::SetConfigOptionResponse {
                    applied: true,
                    ..Default::default()
                })
            }
            Self::Aionrs(_) => Ok(api_types::SetConfigOptionResponse {
                applied: true,
                ..Default::default()
            }),
            #[cfg(any(test, feature = "test-support"))]
            Self::Mock(m) => m.set_config_option(key, value).await,
        }
    }

    pub async fn set_mode(&self, mode: &str) -> Result<(), AgentError> {
        match self {
            Self::Acp(m) => m.set_mode(mode).await,
            Self::Aionrs(m) => m.set_mode(mode).await,
            #[cfg(any(test, feature = "test-support"))]
            Self::Mock(m) => m.set_mode(mode).await,
        }
    }

    pub fn get_mode(&self) -> Option<String> {
        match self {
            Self::Acp(m) => m.get_mode(),
            Self::Aionrs(m) => m.get_mode(),
            #[cfg(any(test, feature = "test-support"))]
            Self::Mock(m) => m.get_mode(),
        }
    }

    pub fn get_session_key(&self) -> Option<String> {
        match self {
            Self::Acp(m) => m.get_session_key(),
            Self::Aionrs(_) => None,
            #[cfg(any(test, feature = "test-support"))]
            Self::Mock(m) => m.get_session_key(),
        }
    }

    pub fn agent_type(&self) -> AgentType {
        match self {
            Self::Acp(m) => m.agent_type(),
            Self::Aionrs(m) => m.agent_type(),
            #[cfg(any(test, feature = "test-support"))]
            Self::Mock(m) => m.agent_type(),
        }
    }

    pub fn status(&self) -> Option<ConversationStatus> {
        match self {
            Self::Acp(_) | Self::Aionrs(_) => None,
            #[cfg(any(test, feature = "test-support"))]
            Self::Mock(m) => m.status(),
        }
    }

    pub fn last_activity_at(&self) -> TimestampMs {
        match self {
            Self::Acp(_) | Self::Aionrs(_) => 0,
            #[cfg(any(test, feature = "test-support"))]
            Self::Mock(m) => m.last_activity_at(),
        }
    }

    pub fn get_confirmations(&self) -> Vec<String> {
        Vec::new()
    }
}

#[async_trait::async_trait]
pub trait IWorkerTaskManager: Send + Sync {
    fn get_task(&self, conversation_id: &str) -> Option<AgentInstance>;

    async fn get_or_build_task(
        &self,
        conversation_id: &str,
        options: BuildTaskOptions,
    ) -> Result<AgentInstance, AgentError>;

    fn kill(&self, conversation_id: &str, reason: Option<AgentKillReason>) -> Result<(), AgentError>;

    fn kill_and_wait(
        &self,
        conversation_id: &str,
        reason: Option<AgentKillReason>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>>;

    async fn clear(&self);

    fn active_count(&self) -> usize;

    fn invalidate_agent_configuration(&self, _agent_id: &str) {}

    fn is_agent_configuration_stale(&self, _agent: &AgentInstance) -> bool {
        false
    }

    fn collect_idle(&self, idle_threshold_ms: TimestampMs) -> Vec<String>;
}

/// Foreground lease registry (upstream `ActiveLeaseRegistry`).
#[derive(Default)]
pub struct ActiveLeaseRegistry {
    leases: std::sync::Mutex<std::collections::HashMap<String, TimestampMs>>,
    ttl_ms: TimestampMs,
}

impl ActiveLeaseRegistry {
    pub fn new() -> Self {
        Self {
            leases: Default::default(),
            ttl_ms: 90_000,
        }
    }

    pub fn with_ttl_ms(ttl_ms: TimestampMs) -> Self {
        Self {
            leases: Default::default(),
            ttl_ms,
        }
    }

    pub fn renew(&self, conversation_id: &str) -> TimestampMs {
        let expires_at = team_common::now_ms().saturating_add(self.ttl_ms);
        self.leases
            .lock()
            .expect("lease lock")
            .insert(conversation_id.to_owned(), expires_at);
        expires_at
    }

    pub fn renew_many<'a>(
        &self,
        conversation_ids: impl IntoIterator<Item = &'a str>,
    ) -> (usize, TimestampMs) {
        let expires_at = team_common::now_ms().saturating_add(self.ttl_ms);
        let mut count = 0;
        let mut map = self.leases.lock().expect("lease lock");
        for conversation_id in conversation_ids {
            map.insert(conversation_id.to_owned(), expires_at);
            count += 1;
        }
        (count, expires_at)
    }

    pub fn active_until(&self, conversation_id: &str) -> Option<TimestampMs> {
        let now = team_common::now_ms();
        let mut map = self.leases.lock().expect("lease lock");
        let expires_at = *map.get(conversation_id)?;
        if expires_at > now {
            Some(expires_at)
        } else {
            map.remove(conversation_id);
            None
        }
    }

    pub fn is_active(&self, conversation_id: &str) -> bool {
        self.active_until(conversation_id).is_some()
    }
}

/// Idle cleanup coordinator (upstream `aionui-ai-agent::IdleCleanupCoordinator`).
#[async_trait::async_trait]
pub trait IdleCleanupCoordinator: Send + Sync {
    async fn cleanup_idle_conversations(
        &self,
        idle_conversation_ids: Vec<String>,
        idle_threshold_ms: TimestampMs,
    ) -> Vec<String>;
}
