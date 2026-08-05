use crate::error::DbError;
use crate::models::{ConversationRow, MessageRow};
use std::sync::Mutex;
use team_common::{PaginatedResult, TimestampMs, generate_id};

#[derive(Debug, Clone, Default)]
pub struct ConversationFilters {
    pub keyword: Option<String>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ConversationRowUpdate {
    pub name: Option<String>,
    pub extra: Option<String>,
    pub model: Option<String>,
    pub pinned: Option<bool>,
    pub pinned_at: Option<Option<TimestampMs>>,
    pub updated_at: Option<TimestampMs>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct MessagePageParams {
    pub limit: Option<i64>,
    pub before_id: Option<String>,
    pub after_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct MessagePageResult {
    pub items: Vec<MessageRow>,
    pub has_more_before: bool,
    pub has_more_after: bool,
}

#[derive(Debug, Clone, Default)]
pub struct MessageRowUpdate {
    pub content: Option<String>,
    pub status: Option<Option<String>>,
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageSearchRow {
    pub message: MessageRow,
    pub conversation_id: String,
    pub conversation_name: String,
}

use serde::Serialize;

#[async_trait::async_trait]
pub trait IConversationRepository: Send + Sync {
    async fn get(&self, id: &str) -> Result<Option<ConversationRow>, DbError>;
    async fn create(&self, row: &ConversationRow) -> Result<(), DbError>;
    async fn update(&self, id: &str, updates: &ConversationRowUpdate) -> Result<(), DbError>;
    async fn delete(&self, id: &str) -> Result<(), DbError>;
    async fn list_paginated(
        &self,
        user_id: &str,
        filters: &ConversationFilters,
    ) -> Result<PaginatedResult<ConversationRow>, DbError>;
    async fn find_by_source_and_chat(
        &self,
        user_id: &str,
        source: &str,
        chat_id: &str,
        agent_type: &str,
    ) -> Result<Option<ConversationRow>, DbError>;
    async fn list_by_cron_job(
        &self,
        user_id: &str,
        cron_job_id: &str,
    ) -> Result<Vec<ConversationRow>, DbError>;
    async fn list_associated(
        &self,
        user_id: &str,
        conversation_id: &str,
    ) -> Result<Vec<ConversationRow>, DbError>;
    async fn list_messages_page(
        &self,
        conv_id: &str,
        params: &MessagePageParams,
    ) -> Result<MessagePageResult, DbError>;
    async fn insert_message(&self, message: &MessageRow) -> Result<(), DbError>;
    async fn update_message(&self, id: &str, updates: &MessageRowUpdate) -> Result<(), DbError>;
    async fn delete_messages_by_conversation(&self, conv_id: &str) -> Result<(), DbError>;
    async fn get_message_by_msg_id(
        &self,
        conv_id: &str,
        msg_id: &str,
        msg_type: &str,
    ) -> Result<Option<MessageRow>, DbError>;
    async fn search_messages(
        &self,
        user_id: &str,
        keyword: &str,
        page: u32,
        page_size: u32,
    ) -> Result<PaginatedResult<MessageSearchRow>, DbError>;

    /// Convenience used by team projection / turn runner (B3).
    async fn insert_raw_message(&self, message: &MessageRow) -> Result<(), DbError> {
        self.insert_message(message).await
    }

    async fn mint_msg_id(&self) -> Result<String, DbError> {
        Ok(generate_id())
    }
}

#[derive(Default)]
struct MemoryConvState {
    conversations: Vec<ConversationRow>,
    messages: Vec<MessageRow>,
}

/// In-memory conversation + message store (B3).
#[derive(Default)]
pub struct MemoryConversationRepo {
    state: Mutex<MemoryConvState>,
}

impl MemoryConversationRepo {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait::async_trait]
impl IConversationRepository for MemoryConversationRepo {
    async fn get(&self, id: &str) -> Result<Option<ConversationRow>, DbError> {
        let state = self.state.lock().expect("conv lock");
        Ok(state.conversations.iter().find(|c| c.id == id).cloned())
    }

    async fn create(&self, row: &ConversationRow) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("conv lock");
        if state.conversations.iter().any(|c| c.id == row.id) {
            return Err(DbError::Conflict(format!("conversation {}", row.id)));
        }
        state.conversations.push(row.clone());
        Ok(())
    }

    async fn update(&self, id: &str, updates: &ConversationRowUpdate) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("conv lock");
        let conversation = state
            .conversations
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| DbError::NotFound(id.to_owned()))?;
        if let Some(ref extra) = updates.extra {
            conversation.extra = extra.clone();
        }
        if let Some(ref name) = updates.name {
            conversation.name = name.clone();
        }
        if let Some(ref model) = updates.model {
            conversation.model = Some(model.clone());
        }
        if let Some(pinned) = updates.pinned {
            conversation.pinned = pinned;
        }
        if let Some(updated_at) = updates.updated_at {
            conversation.updated_at = updated_at;
        }
        if let Some(ref status) = updates.status {
            conversation.status = Some(status.clone());
        }
        Ok(())
    }

    async fn delete(&self, id: &str) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("conv lock");
        let before = state.conversations.len();
        state.conversations.retain(|c| c.id != id);
        state.messages.retain(|m| m.conversation_id != id);
        if state.conversations.len() == before {
            return Err(DbError::NotFound(id.to_owned()));
        }
        Ok(())
    }

    async fn list_paginated(
        &self,
        user_id: &str,
        _filters: &ConversationFilters,
    ) -> Result<PaginatedResult<ConversationRow>, DbError> {
        let state = self.state.lock().expect("conv lock");
        let items: Vec<_> = state
            .conversations
            .iter()
            .filter(|c| c.user_id == user_id)
            .cloned()
            .collect();
        let total = items.len() as u64;
        Ok(PaginatedResult {
            items,
            total,
            has_more: false,
        })
    }

    async fn find_by_source_and_chat(
        &self,
        user_id: &str,
        source: &str,
        chat_id: &str,
        agent_type: &str,
    ) -> Result<Option<ConversationRow>, DbError> {
        let state = self.state.lock().expect("conv lock");
        Ok(state
            .conversations
            .iter()
            .find(|c| {
                c.user_id == user_id
                    && c.source.as_deref() == Some(source)
                    && c.channel_chat_id.as_deref() == Some(chat_id)
                    && c.r#type == agent_type
            })
            .cloned())
    }

    async fn list_by_cron_job(
        &self,
        _user_id: &str,
        _cron_job_id: &str,
    ) -> Result<Vec<ConversationRow>, DbError> {
        Ok(vec![])
    }

    async fn list_associated(
        &self,
        _user_id: &str,
        _conversation_id: &str,
    ) -> Result<Vec<ConversationRow>, DbError> {
        Ok(vec![])
    }

    async fn list_messages_page(
        &self,
        conv_id: &str,
        params: &MessagePageParams,
    ) -> Result<MessagePageResult, DbError> {
        let state = self.state.lock().expect("conv lock");
        let mut items: Vec<_> = state
            .messages
            .iter()
            .filter(|m| m.conversation_id == conv_id)
            .cloned()
            .collect();
        items.sort_by_key(|m| m.created_at);
        if let Some(limit) = params.limit {
            items.truncate(limit as usize);
        }
        Ok(MessagePageResult {
            items,
            has_more_before: false,
            has_more_after: false,
        })
    }

    async fn insert_message(&self, message: &MessageRow) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("conv lock");
        if state.messages.iter().any(|m| m.id == message.id) {
            return Err(DbError::Conflict(format!("message {}", message.id)));
        }
        state.messages.push(message.clone());
        Ok(())
    }

    async fn update_message(&self, id: &str, updates: &MessageRowUpdate) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("conv lock");
        let message = state
            .messages
            .iter_mut()
            .find(|m| m.id == id)
            .ok_or_else(|| DbError::NotFound(id.to_owned()))?;
        if let Some(ref content) = updates.content {
            message.content = content.clone();
        }
        if let Some(ref status) = updates.status {
            message.status = status.clone();
        }
        if let Some(hidden) = updates.hidden {
            message.hidden = hidden;
        }
        Ok(())
    }

    async fn delete_messages_by_conversation(&self, conv_id: &str) -> Result<(), DbError> {
        self.state
            .lock()
            .expect("conv lock")
            .messages
            .retain(|m| m.conversation_id != conv_id);
        Ok(())
    }

    async fn get_message_by_msg_id(
        &self,
        conv_id: &str,
        msg_id: &str,
        msg_type: &str,
    ) -> Result<Option<MessageRow>, DbError> {
        let state = self.state.lock().expect("conv lock");
        Ok(state
            .messages
            .iter()
            .find(|m| {
                m.conversation_id == conv_id
                    && m.msg_id.as_deref() == Some(msg_id)
                    && m.r#type == msg_type
            })
            .cloned())
    }

    async fn search_messages(
        &self,
        _user_id: &str,
        _keyword: &str,
        _page: u32,
        _page_size: u32,
    ) -> Result<PaginatedResult<MessageSearchRow>, DbError> {
        Ok(PaginatedResult {
            items: vec![],
            total: 0,
            has_more: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_conv(id: &str) -> ConversationRow {
        ConversationRow {
            id: id.into(),
            user_id: "u1".into(),
            name: "c".into(),
            r#type: "acp".into(),
            extra: "{}".into(),
            model: None,
            status: Some("pending".into()),
            source: Some("aionui".into()),
            channel_chat_id: None,
            pinned: false,
            pinned_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[tokio::test]
    async fn insert_and_find_message_by_msg_id() {
        let repo = MemoryConversationRepo::new();
        repo.create(&sample_conv("c1")).await.unwrap();
        let msg = MessageRow {
            id: generate_id(),
            conversation_id: "c1".into(),
            msg_id: Some("m-stream-1".into()),
            r#type: "text".into(),
            content: r#"{"text":"hi"}"#.into(),
            position: Some("left".into()),
            status: Some("finish".into()),
            hidden: false,
            created_at: 1,
        };
        repo.insert_raw_message(&msg).await.unwrap();
        let found = repo
            .get_message_by_msg_id("c1", "m-stream-1", "text")
            .await
            .unwrap();
        assert!(found.is_some());
        let mint = repo.mint_msg_id().await.unwrap();
        assert!(!mint.is_empty());
    }
}
