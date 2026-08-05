use std::sync::Arc;

use store::{BroadcastEventBus, EventBroadcaster};
use tokio::sync::broadcast;

use api_types::WebSocketMessage;

#[derive(Clone)]
pub struct AppState {
    /// Concrete bus so WebSocket handlers can subscribe.
    pub bus: Arc<BroadcastEventBus>,
}

impl AppState {
    pub fn new(bus: Arc<BroadcastEventBus>) -> Self {
        Self { bus }
    }

    pub fn as_broadcaster(&self) -> Arc<dyn EventBroadcaster> {
        self.bus.clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WebSocketMessage<serde_json::Value>> {
        self.bus.subscribe()
    }
}
