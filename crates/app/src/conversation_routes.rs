//! Minimal conversation HTTP surface so team UI can load chat context (F1).

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use store::{
    ConversationRowUpdate, IConversationRepository, MemoryConversationRepo, MessagePageParams,
};
use team_common::now_ms;

#[derive(Clone)]
pub struct ConversationRouterState {
    pub repo: Arc<MemoryConversationRepo>,
}

#[derive(Serialize)]
struct ApiOk<T: Serialize> {
    success: bool,
    data: T,
}

impl<T: Serialize> ApiOk<T> {
    fn new(data: T) -> Self {
        Self {
            success: true,
            data,
        }
    }
}

#[derive(Serialize)]
struct ApiErr {
    success: bool,
    error: String,
    code: String,
}

fn not_found(msg: impl Into<String>) -> (StatusCode, Json<ApiErr>) {
    (
        StatusCode::NOT_FOUND,
        Json(ApiErr {
            success: false,
            error: msg.into(),
            code: "NOT_FOUND".into(),
        }),
    )
}

fn bad_request(msg: impl Into<String>) -> (StatusCode, Json<ApiErr>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ApiErr {
            success: false,
            error: msg.into(),
            code: "BAD_REQUEST".into(),
        }),
    )
}

/// Frontend-facing conversation DTO (extra/model as JSON values).
#[derive(Serialize)]
struct ConversationDto {
    id: String,
    user_id: String,
    name: String,
    #[serde(rename = "type")]
    r#type: String,
    extra: serde_json::Value,
    model: Option<serde_json::Value>,
    status: Option<String>,
    pinned: bool,
    created_at: i64,
    updated_at: i64,
}

fn row_to_dto(row: store::models::ConversationRow) -> ConversationDto {
    let extra = serde_json::from_str(&row.extra).unwrap_or_else(|_| serde_json::json!({}));
    let model = row
        .model
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    ConversationDto {
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        r#type: row.r#type,
        extra,
        model,
        status: row.status,
        pinned: row.pinned,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[derive(Serialize)]
struct MessageDto {
    id: String,
    conversation_id: String,
    msg_id: Option<String>,
    #[serde(rename = "type")]
    r#type: String,
    content: serde_json::Value,
    status: Option<String>,
    hidden: bool,
    created_at: i64,
}

fn message_to_dto(row: store::models::MessageRow) -> MessageDto {
    let content = serde_json::from_str(&row.content)
        .unwrap_or_else(|_| serde_json::Value::String(row.content.clone()));
    MessageDto {
        id: row.id,
        conversation_id: row.conversation_id,
        msg_id: row.msg_id,
        r#type: row.r#type,
        content,
        status: row.status,
        hidden: row.hidden,
        created_at: row.created_at,
    }
}

pub fn conversation_routes(state: ConversationRouterState) -> Router {
    Router::new()
        .route(
            "/api/conversations/{id}",
            get(get_conversation).patch(update_conversation),
        )
        .route("/api/conversations/{id}/messages", get(list_messages))
        .with_state(state)
}

async fn get_conversation(
    State(state): State<ConversationRouterState>,
    Path(id): Path<String>,
) -> Result<Json<ApiOk<ConversationDto>>, (StatusCode, Json<ApiErr>)> {
    let row = state
        .repo
        .get(&id)
        .await
        .map_err(|e| bad_request(e.to_string()))?
        .ok_or_else(|| not_found(format!("conversation not found: {id}")))?;
    Ok(Json(ApiOk::new(row_to_dto(row))))
}

#[derive(Debug, Deserialize)]
struct UpdateConversationBody {
    #[serde(default)]
    updates: Option<serde_json::Value>,
    #[serde(default)]
    merge_extra: Option<bool>,
    // Also accept flat patch fields used by some clients
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    extra: Option<serde_json::Value>,
    #[serde(default)]
    model: Option<serde_json::Value>,
    #[serde(default)]
    status: Option<String>,
}

async fn update_conversation(
    State(state): State<ConversationRouterState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateConversationBody>,
) -> Result<Json<ApiOk<bool>>, (StatusCode, Json<ApiErr>)> {
    let existing = state
        .repo
        .get(&id)
        .await
        .map_err(|e| bad_request(e.to_string()))?
        .ok_or_else(|| not_found(format!("conversation not found: {id}")))?;

    let patch = body.updates.unwrap_or_else(|| {
        let mut obj = serde_json::Map::new();
        if let Some(n) = body.name {
            obj.insert("name".into(), serde_json::Value::String(n));
        }
        if let Some(e) = body.extra {
            obj.insert("extra".into(), e);
        }
        if let Some(m) = body.model {
            obj.insert("model".into(), m);
        }
        if let Some(s) = body.status {
            obj.insert("status".into(), serde_json::Value::String(s));
        }
        serde_json::Value::Object(obj)
    });

    let mut update = ConversationRowUpdate {
        updated_at: Some(now_ms()),
        ..Default::default()
    };

    if let Some(name) = patch.get("name").and_then(|v| v.as_str()) {
        update.name = Some(name.to_owned());
    }
    if let Some(status) = patch.get("status").and_then(|v| v.as_str()) {
        update.status = Some(status.to_owned());
    }
    if let Some(model) = patch.get("model") {
        update.model = Some(model.to_string());
    }
    if let Some(extra_patch) = patch.get("extra") {
        let merge = body.merge_extra.unwrap_or(true);
        if merge {
            let mut current: serde_json::Value =
                serde_json::from_str(&existing.extra).unwrap_or_else(|_| serde_json::json!({}));
            if let (Some(target), Some(source)) = (current.as_object_mut(), extra_patch.as_object())
            {
                for (k, v) in source {
                    target.insert(k.clone(), v.clone());
                }
            }
            update.extra = Some(current.to_string());
        } else {
            update.extra = Some(extra_patch.to_string());
        }
    }

    state
        .repo
        .update(&id, &update)
        .await
        .map_err(|e| bad_request(e.to_string()))?;
    Ok(Json(ApiOk::new(true)))
}

#[derive(Debug, Deserialize)]
struct ListMessagesQuery {
    limit: Option<i64>,
    before_id: Option<String>,
    after_id: Option<String>,
}

#[derive(Serialize)]
struct MessageListDto {
    items: Vec<MessageDto>,
    has_more_before: bool,
    has_more_after: bool,
}

async fn list_messages(
    State(state): State<ConversationRouterState>,
    Path(id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<ApiOk<MessageListDto>>, (StatusCode, Json<ApiErr>)> {
    if state
        .repo
        .get(&id)
        .await
        .map_err(|e| bad_request(e.to_string()))?
        .is_none()
    {
        return Err(not_found(format!("conversation not found: {id}")));
    }
    let page = state
        .repo
        .list_messages_page(
            &id,
            &MessagePageParams {
                limit: query.limit.or(Some(100)),
                before_id: query.before_id,
                after_id: query.after_id,
            },
        )
        .await
        .map_err(|e| bad_request(e.to_string()))?;
    Ok(Json(ApiOk::new(MessageListDto {
        items: page.items.into_iter().map(message_to_dto).collect(),
        has_more_before: page.has_more_before,
        has_more_after: page.has_more_after,
    })))
}
