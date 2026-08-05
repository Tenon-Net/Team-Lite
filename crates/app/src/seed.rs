//! Runtime seed data (D2): claude / codex / grok agent_metadata rows.

use store::models::{UpsertAgentMetadataParams, UpsertAssistantDefinitionParams};
use store::{IAgentMetadataRepository, IAssistantDefinitionRepository, MemoryMetadataRepo};
use tracing::info;

/// Insert the three local ACP runtimes + matching assistant definitions.
pub async fn seed_runtime_agents(meta: &MemoryMetadataRepo) -> Result<(), store::DbError> {
    let agents = [
        UpsertAgentMetadataParams {
            id: "claude",
            name: "Claude",
            description: Some("Claude Code via ACP bridge"),
            backend: Some("claude"),
            agent_type: "acp",
            agent_source: "builtin",
            enabled: true,
            command: Some(r"C:\Program Files\nodejs\npx.cmd"),
            args: Some(r#"["-y","@agentclientprotocol/claude-agent-acp@0.39.0"]"#),
            yolo_id: Some("bypassPermissions"),
            sort_order: 10,
            ..Default::default()
        },
        UpsertAgentMetadataParams {
            id: "codex",
            name: "Codex",
            description: Some("OpenAI Codex via ACP bridge"),
            backend: Some("codex"),
            agent_type: "acp",
            agent_source: "builtin",
            enabled: true,
            command: Some(r"C:\Program Files\nodejs\npx.cmd"),
            args: Some(r#"["-y","@zed-industries/codex-acp@0.14.0"]"#),
            yolo_id: Some("agent-full-access"),
            sort_order: 20,
            ..Default::default()
        },
        UpsertAgentMetadataParams {
            id: "grok",
            name: "Grok",
            description: Some("Grok CLI agent stdio ACP"),
            backend: Some("grok"),
            agent_type: "acp",
            agent_source: "builtin",
            enabled: true,
            command: Some(r"C:\Users\Administrator\.grok\bin\grok.exe"),
            args: Some(r#"["agent","stdio"]"#),
            yolo_id: None,
            sort_order: 30,
            ..Default::default()
        },
    ];

    for a in agents {
        IAgentMetadataRepository::upsert(meta, &a).await?;
        info!(id = a.id, "seeded agent_metadata");
    }

    let defs = [
        ("def-claude", "asst-claude", "Claude Lead", "claude"),
        ("def-grok", "asst-grok", "Grok Worker", "grok"),
        ("def-codex", "asst-codex", "Codex Reviewer", "codex"),
    ];
    for (id, asst_id, name, agent_id) in defs {
        IAssistantDefinitionRepository::upsert(
            meta,
            &UpsertAssistantDefinitionParams {
                id,
                assistant_id: asst_id,
                name,
                agent_id,
            },
        )
        .await?;
        info!(assistant_id = asst_id, "seeded assistant_definition");
    }

    Ok(())
}
