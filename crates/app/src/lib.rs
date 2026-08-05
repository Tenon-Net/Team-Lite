//! Application assembly: wiring store + acp + team routes (D1).

pub mod adapters;
pub mod conversation_routes;
pub mod seed;
pub mod state;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Extension;
use axum::response::IntoResponse;
use axum::routing::get;
use store::{BroadcastEventBus, MemoryConversationRepo, MemoryMetadataRepo, MemoryTeamRepo};
use team::acp_turn_adapter::AcpTurnPort;
use team::{TeamRouterState, TeamSessionService, team_routes};
use team_auth::CurrentUser;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::adapters::{EmptyAssistantCatalog, MemoryConversationPorts, ProjectionStoreAdapter};
use crate::conversation_routes::{ConversationRouterState, conversation_routes};
use crate::seed::seed_runtime_agents;
use crate::state::AppState;

/// Build the full HTTP router (team API + health + websocket).
pub async fn build_app(data_dir: PathBuf) -> Result<Router, String> {
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let workspace_root = data_dir.join("workspaces");
    std::fs::create_dir_all(&workspace_root).map_err(|e| e.to_string())?;

    let team_repo = Arc::new(MemoryTeamRepo::new());
    let conv_repo = Arc::new(MemoryConversationRepo::new());
    let meta_repo = Arc::new(MemoryMetadataRepo::new());
    seed_runtime_agents(meta_repo.as_ref())
        .await
        .map_err(|e| e.to_string())?;

    let bus = Arc::new(BroadcastEventBus::new(256));
    let task_manager = Arc::new(acp::WorkerTaskManager::new(workspace_root.clone()));
    let turn_port = Arc::new(AcpTurnPort::new(
        conv_repo.clone(),
        bus.clone(),
        "grok",
        workspace_root.clone(),
    ));

    let conversation_ports = Arc::new(MemoryConversationPorts::new(
        conv_repo.clone(),
        workspace_root.clone(),
    ));
    let projection = Arc::new(ProjectionStoreAdapter::new(conv_repo.clone()));
    let assistant_catalog = Arc::new(EmptyAssistantCatalog);

    let service = TeamSessionService::new(
        team_repo,
        meta_repo.clone(),
        assistant_catalog,
        meta_repo.clone(),
        meta_repo.clone(),
        conversation_ports,
        projection,
        bus.clone(),
        task_manager,
        turn_port.clone(),
        turn_port,
        Arc::new(std::env::current_exe().unwrap_or_else(|_| PathBuf::from("team-lite"))),
    );

    let active_leases = Arc::new(acp::ActiveLeaseRegistry::new());
    let team_state = TeamRouterState {
        service,
        active_leases,
    };

    let app_state = AppState::new(bus);

    let conv_state = ConversationRouterState {
        repo: conv_repo.clone(),
    };

    // Team routes carry their own State<TeamRouterState>; WS uses Extension<AppState>.
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
        .merge(team_routes(team_state))
        .merge(conversation_routes(conv_state))
        .layer(Extension(app_state))
        .layer(Extension(CurrentUser::system_default()))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    Ok(app)
}

/// Run the server on `addr` (default 127.0.0.1:3000).
pub async fn run(addr: SocketAddr, data_dir: PathBuf) -> Result<(), String> {
    let app = build_app(data_dir).await?;
    info!(%addr, "team-lite listening");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| e.to_string())?;
    axum::serve(listener, app).await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Extension(state): Extension<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let mut rx = state.subscribe();
    loop {
        match rx.recv().await {
            Ok(event) => {
                let payload = match serde_json::to_string(&event) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                if socket.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}
