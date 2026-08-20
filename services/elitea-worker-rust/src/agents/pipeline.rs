//! Authorized stored-pipeline admission before any provider or tool authority.
//!
//! Pipeline HITL is a YAML graph node and never uses the direct sensitive-tool
//! confirmation path. This module binds the frozen application shell to the
//! graph compiler while production state-service composition remains closed.

#![allow(dead_code)] // The pipeline assembler is the next capability-gated slice.

use super::assembly::OrdinaryNoToolProfile;
use super::graph::compiler::{PipelineConfigurationError, PipelineDefinition};
use super::request::AgentExecutionRequest;
use super::runtime::{NativeAgentAssemblyError, NativeAgentAssemblyErrorCode};

/// Frozen, fully admitted application pipeline definition.
pub(crate) struct PipelineExecutionProfile {
    shell: OrdinaryNoToolProfile,
    definition: PipelineDefinition,
}

impl PipelineExecutionProfile {
    /// Admit a saved pipeline without constructing a model, tool or credential.
    pub(crate) fn validate(
        request: &AgentExecutionRequest,
        resume: bool,
    ) -> Result<Self, NativeAgentAssemblyError> {
        let shell = OrdinaryNoToolProfile::validate_pipeline_shell(request, resume)?;
        let definition = PipelineDefinition::from_yaml(shell.instructions())
            .map_err(|error| pipeline_configuration_error(&error))?;
        Ok(Self { shell, definition })
    }

    #[must_use]
    pub(crate) const fn shell(&self) -> &OrdinaryNoToolProfile {
        &self.shell
    }

    #[must_use]
    pub(crate) const fn definition(&self) -> &PipelineDefinition {
        &self.definition
    }
}

fn pipeline_configuration_error(error: &PipelineConfigurationError) -> NativeAgentAssemblyError {
    let code = match error.code() {
        "graph.pipeline.configuration_resource_exhausted" => {
            NativeAgentAssemblyErrorCode::ResourceExhausted
        }
        "graph.pipeline.unsupported_capability" => {
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        }
        "graph.pipeline.malformed_yaml" | "graph.pipeline.invalid_configuration" => {
            NativeAgentAssemblyErrorCode::InvalidInput
        }
        _ => NativeAgentAssemblyErrorCode::InvalidConfiguration,
    };
    NativeAgentAssemblyError::new(code, "the stored pipeline definition could not be admitted")
}
