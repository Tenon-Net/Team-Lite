use api_types::WebSocketMessage;
use tokio::sync::broadcast;
use tracing::warn;

/// Trait for broadcasting WebSocket events to all connected clients.
pub trait EventBroadcaster: Send + Sync {
    fn broadcast(&self, event: WebSocketMessage<serde_json::Value>);
}

/// Default `EventBroadcaster` backed by `tokio::sync::broadcast`.
pub struct BroadcastEventBus {
    tx: broadcast::Sender<WebSocketMessage<serde_json::Value>>,
}

impl BroadcastEventBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _rx) = broadcast::channel(capacity);
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WebSocketMessage<serde_json::Value>> {
        self.tx.subscribe()
    }

    pub fn receiver_count(&self) -> usize {
        self.tx.receiver_count()
    }
}

impl EventBroadcaster for BroadcastEventBus {
    fn broadcast(&self, event: WebSocketMessage<serde_json::Value>) {
        if let Err(e) = self.tx.send(event) {
            warn!(
                event_name = %e.0.name,
                "broadcast failed: no active receivers"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn multi_subscribers_receive_broadcast() {
        let bus = BroadcastEventBus::new(16);
        let mut rx1 = bus.subscribe();
        let mut rx2 = bus.subscribe();
        assert_eq!(bus.receiver_count(), 2);

        let event = WebSocketMessage::new("team.created", json!({"id": "t1"}));
        bus.broadcast(event.clone());

        let a = rx1.try_recv().expect("rx1");
        let b = rx2.try_recv().expect("rx2");
        assert_eq!(a.name, "team.created");
        assert_eq!(b.name, "team.created");
        assert_eq!(a.data["id"], "t1");
    }

    #[test]
    fn dropped_subscriber_does_not_block_others() {
        let bus = BroadcastEventBus::new(8);
        let mut rx_keep = bus.subscribe();
        {
            let _rx_drop = bus.subscribe();
            assert_eq!(bus.receiver_count(), 2);
        }
        // Dropped receiver may still count until lag cleaned; send still works.
        bus.broadcast(WebSocketMessage::new("ping", json!(null)));
        let got = rx_keep.try_recv().expect("kept subscriber receives");
        assert_eq!(got.name, "ping");
    }
}
