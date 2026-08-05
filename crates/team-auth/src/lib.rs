//! Single-user stand-in for upstream `aionui_auth::CurrentUser` (B5).

/// Authenticated user injected into request extensions.
///
/// Team-Lite is single-user; handlers still accept this type for route shape
/// compatibility with the ported `routes.rs`.
#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub id: String,
    pub username: String,
}

impl CurrentUser {
    /// Default local operator (matches upstream test fixture `system_default_user`).
    pub fn system_default() -> Self {
        Self {
            id: "system_default_user".into(),
            username: "local".into(),
        }
    }
}

impl Default for CurrentUser {
    fn default() -> Self {
        Self::system_default()
    }
}
