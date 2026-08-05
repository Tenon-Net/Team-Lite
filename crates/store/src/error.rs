/// Database-layer errors (sqlx-free stand-in for upstream `aionui_db::DbError`).
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Database query failed: {0}")]
    Query(String),

    #[error("Migration failed: {0}")]
    Migration(String),

    #[error("Record not found: {0}")]
    NotFound(String),

    #[error("Duplicate record: {0}")]
    Conflict(String),

    #[error("Database initialization failed: {0}")]
    Init(String),
}
