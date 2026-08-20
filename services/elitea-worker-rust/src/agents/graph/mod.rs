//! Elitea-owned graph compilation and durable node extensions.
//!
//! ADK-Rust owns graph execution. This module owns the stricter YAML contract,
//! tenant-safe integrations and durability that are not part of the upstream
//! `Checkpoint` model.

mod agent;
mod compiler;
#[cfg(test)]
mod compiler_tests;
mod hitl;
#[cfg(test)]
mod hitl_tests;
mod parallel;
#[cfg(test)]
mod parallel_tests;
mod resume;
mod yaml;

pub use yaml::{
    ParallelBranchDefinition, ParallelConfigurationError, ParallelErrorPolicy,
    ParallelNodeDefinition, ParallelWaitPolicy,
};

pub(crate) use parallel::{
    ParallelActivation, ParallelChildCheckpoint, ParallelChildCheckpointerFactory,
};
