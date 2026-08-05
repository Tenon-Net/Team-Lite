//! Thin adapters so TeamSessionService can run without the full conversation service.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use store::models::{ConversationRow, MessageRow};
use store::{
    ConversationRowUpdate, IAssistantDefinitionRepository, IAssistantOverlayRepository,
    IConversationRepository, MemoryConversationRepo,
};
use team::ports::{TeamAssistantCatalogEntry, TeamAssistantCatalogPort, TeamConversationBindingLookup};
use team::provisioning::{
    TeamConversationCreateRequest, TeamConversationCreateResult, TeamConversationProvisioningPort,
};
use team::{TeamError, TeamProjectionMessageStore};
use team_common::{AgentType, generate_id, now_ms};
use acp::IWorkerTaskManager;
use api_types::GetConfigOptionsResponse;

/// Conversation provisioning backed by MemoryConversationRepo.
pub struct MemoryConversationPorts {
    repo: Arc<MemoryConversationRepo>,
    workspace_root: PathBuf,
}

impl MemoryConversationPorts {
    pub fn new(repo: Arc<MemoryConversationRepo>, workspace_root: PathBuf) -> Self {
        Self {
            repo,
            workspace_root,
        }
    }
}

#[async_trait]
impl TeamConversationProvisioningPort for MemoryConversationPorts {
    async fn create_team_conversation(
        &self,
        request: TeamConversationCreateRequest,
    ) -> Result<TeamConversationCreateResult, TeamError> {
        let id = generate_id();
        let workspace = request
            .extra
            .get("workspace")
            .and_then(|v| v.as_str())
            .filter(|v| !v.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                let path = self
                    .workspace_root
                    .join("conversations")
                    .join(format!("acp-temp-{id}"));
                let _ = std::fs::create_dir_all(&path);
                path.to_string_lossy().into_owned()
            });
        let mut extra = request.extra;
        extra["workspace"] = serde_json::Value::String(workspace.clone());
        if let Some(aid) = &request.assistant_id {
            extra["assistant_id"] = serde_json::Value::String(aid.clone());
        }
        self.repo
            .create(&ConversationRow {
                id: id.clone(),
                user_id: request.user_id,
                name: request.name,
                r#type: request
                    .agent_type
                    .unwrap_or(AgentType::Acp)
                    .serde_name()
                    .to_owned(),
                pinned: false,
                pinned_at: None,
                source: None,
                channel_chat_id: None,
                extra: serde_json::to_string(&extra).unwrap_or_else(|_| "{}".into()),
                model: request
                    .top_level_model
                    .map(|m| serde_json::to_string(&m).unwrap_or_default()),
                status: Some("pending".into()),
                created_at: now_ms(),
                updated_at: now_ms(),
            })
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))?;
        Ok(TeamConversationCreateResult {
            conversation_id: id,
            workspace,
        })
    }

    async fn conversation_workspace(&self, conversation_id: &str) -> Result<Option<String>, TeamError> {
        let row = self
            .repo
            .get(conversation_id)
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))?;
        Ok(row.and_then(|r| {
            serde_json::from_str::<serde_json::Value>(&r.extra)
                .ok()
                .and_then(|extra| {
                    extra
                        .get("workspace")
                        .and_then(|v| v.as_str())
                        .map(str::to_owned)
                })
        }))
    }

    async fn conversation_assistant_id(
        &self,
        conversation_id: &str,
    ) -> Result<Option<String>, TeamError> {
        let row = self
            .repo
            .get(conversation_id)
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))?;
        Ok(row.and_then(|r| {
            serde_json::from_str::<serde_json::Value>(&r.extra)
                .ok()
                .and_then(|extra| {
                    extra
                        .get("assistant_id")
                        .or_else(|| extra.get("preset_assistant_id"))
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|v| !v.is_empty())
                        .map(str::to_owned)
                })
        }))
    }

    async fn create_team_temp_workspace(&self, team_id: &str) -> Result<String, TeamError> {
        let path = self
            .workspace_root
            .join("conversations")
            .join(format!("team-temp-{team_id}"));
        std::fs::create_dir_all(&path).map_err(|e| TeamError::InvalidRequest(e.to_string()))?;
        Ok(path.to_string_lossy().into_owned())
    }

    async fn patch_runtime_config(
        &self,
        conversation_id: &str,
        patch: serde_json::Value,
    ) -> Result<(), TeamError> {
        let row = self
            .repo
            .get(conversation_id)
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))?
            .ok_or_else(|| TeamError::InvalidRequest(format!("conversation not found: {conversation_id}")))?;
        let mut extra: serde_json::Value =
            serde_json::from_str(&row.extra).unwrap_or_else(|_| serde_json::json!({}));
        if let (Some(target), Some(source)) = (extra.as_object_mut(), patch.as_object()) {
            for (k, v) in source {
                target.insert(k.clone(), v.clone());
            }
        }
        self.repo
            .update(
                conversation_id,
                &ConversationRowUpdate {
                    extra: Some(serde_json::to_string(&extra).unwrap_or_else(|_| "{}".into())),
                    updated_at: Some(now_ms()),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))?;
        Ok(())
    }

    async fn save_acp_runtime_mode(
        &self,
        conversation_id: &str,
        mode: &str,
    ) -> Result<(), TeamError> {
        self.patch_runtime_config(
            conversation_id,
            serde_json::json!({ "current_mode_id": mode }),
        )
        .await
    }

    async fn get_config_options(
        &self,
        _conversation_id: &str,
    ) -> Result<GetConfigOptionsResponse, TeamError> {
        Ok(GetConfigOptionsResponse::default())
    }

    async fn warmup_agent_process(
        &self,
        _user_id: &str,
        conversation_id: &str,
        task_manager: &Arc<dyn IWorkerTaskManager>,
    ) -> Result<(), TeamError> {
        let _ = task_manager
            .get_or_build_task(
                conversation_id,
                acp::BuildTaskOptions {
                    conversation_id: conversation_id.to_owned(),
                    workspace: self.conversation_workspace(conversation_id).await?,
                    backend: Some("grok".into()),
                    model: None,
                },
            )
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))?;
        Ok(())
    }

    async fn delete_team_conversation(
        &self,
        _user_id: &str,
        conversation_id: &str,
    ) -> Result<(), TeamError> {
        let _ = self.repo.delete(conversation_id).await;
        Ok(())
    }

    async fn lookup_team_binding_by_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Option<TeamConversationBindingLookup>, TeamError> {
        let row = self
            .repo
            .get(conversation_id)
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))?;
        Ok(row.map(|r| {
            let extra: serde_json::Value =
                serde_json::from_str(&r.extra).unwrap_or_else(|_| serde_json::json!({}));
            TeamConversationBindingLookup {
                conversation_id: r.id,
                user_id: r.user_id,
                team_id: extra
                    .get("team_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                slot_id: extra
                    .get("slot_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                role: extra
                    .get("role")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
            }
        }))
    }
}

/// Projection store over conversation messages.
pub struct ProjectionStoreAdapter {
    repo: Arc<MemoryConversationRepo>,
}

impl ProjectionStoreAdapter {
    pub fn new(repo: Arc<MemoryConversationRepo>) -> Self {
        Self { repo }
    }
}

#[async_trait]
impl TeamProjectionMessageStore for ProjectionStoreAdapter {
    fn mint_message_id(&self) -> String {
        generate_id()
    }

    async fn find_projected_message(
        &self,
        conversation_id: &str,
        msg_id: &str,
        msg_type: &str,
    ) -> Result<Option<MessageRow>, TeamError> {
        self.repo
            .get_message_by_msg_id(conversation_id, msg_id, msg_type)
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))
    }

    async fn insert_projected_message(&self, row: &MessageRow) -> Result<(), TeamError> {
        self.repo
            .insert_raw_message(row)
            .await
            .map_err(|e| TeamError::InvalidRequest(e.to_string()))
    }
}

/// Empty assistant catalog until seeds/UI land full assistants.
pub struct EmptyAssistantCatalog;

#[async_trait]
impl TeamAssistantCatalogPort for EmptyAssistantCatalog {
    async fn list_team_selectable_assistants(
        &self,
    ) -> Result<Vec<TeamAssistantCatalogEntry>, TeamError> {
        Ok(vec![
            TeamAssistantCatalogEntry {
                assistant_id: "asst-claude".into(),
                name: "Claude Lead".into(),
                backend: "claude".into(),
                description: "Planning lead (requires Claude login)".into(),
                skills: vec![],
            },
            TeamAssistantCatalogEntry {
                assistant_id: "asst-grok".into(),
                name: "Grok Worker".into(),
                backend: "grok".into(),
                description: "Execution teammate".into(),
                skills: vec![],
            },
            TeamAssistantCatalogEntry {
                assistant_id: "asst-codex".into(),
                name: "Codex Reviewer".into(),
                backend: "codex".into(),
                description: "Review teammate".into(),
                skills: vec![],
            },
        ])
    }
}

// Silence unused imports if compiler complains about assistant traits.
#[allow(dead_code)]
fn _assert_assistant_traits() {
    fn _a(_: &dyn IAssistantDefinitionRepository) {}
    fn _b(_: &dyn IAssistantOverlayRepository) {}
    fn _c(_: &dyn IConversationRepository) {}
}
