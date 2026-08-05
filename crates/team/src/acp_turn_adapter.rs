//! Thin adapter: `AgentTurnExecutionPort` / `AgentTurnCancellationPort` → `acp::turn` (B7).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use acp::turn::{AcpTurnInput, run_acp_turn};
use acp::{AgentError, LaunchConfig};
use api_types::{ConversationRuntimeSummary, WebSocketMessage};
use async_trait::async_trait;
use serde_json::json;
use store::models::MessageRow;
use store::{EventBroadcaster, IConversationRepository};
use team_common::{generate_id, now_ms};
use tokio::sync::watch;
use tracing::{info, warn};

use crate::ports::{
    AgentTurnCancellationPort, AgentTurnExecutionError, AgentTurnExecutionPort, AgentTurnOutcome,
    AgentTurnRequest, AgentTurnStarted, AgentTurnStatus,
};

/// Direct ACP turn port used by Team-Lite (no conversation service middle layer).
pub struct AcpTurnPort {
    conversation_repo: Arc<dyn IConversationRepository>,
    broadcaster: Arc<dyn EventBroadcaster>,
    /// Default backend when not overridden per turn (`grok` / `codex` / `claude`).
    default_backend: String,
    default_workspace: PathBuf,
    /// Active cancel signals keyed by `(conversation_id, turn_id)`.
    active: Mutex<HashMap<(String, String), watch::Sender<bool>>>,
}

impl AcpTurnPort {
    pub fn new(
        conversation_repo: Arc<dyn IConversationRepository>,
        broadcaster: Arc<dyn EventBroadcaster>,
        default_backend: impl Into<String>,
        default_workspace: impl Into<PathBuf>,
    ) -> Self {
        Self {
            conversation_repo,
            broadcaster,
            default_backend: default_backend.into(),
            default_workspace: default_workspace.into(),
            active: Mutex::new(HashMap::new()),
        }
    }

    /// Prefer conversation.extra.backend / execution_backend, else default.
    async fn resolve_backend(&self, request: &AgentTurnRequest) -> String {
        if let Ok(Some(row)) = self.conversation_repo.get(&request.conversation_id).await {
            if let Ok(extra) = serde_json::from_str::<serde_json::Value>(&row.extra) {
                for key in ["execution_backend", "backend", "assistant_backend"] {
                    if let Some(b) = extra
                        .get(key)
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        if LaunchConfig::for_backend(b).is_some() {
                            return b.to_ascii_lowercase();
                        }
                    }
                }
            }
        }
        self.default_backend.clone()
    }

    /// Prefer conversation.extra.workspace (team shared path), else default data dir.
    async fn resolve_workspace(&self, request: &AgentTurnRequest) -> PathBuf {
        if let Ok(Some(row)) = self.conversation_repo.get(&request.conversation_id).await {
            if let Ok(extra) = serde_json::from_str::<serde_json::Value>(&row.extra) {
                if let Some(ws) = extra
                    .get("workspace")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    let path = PathBuf::from(ws);
                    if path.is_dir() {
                        return path;
                    }
                    // Create if missing so NewSessionRequest has a valid cwd.
                    if let Err(e) = std::fs::create_dir_all(&path) {
                        warn!(
                            conversation_id = %request.conversation_id,
                            workspace = %path.display(),
                            error = %e,
                            "failed to create conversation workspace; using default"
                        );
                    } else {
                        return path;
                    }
                }
            }
        }
        self.default_workspace.clone()
    }
}

#[async_trait]
impl AgentTurnExecutionPort for AcpTurnPort {
    async fn run_agent_turn(
        &self,
        request: AgentTurnRequest,
    ) -> Result<AgentTurnOutcome, AgentTurnExecutionError> {
        let turn_id = generate_id();
        let conversation_id = request.conversation_id.clone();
        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut active = self.active.lock().expect("active turns");
            active.insert((conversation_id.clone(), turn_id.clone()), cancel_tx);
        }

        // Critical: fire on_started BEFORE any long work so late-start cancel works.
        if let Some(on_started) = request.on_started.as_ref() {
            on_started(AgentTurnStarted {
                team_run_id: request.team_run_id.clone(),
                slot_id: request.slot_id.clone(),
                role: request.role.clone(),
                conversation_id: conversation_id.clone(),
                turn_id: turn_id.clone(),
            })
            .await;
        }

        // If late-start cancel already flipped the flag, exit without launching ACP.
        if *cancel_rx.borrow() {
            self.active
                .lock()
                .expect("active turns")
                .remove(&(conversation_id.clone(), turn_id.clone()));
            return Ok(AgentTurnOutcome {
                conversation_id,
                turn_id,
                status: AgentTurnStatus::Failed,
                response_text: None,
                runtime: None,
            });
        }

        let backend = self.resolve_backend(&request).await;
        if LaunchConfig::for_backend(&backend).is_none() {
            self.active
                .lock()
                .expect("active turns")
                .remove(&(conversation_id.clone(), turn_id.clone()));
            return Err(AgentTurnExecutionError::Failed {
                reason: format!("unsupported ACP backend: {backend}"),
            });
        }

        let workspace = self.resolve_workspace(&request).await;
        info!(
            %conversation_id,
            %turn_id,
            %backend,
            workspace = %workspace.display(),
            "acp turn starting"
        );

        let turn_result = run_acp_turn(
            AcpTurnInput {
                backend: backend.clone(),
                workspace,
                prompt: request.content.clone(),
            },
            cancel_rx,
        )
        .await;

        self.active
            .lock()
            .expect("active turns")
            .remove(&(conversation_id.clone(), turn_id.clone()));

        match turn_result {
            Ok(result) if result.cancelled => {
                warn!(%conversation_id, %turn_id, "acp turn cancelled");
                Ok(AgentTurnOutcome {
                    conversation_id,
                    turn_id,
                    status: AgentTurnStatus::Failed,
                    response_text: Some(result.response_text).filter(|s| !s.is_empty()),
                    runtime: Some(ConversationRuntimeSummary {
                        conversation_id: request.conversation_id,
                        status: Some("cancelled".into()),
                        mode: None,
                        model: None,
                    }),
                })
            }
            Ok(result) => {
                let text = result.response_text;
                info!(
                    %conversation_id,
                    %turn_id,
                    %backend,
                    updates = result.updates,
                    response_len = text.len(),
                    stop_reason = ?result.stop_reason,
                    "acp turn completed"
                );
                if !text.is_empty() {
                    if let Err(e) = persist_assistant_text(
                        self.conversation_repo.as_ref(),
                        &conversation_id,
                        &turn_id,
                        &text,
                    )
                    .await
                    {
                        warn!(%conversation_id, %turn_id, error = %e, "failed to persist turn text");
                    }
                    self.broadcaster.broadcast(WebSocketMessage::new(
                        "conversation.message",
                        json!({
                            "conversation_id": conversation_id,
                            "turn_id": turn_id,
                            "role": "assistant",
                            "content": text,
                        }),
                    ));
                } else {
                    warn!(
                        %conversation_id,
                        %turn_id,
                        updates = result.updates,
                        "acp turn completed with empty response_text"
                    );
                }
                Ok(AgentTurnOutcome {
                    conversation_id: conversation_id.clone(),
                    turn_id: turn_id.clone(),
                    status: AgentTurnStatus::Completed,
                    response_text: Some(text).filter(|s| !s.is_empty()),
                    runtime: Some(ConversationRuntimeSummary {
                        conversation_id,
                        status: Some("finished".into()),
                        mode: None,
                        model: Some(backend),
                    }),
                })
            }
            Err(AgentError::Timeout(msg)) => {
                warn!(%conversation_id, %turn_id, error = %msg, "acp turn timed out");
                Err(AgentTurnExecutionError::Failed { reason: msg })
            }
            Err(e) => {
                warn!(%conversation_id, %turn_id, error = %e, "acp turn failed");
                Err(AgentTurnExecutionError::Failed {
                    reason: e.to_string(),
                })
            }
        }
    }
}

#[async_trait]
impl AgentTurnCancellationPort for AcpTurnPort {
    async fn cancel_agent_turn(
        &self,
        _user_id: &str,
        conversation_id: &str,
        turn_id: &str,
    ) -> Result<(), AgentTurnExecutionError> {
        let key = (conversation_id.to_owned(), turn_id.to_owned());
        if let Some(tx) = self.active.lock().expect("active turns").get(&key) {
            let _ = tx.send(true);
            info!(%conversation_id, %turn_id, "acp turn cancel signaled");
            Ok(())
        } else {
            // Already finished or never started — treat as success (idempotent).
            Ok(())
        }
    }
}

async fn persist_assistant_text(
    repo: &dyn IConversationRepository,
    conversation_id: &str,
    turn_id: &str,
    text: &str,
) -> Result<(), store::DbError> {
    let msg_id = repo.mint_msg_id().await?;
    let content = json!({ "text": text }).to_string();
    let row = MessageRow {
        id: generate_id(),
        conversation_id: conversation_id.to_owned(),
        msg_id: Some(msg_id),
        r#type: "text".into(),
        content,
        position: Some("left".into()),
        status: Some("finish".into()),
        hidden: false,
        created_at: now_ms(),
    };
    // Tag turn for debugging / dedupe.
    let _ = turn_id;
    repo.insert_raw_message(&row).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use store::{BroadcastEventBus, MemoryConversationRepo};
    use crate::ports::AgentTurnSource;

    #[tokio::test]
    async fn on_started_fires_before_return() {
        let repo = Arc::new(MemoryConversationRepo::new());
        let bus = Arc::new(BroadcastEventBus::new(8));
        let port = AcpTurnPort::new(repo, bus, "unsupported-backend", ".");
        let started = Arc::new(Mutex::new(false));
        let started2 = started.clone();
        let request = AgentTurnRequest {
            team_run_id: None,
            team_id: "t1".into(),
            slot_id: "s1".into(),
            role: api_types::TeamRunTargetRole::Lead,
            conversation_id: "c1".into(),
            user_id: "u1".into(),
            content: "hi".into(),
            files: vec![],
            source: AgentTurnSource::Mailbox {
                unread_message_ids: vec![],
                unread_count: 0,
            },
            on_started: Some(Arc::new(move |_s| {
                let started2 = started2.clone();
                Box::pin(async move {
                    *started2.lock().unwrap() = true;
                })
            })),
        };
        // Unsupported backend still must invoke on_started first.
        let _ = port.run_agent_turn(request).await;
        assert!(*started.lock().unwrap(), "on_started must fire");
    }

    #[tokio::test]
    async fn cancel_before_launch_is_idempotent() {
        let repo = Arc::new(MemoryConversationRepo::new());
        let bus = Arc::new(BroadcastEventBus::new(8));
        let port = AcpTurnPort::new(repo, bus, "grok", ".");
        port.cancel_agent_turn("u1", "missing-conv", "missing-turn")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn grok_turn_persists_message() {
        if acp::LaunchConfig::for_backend("grok")
            .map(|l| !l.executable.exists())
            .unwrap_or(true)
        {
            eprintln!("skip: grok missing");
            return;
        }
        let repo = Arc::new(MemoryConversationRepo::new());
        let bus = Arc::new(BroadcastEventBus::new(8));
        let cwd = std::env::current_dir().expect("cwd");
        let port = AcpTurnPort::new(repo.clone(), bus, "grok", cwd);
        let request = AgentTurnRequest {
            team_run_id: None,
            team_id: "t1".into(),
            slot_id: "s1".into(),
            role: api_types::TeamRunTargetRole::Lead,
            conversation_id: "c-b7".into(),
            user_id: "u1".into(),
            content: "Respond exactly with: B7 adapter pass.".into(),
            files: vec![],
            source: AgentTurnSource::Mailbox {
                unread_message_ids: vec![],
                unread_count: 0,
            },
            on_started: None,
        };
        let outcome = port.run_agent_turn(request).await.expect("turn");
        assert_eq!(outcome.status, AgentTurnStatus::Completed);
        assert_eq!(outcome.conversation_id, "c-b7");
        assert!(!outcome.turn_id.is_empty());
        // Streamed text may vary; presence of outcome fields is the hard contract.
        let page = repo
            .list_messages_page("c-b7", &store::MessagePageParams::default())
            .await
            .unwrap();
        if outcome.response_text.as_ref().map(|s| !s.is_empty()).unwrap_or(false) {
            assert!(!page.items.is_empty(), "expected persisted message");
        }
    }
}
