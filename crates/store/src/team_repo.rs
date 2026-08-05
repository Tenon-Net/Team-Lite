use crate::error::DbError;
use crate::models::{MailboxMessageRow, TeamRow, TeamTaskRow};
use std::sync::Mutex;
use team_common::now_ms;

/// Parameters for updating a team record.
#[derive(Debug, Clone, Default)]
pub struct UpdateTeamParams {
    pub name: Option<String>,
    pub workspace: Option<String>,
    pub agents: Option<String>,
    pub lead_agent_id: Option<String>,
    pub session_mode: Option<String>,
}

/// Parameters for updating a task record.
#[derive(Debug, Clone, Default)]
pub struct UpdateTaskParams {
    pub status: Option<String>,
    pub description: Option<String>,
    pub owner: Option<String>,
    pub blocked_by: Option<String>,
    pub metadata: Option<String>,
}

/// Data access abstraction for team collaboration tables.
#[async_trait::async_trait]
pub trait ITeamRepository: Send + Sync {
    async fn create_team(&self, row: &TeamRow) -> Result<(), DbError>;
    async fn list_teams(&self) -> Result<Vec<TeamRow>, DbError>;
    async fn list_teams_by_user(&self, user_id: &str) -> Result<Vec<TeamRow>, DbError>;
    async fn list_archived_teams_by_user(&self, _user_id: &str) -> Result<Vec<TeamRow>, DbError> {
        Ok(Vec::new())
    }
    async fn get_team(&self, team_id: &str) -> Result<Option<TeamRow>, DbError>;
    async fn update_team(&self, team_id: &str, params: &UpdateTeamParams) -> Result<(), DbError>;
    async fn archive_team(&self, team_id: &str) -> Result<(), DbError> {
        Err(DbError::NotFound(format!("team {team_id}")))
    }
    async fn delete_team(&self, team_id: &str) -> Result<(), DbError>;

    async fn write_message(&self, row: &MailboxMessageRow) -> Result<(), DbError>;
    async fn read_unread_and_mark(
        &self,
        team_id: &str,
        to_agent_id: &str,
    ) -> Result<Vec<MailboxMessageRow>, DbError>;
    async fn peek_unread(
        &self,
        team_id: &str,
        to_agent_id: &str,
    ) -> Result<Vec<MailboxMessageRow>, DbError>;
    async fn mark_read_batch(&self, ids: &[String]) -> Result<(), DbError>;
    async fn update_message_summary(&self, message_id: &str, summary: &str) -> Result<(), DbError>;
    async fn get_history(
        &self,
        team_id: &str,
        to_agent_id: &str,
        limit: Option<i64>,
    ) -> Result<Vec<MailboxMessageRow>, DbError>;
    async fn delete_mailbox_by_team(&self, team_id: &str) -> Result<(), DbError>;

    async fn create_task(&self, row: &TeamTaskRow) -> Result<(), DbError>;
    async fn find_task_by_id(
        &self,
        team_id: &str,
        task_id: &str,
    ) -> Result<Option<TeamTaskRow>, DbError>;
    async fn update_task(&self, task_id: &str, params: &UpdateTaskParams) -> Result<(), DbError>;
    async fn list_tasks(&self, team_id: &str) -> Result<Vec<TeamTaskRow>, DbError>;
    async fn append_to_blocks(&self, task_id: &str, blocked_task_id: &str) -> Result<(), DbError>;
    async fn remove_from_blocked_by(
        &self,
        task_id: &str,
        unblocked_task_id: &str,
    ) -> Result<(), DbError>;
    async fn delete_tasks_by_team(&self, team_id: &str) -> Result<(), DbError>;
}

#[derive(Default)]
struct MemoryState {
    teams: Vec<TeamRow>,
    messages: Vec<MailboxMessageRow>,
    tasks: Vec<TeamTaskRow>,
}

/// In-memory `ITeamRepository` for tests and early bring-up (B2).
#[derive(Default)]
pub struct MemoryTeamRepo {
    state: Mutex<MemoryState>,
}

impl MemoryTeamRepo {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait::async_trait]
impl ITeamRepository for MemoryTeamRepo {
    async fn create_team(&self, row: &TeamRow) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        if state.teams.iter().any(|t| t.id == row.id) {
            return Err(DbError::Conflict(format!("team {}", row.id)));
        }
        state.teams.push(row.clone());
        Ok(())
    }

    async fn list_teams(&self) -> Result<Vec<TeamRow>, DbError> {
        let state = self.state.lock().expect("team repo lock");
        Ok(state
            .teams
            .iter()
            .filter(|t| t.archived_at.is_none())
            .cloned()
            .collect())
    }

    async fn list_teams_by_user(&self, user_id: &str) -> Result<Vec<TeamRow>, DbError> {
        let state = self.state.lock().expect("team repo lock");
        Ok(state
            .teams
            .iter()
            .filter(|t| t.user_id == user_id && t.archived_at.is_none())
            .cloned()
            .collect())
    }

    async fn list_archived_teams_by_user(&self, user_id: &str) -> Result<Vec<TeamRow>, DbError> {
        let state = self.state.lock().expect("team repo lock");
        Ok(state
            .teams
            .iter()
            .filter(|t| t.user_id == user_id && t.archived_at.is_some())
            .cloned()
            .collect())
    }

    async fn get_team(&self, team_id: &str) -> Result<Option<TeamRow>, DbError> {
        let state = self.state.lock().expect("team repo lock");
        Ok(state.teams.iter().find(|t| t.id == team_id).cloned())
    }

    async fn update_team(&self, team_id: &str, params: &UpdateTeamParams) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        let team = state
            .teams
            .iter_mut()
            .find(|t| t.id == team_id)
            .ok_or_else(|| DbError::NotFound(format!("team {team_id}")))?;
        if let Some(ref name) = params.name {
            team.name = name.clone();
        }
        if let Some(ref workspace) = params.workspace {
            team.workspace = workspace.clone();
        }
        if let Some(ref agents) = params.agents {
            team.agents = agents.clone();
        }
        if let Some(ref lead) = params.lead_agent_id {
            team.lead_agent_id = Some(lead.clone());
        }
        if let Some(ref mode) = params.session_mode {
            team.session_mode = Some(mode.clone());
        }
        team.updated_at = now_ms();
        Ok(())
    }

    async fn archive_team(&self, team_id: &str) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        let team = state
            .teams
            .iter_mut()
            .find(|t| t.id == team_id)
            .ok_or_else(|| DbError::NotFound(format!("team {team_id}")))?;
        team.archived_at = Some(now_ms());
        team.updated_at = now_ms();
        Ok(())
    }

    async fn delete_team(&self, team_id: &str) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        let before = state.teams.len();
        state.teams.retain(|t| t.id != team_id);
        if state.teams.len() == before {
            return Err(DbError::NotFound(format!("team {team_id}")));
        }
        Ok(())
    }

    async fn write_message(&self, row: &MailboxMessageRow) -> Result<(), DbError> {
        self.state
            .lock()
            .expect("team repo lock")
            .messages
            .push(row.clone());
        Ok(())
    }

    async fn read_unread_and_mark(
        &self,
        team_id: &str,
        to_agent_id: &str,
    ) -> Result<Vec<MailboxMessageRow>, DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        let mut result = vec![];
        for msg in &mut state.messages {
            if msg.team_id == team_id && msg.to_agent_id == to_agent_id && !msg.read {
                msg.read = true;
                result.push(msg.clone());
            }
        }
        Ok(result)
    }

    async fn peek_unread(
        &self,
        team_id: &str,
        to_agent_id: &str,
    ) -> Result<Vec<MailboxMessageRow>, DbError> {
        let state = self.state.lock().expect("team repo lock");
        Ok(state
            .messages
            .iter()
            .filter(|m| m.team_id == team_id && m.to_agent_id == to_agent_id && !m.read)
            .cloned()
            .collect())
    }

    async fn mark_read_batch(&self, ids: &[String]) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        for msg in &mut state.messages {
            if ids.contains(&msg.id) {
                msg.read = true;
            }
        }
        Ok(())
    }

    async fn update_message_summary(&self, message_id: &str, summary: &str) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        let msg = state
            .messages
            .iter_mut()
            .find(|m| m.id == message_id)
            .ok_or_else(|| DbError::NotFound(format!("mailbox message {message_id}")))?;
        msg.summary = Some(summary.to_owned());
        Ok(())
    }

    async fn get_history(
        &self,
        team_id: &str,
        to_agent_id: &str,
        limit: Option<i64>,
    ) -> Result<Vec<MailboxMessageRow>, DbError> {
        let state = self.state.lock().expect("team repo lock");
        let iter = state
            .messages
            .iter()
            .filter(|m| m.team_id == team_id && m.to_agent_id == to_agent_id);
        Ok(match limit {
            Some(n) => iter.take(n as usize).cloned().collect(),
            None => iter.cloned().collect(),
        })
    }

    async fn delete_mailbox_by_team(&self, team_id: &str) -> Result<(), DbError> {
        self.state
            .lock()
            .expect("team repo lock")
            .messages
            .retain(|m| m.team_id != team_id);
        Ok(())
    }

    async fn create_task(&self, row: &TeamTaskRow) -> Result<(), DbError> {
        self.state
            .lock()
            .expect("team repo lock")
            .tasks
            .push(row.clone());
        Ok(())
    }

    async fn find_task_by_id(
        &self,
        team_id: &str,
        task_id: &str,
    ) -> Result<Option<TeamTaskRow>, DbError> {
        let state = self.state.lock().expect("team repo lock");
        Ok(state
            .tasks
            .iter()
            .find(|t| t.team_id == team_id && t.id == task_id)
            .cloned())
    }

    async fn update_task(&self, task_id: &str, params: &UpdateTaskParams) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        let task = state
            .tasks
            .iter_mut()
            .find(|t| t.id == task_id)
            .ok_or_else(|| DbError::NotFound(task_id.to_owned()))?;
        if let Some(ref s) = params.status {
            task.status = s.clone();
        }
        if let Some(ref d) = params.description {
            task.description = Some(d.clone());
        }
        if let Some(ref o) = params.owner {
            task.owner = Some(o.clone());
        }
        if let Some(ref b) = params.blocked_by {
            task.blocked_by = b.clone();
        }
        if let Some(ref m) = params.metadata {
            task.metadata = Some(m.clone());
        }
        task.updated_at = now_ms();
        Ok(())
    }

    async fn list_tasks(&self, team_id: &str) -> Result<Vec<TeamTaskRow>, DbError> {
        let state = self.state.lock().expect("team repo lock");
        Ok(state
            .tasks
            .iter()
            .filter(|t| t.team_id == team_id)
            .cloned()
            .collect())
    }

    async fn append_to_blocks(&self, task_id: &str, blocked_task_id: &str) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        let task = state
            .tasks
            .iter_mut()
            .find(|t| t.id == task_id)
            .ok_or_else(|| DbError::NotFound(task_id.to_owned()))?;
        let mut blocks: Vec<String> = serde_json::from_str(&task.blocks).unwrap_or_default();
        if !blocks.iter().any(|id| id == blocked_task_id) {
            blocks.push(blocked_task_id.to_owned());
        }
        task.blocks = serde_json::to_string(&blocks).unwrap_or_else(|_| "[]".into());
        task.updated_at = now_ms();
        Ok(())
    }

    async fn remove_from_blocked_by(
        &self,
        task_id: &str,
        unblocked_task_id: &str,
    ) -> Result<(), DbError> {
        let mut state = self.state.lock().expect("team repo lock");
        let task = state
            .tasks
            .iter_mut()
            .find(|t| t.id == task_id)
            .ok_or_else(|| DbError::NotFound(task_id.to_owned()))?;
        let mut blocked_by: Vec<String> = serde_json::from_str(&task.blocked_by).unwrap_or_default();
        blocked_by.retain(|id| id != unblocked_task_id);
        task.blocked_by = serde_json::to_string(&blocked_by).unwrap_or_else(|_| "[]".into());
        task.updated_at = now_ms();
        Ok(())
    }

    async fn delete_tasks_by_team(&self, team_id: &str) -> Result<(), DbError> {
        self.state
            .lock()
            .expect("team repo lock")
            .tasks
            .retain(|t| t.team_id != team_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use team_common::generate_id;

    fn sample_team(id: &str) -> TeamRow {
        TeamRow {
            id: id.into(),
            user_id: "system_default_user".into(),
            name: "t".into(),
            workspace: "/tmp".into(),
            workspace_mode: "shared".into(),
            agents: "[]".into(),
            lead_agent_id: None,
            session_mode: None,
            agents_version: "1".into(),
            created_at: 1,
            updated_at: 1,
            archived_at: None,
        }
    }

    #[tokio::test]
    async fn mailbox_unread_mark_and_history() {
        let repo = MemoryTeamRepo::new();
        let msg = MailboxMessageRow {
            id: generate_id(),
            team_id: "team-1".into(),
            to_agent_id: "a1".into(),
            from_agent_id: "a2".into(),
            msg_type: "message".into(),
            content: "hi".into(),
            summary: None,
            files: None,
            read: false,
            created_at: 1,
        };
        repo.write_message(&msg).await.unwrap();
        let peeked = repo.peek_unread("team-1", "a1").await.unwrap();
        assert_eq!(peeked.len(), 1);
        let read = repo.read_unread_and_mark("team-1", "a1").await.unwrap();
        assert_eq!(read.len(), 1);
        assert!(repo.peek_unread("team-1", "a1").await.unwrap().is_empty());
        let hist = repo.get_history("team-1", "a1", None).await.unwrap();
        assert_eq!(hist.len(), 1);
        assert!(hist[0].read);
    }

    #[tokio::test]
    async fn team_crud_and_tasks() {
        let repo = MemoryTeamRepo::new();
        repo.create_team(&sample_team("t1")).await.unwrap();
        assert!(repo.get_team("t1").await.unwrap().is_some());
        repo.update_team(
            "t1",
            &UpdateTeamParams {
                name: Some("renamed".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(repo.get_team("t1").await.unwrap().unwrap().name, "renamed");

        let task = TeamTaskRow {
            id: "task-1".into(),
            team_id: "t1".into(),
            subject: "do".into(),
            description: None,
            status: "pending".into(),
            owner: Some("a1".into()),
            blocked_by: "[]".into(),
            blocks: "[]".into(),
            metadata: None,
            created_at: 1,
            updated_at: 1,
        };
        repo.create_task(&task).await.unwrap();
        repo.append_to_blocks("task-1", "task-2").await.unwrap();
        let found = repo.find_task_by_id("t1", "task-1").await.unwrap().unwrap();
        assert!(found.blocks.contains("task-2"));
    }
}
