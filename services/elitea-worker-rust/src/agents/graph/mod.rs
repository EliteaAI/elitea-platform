//! Elitea-owned graph compilation and durable node extensions.
//!
//! ADK-Rust owns graph execution. This module owns the stricter YAML contract,
//! tenant-safe integrations and durability that are not part of the upstream
//! `Checkpoint` model.

mod agent;
pub(crate) mod compiler;
#[cfg(test)]
mod compiler_tests;
mod direct_tool;
#[cfg(test)]
mod direct_tool_tests;
mod hitl;
#[cfg(test)]
mod hitl_tests;
mod llm;
#[cfg(test)]
mod llm_tests;
mod parallel;
#[cfg(test)]
mod parallel_tests;
pub(crate) mod resume;
mod state_modifier;
#[cfg(test)]
mod state_modifier_tests;
mod yaml;

pub(crate) use agent::{
    EliteaGraphAgent, PIPELINE_COMPLETED_CONTENT, PIPELINE_COMPLETED_METADATA_KEY,
    PIPELINE_COMPLETED_METADATA_VALUE, pipeline_completed_event, pipeline_result_event,
};
pub(crate) use direct_tool::{
    DirectToolExecutionError, DirectToolSelection, PipelineDirectToolResolver, ResolvedDirectTool,
};
pub(crate) use llm::{
    LlmExecutionError, LlmExecutionInput, LlmNodeDefinition, PipelineLlmAgentFactory,
};

pub use yaml::{
    ParallelBranchDefinition, ParallelConfigurationError, ParallelErrorPolicy,
    ParallelNodeDefinition, ParallelWaitPolicy,
};

pub(crate) use parallel::{
    ParallelActivation, ParallelChildCheckpoint, ParallelChildCheckpointerFactory,
};
