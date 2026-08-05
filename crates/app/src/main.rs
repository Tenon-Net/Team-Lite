//! team-lite server entrypoint.

use std::net::SocketAddr;
use std::path::PathBuf;

use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let addr: SocketAddr = std::env::var("TEAM_LITE_ADDR")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 3000)));

    let data_dir = std::env::var("TEAM_LITE_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::temp_dir().join(format!("team-lite-{}", std::process::id()))
        });

    if let Err(e) = app::run(addr, data_dir).await {
        eprintln!("team-lite failed: {e}");
        std::process::exit(1);
    }
}
