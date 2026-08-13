//! Durable worker-owned execution state.
//!
//! Product records and migrations remain owned by Elitea Main. This module is
//! limited to execution-local state whose schema is versioned with the Rust
//! runtime lineage.

mod postgres_checkpointer;
#[cfg(test)]
mod postgres_checkpointer_tests;

pub use postgres_checkpointer::{CheckpointLimits, PostgresCheckpointError, PostgresCheckpointer};
