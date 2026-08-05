//! Team-facing API DTOs ported from `aionui-api-types` (team subset only).
//!
//! No axum / tower / HTTP framework dependencies.

/// Milliseconds since Unix epoch (same as upstream `aionui_common::TimestampMs`).
pub type TimestampMs = i64;

mod extras;
mod team;
mod team_mcp;
mod team_tools;
mod websocket;

pub use extras::*;
pub use team::*;
pub use team_mcp::*;
pub use team_tools::*;
pub use websocket::*;
