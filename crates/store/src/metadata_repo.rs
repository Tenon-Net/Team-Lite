use crate::error::DbError;
use crate::models::{
    AgentMetadataRow, AssistantDefinitionRow, AssistantOverlayRow, Provider,
    UpdateAgentAvailabilitySnapshotParams, UpdateAgentHandshakeParams, UpsertAgentMetadataParams,
    UpsertAssistantDefinitionParams, UpsertAssistantOverlayParams,
};
use std::sync::Mutex;
use team_common::now_ms;

#[async_trait::async_trait]
pub trait IAgentMetadataRepository: Send + Sync {
    async fn list_all(&self) -> Result<Vec<AgentMetadataRow>, DbError>;
    async fn get(&self, id: &str) -> Result<Option<AgentMetadataRow>, DbError>;
    async fn find_by_source_and_name(
        &self,
        agent_source: &str,
        name: &str,
    ) -> Result<Option<AgentMetadataRow>, DbError>;
    async fn find_builtin_by_backend(&self, backend: &str) -> Result<Option<AgentMetadataRow>, DbError>;
    async fn upsert(&self, params: &UpsertAgentMetadataParams<'_>) -> Result<AgentMetadataRow, DbError>;
    async fn apply_handshake(
        &self,
        id: &str,
        params: &UpdateAgentHandshakeParams<'_>,
    ) -> Result<Option<AgentMetadataRow>, DbError>;
    async fn update_availability_snapshot(
        &self,
        id: &str,
        params: &UpdateAgentAvailabilitySnapshotParams<'_>,
    ) -> Result<Option<AgentMetadataRow>, DbError>;
    async fn update_agent_overrides(
        &self,
        id: &str,
        command_override: Option<&str>,
        env_override: Option<&str>,
    ) -> Result<(), DbError>;
    async fn set_enabled(&self, id: &str, enabled: bool) -> Result<bool, DbError>;
    async fn delete(&self, id: &str) -> Result<bool, DbError>;
}

#[async_trait::async_trait]
pub trait IAssistantDefinitionRepository: Send + Sync {
    async fn list(&self) -> Result<Vec<AssistantDefinitionRow>, DbError>;
    async fn get_by_assistant_id(&self, assistant_id: &str)
    -> Result<Option<AssistantDefinitionRow>, DbError>;
    async fn get_by_id(&self, definition_id: &str) -> Result<Option<AssistantDefinitionRow>, DbError>;
    async fn get_by_source_ref(
        &self,
        source: &str,
        source_ref: &str,
    ) -> Result<Option<AssistantDefinitionRow>, DbError>;
    async fn upsert(
        &self,
        params: &UpsertAssistantDefinitionParams<'_>,
    ) -> Result<AssistantDefinitionRow, DbError>;
    async fn soft_delete(&self, definition_id: &str, deleted_at: i64) -> Result<bool, DbError>;
}

#[async_trait::async_trait]
pub trait IAssistantOverlayRepository: Send + Sync {
    async fn get(&self, definition_id: &str) -> Result<Option<AssistantOverlayRow>, DbError>;
    async fn list(&self) -> Result<Vec<AssistantOverlayRow>, DbError>;
    async fn upsert(
        &self,
        params: &UpsertAssistantOverlayParams<'_>,
    ) -> Result<AssistantOverlayRow, DbError>;
    async fn delete(&self, definition_id: &str) -> Result<bool, DbError>;
}

/// ADR 0003 deletes provider usage; trait kept until C1/C2 strip call sites.
#[async_trait::async_trait]
pub trait IProviderRepository: Send + Sync {
    async fn list(&self) -> Result<Vec<Provider>, DbError>;
    async fn find_by_id(&self, id: &str) -> Result<Option<Provider>, DbError>;
    async fn create(&self, params: CreateProviderParams<'_>) -> Result<Provider, DbError>;
    async fn update(&self, id: &str, params: UpdateProviderParams<'_>) -> Result<Provider, DbError>;
    async fn delete(&self, id: &str) -> Result<(), DbError>;
}

#[derive(Debug, Clone, Default)]
pub struct CreateProviderParams<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub platform: &'a str,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateProviderParams<'a> {
    pub name: Option<&'a str>,
    pub enabled: Option<bool>,
}

// ── Memory implementations (B4) ─────────────────────────────────────

#[derive(Default)]
struct MetaState {
    agents: Vec<AgentMetadataRow>,
    assistants: Vec<AssistantDefinitionRow>,
    overlays: Vec<AssistantOverlayRow>,
}

#[derive(Default)]
pub struct MemoryMetadataRepo {
    state: Mutex<MetaState>,
}

impl MemoryMetadataRepo {
    pub fn new() -> Self {
        Self::default()
    }
}

fn row_from_upsert(params: &UpsertAgentMetadataParams<'_>) -> AgentMetadataRow {
    let now = now_ms();
    AgentMetadataRow {
        id: params.id.to_owned(),
        icon: params.icon.map(str::to_owned),
        name: params.name.to_owned(),
        name_i18n: params.name_i18n.map(str::to_owned),
        description: params.description.map(str::to_owned),
        description_i18n: params.description_i18n.map(str::to_owned),
        backend: params.backend.map(str::to_owned),
        agent_type: params.agent_type.to_owned(),
        agent_source: params.agent_source.to_owned(),
        agent_source_info: params.agent_source_info.map(str::to_owned),
        enabled: params.enabled,
        command: params.command.map(str::to_owned),
        args: params.args.map(str::to_owned),
        env: params.env.map(str::to_owned),
        native_skills_dirs: params.native_skills_dirs.map(str::to_owned),
        behavior_policy: params.behavior_policy.map(str::to_owned),
        yolo_id: params.yolo_id.map(str::to_owned),
        agent_capabilities: params.agent_capabilities.map(str::to_owned),
        auth_methods: params.auth_methods.map(str::to_owned),
        config_options: params.config_options.map(str::to_owned),
        available_modes: params.available_modes.map(str::to_owned),
        available_models: params.available_models.map(str::to_owned),
        available_commands: params.available_commands.map(str::to_owned),
        sort_order: params.sort_order,
        last_check_status: None,
        last_check_kind: None,
        last_check_error_code: None,
        last_check_error_message: None,
        last_check_guidance: None,
        last_check_latency_ms: None,
        last_check_at: None,
        last_success_at: None,
        last_failure_at: None,
        command_override: None,
        env_override: None,
        created_at: now,
        updated_at: now,
    }
}

#[async_trait::async_trait]
impl IAgentMetadataRepository for MemoryMetadataRepo {
    async fn list_all(&self) -> Result<Vec<AgentMetadataRow>, DbError> {
        Ok(self.state.lock().expect("meta lock").agents.clone())
    }

    async fn get(&self, id: &str) -> Result<Option<AgentMetadataRow>, DbError> {
        Ok(self
            .state
            .lock()
            .expect("meta lock")
            .agents
            .iter()
            .find(|r| r.id == id)
            .cloned())
    }

    async fn find_by_source_and_name(
        &self,
        agent_source: &str,
        name: &str,
    ) -> Result<Option<AgentMetadataRow>, DbError> {
        Ok(self
            .state
            .lock()
            .expect("meta lock")
            .agents
            .iter()
            .find(|r| r.agent_source == agent_source && r.name == name)
            .cloned())
    }

    async fn find_builtin_by_backend(&self, backend: &str) -> Result<Option<AgentMetadataRow>, DbError> {
        Ok(self
            .state
            .lock()
            .expect("meta lock")
            .agents
            .iter()
            .find(|r| r.agent_source == "builtin" && r.backend.as_deref() == Some(backend))
            .cloned())
    }

    async fn upsert(&self, params: &UpsertAgentMetadataParams<'_>) -> Result<AgentMetadataRow, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        let row = row_from_upsert(params);
        if let Some(existing) = state.agents.iter_mut().find(|r| r.id == params.id) {
            let created_at = existing.created_at;
            *existing = row.clone();
            existing.created_at = created_at;
            existing.updated_at = now_ms();
            return Ok(existing.clone());
        }
        state.agents.push(row.clone());
        Ok(row)
    }

    async fn apply_handshake(
        &self,
        id: &str,
        params: &UpdateAgentHandshakeParams<'_>,
    ) -> Result<Option<AgentMetadataRow>, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        let Some(row) = state.agents.iter_mut().find(|r| r.id == id) else {
            return Ok(None);
        };
        if let Some(v) = &params.agent_capabilities {
            row.agent_capabilities = v.map(str::to_owned);
        }
        if let Some(v) = &params.auth_methods {
            row.auth_methods = v.map(str::to_owned);
        }
        if let Some(v) = &params.config_options {
            row.config_options = v.map(str::to_owned);
        }
        if let Some(v) = &params.available_modes {
            row.available_modes = v.map(str::to_owned);
        }
        if let Some(v) = &params.available_models {
            row.available_models = v.map(str::to_owned);
        }
        if let Some(v) = &params.available_commands {
            row.available_commands = v.map(str::to_owned);
        }
        row.updated_at = now_ms();
        Ok(Some(row.clone()))
    }

    async fn update_availability_snapshot(
        &self,
        id: &str,
        params: &UpdateAgentAvailabilitySnapshotParams<'_>,
    ) -> Result<Option<AgentMetadataRow>, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        let Some(row) = state.agents.iter_mut().find(|r| r.id == id) else {
            return Ok(None);
        };
        if let Some(v) = params.last_check_status {
            row.last_check_status = Some(v.to_owned());
        }
        if let Some(v) = params.last_check_kind {
            row.last_check_kind = Some(v.to_owned());
        }
        if let Some(v) = params.last_check_error_code {
            row.last_check_error_code = Some(v.to_owned());
        }
        if let Some(v) = params.last_check_error_message {
            row.last_check_error_message = Some(v.to_owned());
        }
        if let Some(v) = params.last_check_guidance {
            row.last_check_guidance = Some(v.to_owned());
        }
        if let Some(v) = params.last_check_latency_ms {
            row.last_check_latency_ms = Some(v);
        }
        row.last_check_at = Some(now_ms());
        row.updated_at = now_ms();
        Ok(Some(row.clone()))
    }

    async fn update_agent_overrides(
        &self,
        id: &str,
        command_override: Option<&str>,
        env_override: Option<&str>,
    ) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("meta lock");
        let row = state
            .agents
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| DbError::NotFound(id.to_owned()))?;
        row.command_override = command_override.map(str::to_owned);
        row.env_override = env_override.map(str::to_owned);
        row.updated_at = now_ms();
        Ok(())
    }

    async fn set_enabled(&self, id: &str, enabled: bool) -> Result<bool, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        if let Some(row) = state.agents.iter_mut().find(|r| r.id == id) {
            row.enabled = enabled;
            row.updated_at = now_ms();
            return Ok(true);
        }
        Ok(false)
    }

    async fn delete(&self, id: &str) -> Result<bool, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        let before = state.agents.len();
        state.agents.retain(|r| r.id != id);
        Ok(state.agents.len() != before)
    }
}

#[async_trait::async_trait]
impl IAssistantDefinitionRepository for MemoryMetadataRepo {
    async fn list(&self) -> Result<Vec<AssistantDefinitionRow>, DbError> {
        Ok(self
            .state
            .lock()
            .expect("meta lock")
            .assistants
            .iter()
            .filter(|a| a.deleted_at.is_none())
            .cloned()
            .collect())
    }

    async fn get_by_assistant_id(
        &self,
        assistant_id: &str,
    ) -> Result<Option<AssistantDefinitionRow>, DbError> {
        Ok(self
            .state
            .lock()
            .expect("meta lock")
            .assistants
            .iter()
            .find(|a| a.assistant_id == assistant_id && a.deleted_at.is_none())
            .cloned())
    }

    async fn get_by_id(&self, definition_id: &str) -> Result<Option<AssistantDefinitionRow>, DbError> {
        Ok(self
            .state
            .lock()
            .expect("meta lock")
            .assistants
            .iter()
            .find(|a| a.id == definition_id)
            .cloned())
    }

    async fn get_by_source_ref(
        &self,
        source: &str,
        source_ref: &str,
    ) -> Result<Option<AssistantDefinitionRow>, DbError> {
        Ok(self
            .state
            .lock()
            .expect("meta lock")
            .assistants
            .iter()
            .find(|a| a.source == source && a.source_ref.as_deref() == Some(source_ref))
            .cloned())
    }

    async fn upsert(
        &self,
        params: &UpsertAssistantDefinitionParams<'_>,
    ) -> Result<AssistantDefinitionRow, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        let now = now_ms();
        if let Some(existing) = state.assistants.iter_mut().find(|a| a.id == params.id) {
            existing.assistant_id = params.assistant_id.to_owned();
            existing.name = params.name.to_owned();
            existing.agent_id = params.agent_id.to_owned();
            existing.updated_at = now;
            existing.deleted_at = None;
            return Ok(existing.clone());
        }
        let row = AssistantDefinitionRow {
            id: params.id.to_owned(),
            assistant_id: params.assistant_id.to_owned(),
            source: "local".into(),
            owner_type: "system".into(),
            source_ref: None,
            name: params.name.to_owned(),
            name_i18n: "{}".into(),
            description: None,
            description_i18n: "{}".into(),
            avatar_type: "emoji".into(),
            avatar_value: None,
            agent_id: params.agent_id.to_owned(),
            rule_resource_type: "none".into(),
            rule_resource_ref: None,
            recommended_prompts: "[]".into(),
            recommended_prompts_i18n: "{}".into(),
            default_model_mode: "inherit".into(),
            default_model_value: None,
            default_permission_mode: "inherit".into(),
            default_permission_value: None,
            default_thought_level_mode: "inherit".into(),
            default_thought_level_value: None,
            default_skills_mode: "inherit".into(),
            default_skill_ids: "[]".into(),
            custom_skill_names: "[]".into(),
            default_disabled_builtin_skill_ids: "[]".into(),
            default_mcps_mode: "inherit".into(),
            default_mcp_ids: "[]".into(),
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };
        state.assistants.push(row.clone());
        Ok(row)
    }

    async fn soft_delete(&self, definition_id: &str, deleted_at: i64) -> Result<bool, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        if let Some(row) = state.assistants.iter_mut().find(|a| a.id == definition_id) {
            row.deleted_at = Some(deleted_at);
            return Ok(true);
        }
        Ok(false)
    }
}

#[async_trait::async_trait]
impl IAssistantOverlayRepository for MemoryMetadataRepo {
    async fn get(&self, definition_id: &str) -> Result<Option<AssistantOverlayRow>, DbError> {
        Ok(self
            .state
            .lock()
            .expect("meta lock")
            .overlays
            .iter()
            .find(|o| o.assistant_definition_id == definition_id)
            .cloned())
    }

    async fn list(&self) -> Result<Vec<AssistantOverlayRow>, DbError> {
        Ok(self.state.lock().expect("meta lock").overlays.clone())
    }

    async fn upsert(
        &self,
        params: &UpsertAssistantOverlayParams<'_>,
    ) -> Result<AssistantOverlayRow, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        let now = now_ms();
        if let Some(existing) = state
            .overlays
            .iter_mut()
            .find(|o| o.assistant_definition_id == params.assistant_definition_id)
        {
            existing.enabled = params.enabled;
            existing.agent_id_override = params.agent_id_override.map(str::to_owned);
            existing.updated_at = now;
            return Ok(existing.clone());
        }
        let row = AssistantOverlayRow {
            assistant_definition_id: params.assistant_definition_id.to_owned(),
            enabled: params.enabled,
            sort_order: 0,
            agent_id_override: params.agent_id_override.map(str::to_owned),
            last_used_at: None,
            created_at: now,
            updated_at: now,
        };
        state.overlays.push(row.clone());
        Ok(row)
    }

    async fn delete(&self, definition_id: &str) -> Result<bool, DbError> {
        let mut state = self.state.lock().expect("meta lock");
        let before = state.overlays.len();
        state
            .overlays
            .retain(|o| o.assistant_definition_id != definition_id);
        Ok(state.overlays.len() != before)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn agent_metadata_upsert_and_lookup() {
        let repo = MemoryMetadataRepo::new();
        let params = UpsertAgentMetadataParams {
            id: "claude",
            name: "Claude",
            agent_type: "acp",
            agent_source: "builtin",
            backend: Some("claude"),
            enabled: true,
            sort_order: 1,
            ..Default::default()
        };
        <MemoryMetadataRepo as IAgentMetadataRepository>::upsert(&repo, &params)
            .await
            .unwrap();
        let by_backend =
            <MemoryMetadataRepo as IAgentMetadataRepository>::find_builtin_by_backend(
                &repo, "claude",
            )
            .await
            .unwrap();
        assert!(by_backend.is_some());
        let assistant = <MemoryMetadataRepo as IAssistantDefinitionRepository>::upsert(
            &repo,
            &UpsertAssistantDefinitionParams {
                id: "def-1",
                assistant_id: "asst-claude",
                name: "Claude Lead",
                agent_id: "claude",
            },
        )
        .await
        .unwrap();
        assert_eq!(assistant.agent_id, "claude");
        let got = <MemoryMetadataRepo as IAssistantDefinitionRepository>::get_by_assistant_id(
            &repo,
            "asst-claude",
        )
        .await
        .unwrap();
        assert!(got.is_some());
    }
}

