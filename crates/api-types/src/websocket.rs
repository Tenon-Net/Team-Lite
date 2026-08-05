use serde::{Deserialize, Serialize};

/// WebSocket message envelope (from upstream `aionui-api-types::websocket`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketMessage<T> {
    pub name: String,
    pub data: T,
}

impl<T> WebSocketMessage<T> {
    pub fn new(name: impl Into<String>, data: T) -> Self {
        Self {
            name: name.into(),
            data,
        }
    }
}
