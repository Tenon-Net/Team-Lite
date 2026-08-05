//! SQLite / in-memory persistence and realtime broadcast stand-ins.

mod broadcaster;
mod conversation_repo;
mod error;
mod metadata_repo;
pub mod models;
mod team_repo;

pub use broadcaster::{BroadcastEventBus, EventBroadcaster};
pub use conversation_repo::{
    ConversationFilters, ConversationRowUpdate, IConversationRepository, MemoryConversationRepo,
    MessagePageParams, MessagePageResult, MessageRowUpdate, MessageSearchRow,
};
pub use error::DbError;
pub use metadata_repo::{
    CreateProviderParams, IAgentMetadataRepository, IAssistantDefinitionRepository,
    IAssistantOverlayRepository, IProviderRepository, MemoryMetadataRepo, UpdateProviderParams,
};
pub use models::{
    AgentBindingResolution, UpdateAgentHandshakeParams, UpsertAgentMetadataParams,
    UpsertAssistantDefinitionParams, UpsertAssistantOverlayParams, binding_resolution_for_agent,
    resolve_agent_binding_from_rows, runtime_backend_for_agent,
};
pub use team_repo::{ITeamRepository, MemoryTeamRepo, UpdateTaskParams, UpdateTeamParams};
