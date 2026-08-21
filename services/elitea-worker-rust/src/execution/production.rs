//! Production composition of the already-proven agent delivery/runtime pieces.

#![allow(dead_code)] // Capability registration and process signals remain closed.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;
use tonic::transport::Channel;

use super::agent_delivery_processor::{AgentDeliveryProcessor, native_agent_delivery_processor};
use super::agent_lease::SystemUnixMillisClock;
use super::agent_preparation::AgentPreparationConfig;
use super::invocation_admission::{InvocationAdmission, InvocationAdmissionConfig};
use super::native_agent_lifecycle::NativeAuthorizedAgentLifecycle;
use super::output_delivery::{AgentOutputPreflight, AgentTerminalRecoveryConfig};
use super::redis_delivery::{
    RedisDeliveryIntakeConfig, RedisDeliveryRuntime, RedisDeliveryRuntimeConfig,
};
use crate::agents::native_runtime::NativeRuntimeAssembler;
use crate::agents::ordinary::OrdinaryNativeAgentAssembler;
use crate::agents::pipeline::PipelineNativeAgentAssembler;
use crate::bootstrap::ProductionTransportBundle;
use crate::spool::SpoolLimits;
use crate::state::{CheckpointLimits, SessionLimits};
use crate::toolkits::ToolAdmissionPolicy;
use crate::transport::redis_commands::{RedisCommandRetirer, RedisRetirementConfig};
use crate::transport::redis_connector::ProductionRedisConnector;
use crate::transport::redis_generation::RedisStreamsHandle;
use crate::transport::{OutputGrpcConfig, TonicControlRpc};

type ProductionAssembler =
    NativeRuntimeAssembler<OrdinaryNativeAgentAssembler, PipelineNativeAgentAssembler>;
type ProductionRedis = Arc<RedisStreamsHandle<ProductionRedisConnector>>;
type ProductionLifecycle = NativeAuthorizedAgentLifecycle<
    ProductionAssembler,
    Channel,
    TonicControlRpc,
    ProductionRedis,
    SystemUnixMillisClock,
>;
type ProductionProcessor = AgentDeliveryProcessor<
    TonicControlRpc,
    ProductionRedis,
    Channel,
    SystemUnixMillisClock,
    ProductionLifecycle,
    crate::transport::InputContentClient,
>;

/// Stable composition failure before Redis intake or command authority exists.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProductionRuntimeBuildError;

impl fmt::Display for ProductionRuntimeBuildError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the production agent runtime configuration is invalid")
    }
}

impl std::error::Error for ProductionRuntimeBuildError {}

/// One process-owned Redis delivery runtime plus its native invocation drain
/// owner. Construction requires the authoritative policy explicitly; there is
/// no default or missing-policy branch.
pub(crate) struct ProductionAgentRuntime {
    delivery: RedisDeliveryRuntime<ProductionRedisConnector, ProductionProcessor>,
    processor: Arc<ProductionProcessor>,
}

impl ProductionAgentRuntime {
    /// Consume connected dependencies and bind both direct and graph agents to
    /// one exact frozen toolkit-security policy.
    #[allow(clippy::too_many_lines)] // Keep the security-significant ownership handoff linear.
    pub(crate) fn from_bundle(
        bundle: ProductionTransportBundle,
        tool_policy: Arc<ToolAdmissionPolicy>,
    ) -> Result<Self, ProductionRuntimeBuildError> {
        let ProductionTransportBundle {
            deployment,
            command_authenticator,
            spool_root,
            spool_master_key,
            redis,
            control,
            output,
            input,
            platform,
            model_facade,
            agentstate,
        } = bundle;
        let limits = deployment.limits;
        let output_config = OutputGrpcConfig {
            max_queued_frames: limits.output_max_queued_frames,
            max_queued_bytes: limits.output_max_queued_bytes,
            max_frame_bytes: limits.output_max_frame_bytes(),
            max_server_credit_frames: u32::try_from(limits.output_max_queued_frames)
                .map_err(|_| ProductionRuntimeBuildError)?,
            max_server_credit_bytes: u64::try_from(limits.output_max_queued_bytes)
                .map_err(|_| ProductionRuntimeBuildError)?,
            stream_deadline: Duration::from_millis(limits.output_stream_deadline_millis),
            ack_timeout: Duration::from_millis(limits.output_ack_timeout_millis),
            workload_session_id: deployment.workload_session_id.clone(),
            producer_id: deployment.producer_id.clone(),
        };
        let spool_overhead = limits
            .output_max_queued_frames
            .checked_mul(64)
            .and_then(|value| u64::try_from(value).ok())
            .ok_or(ProductionRuntimeBuildError)?;
        let max_encrypted_bytes = u64::try_from(limits.output_max_queued_bytes)
            .ok()
            .and_then(|value| value.checked_add(spool_overhead))
            .ok_or(ProductionRuntimeBuildError)?;
        let output_preflight = AgentOutputPreflight::new(
            spool_root,
            spool_master_key,
            SpoolLimits {
                max_frames: limits.output_max_queued_frames,
                max_encrypted_bytes,
                max_frame_bytes: limits.output_max_frame_bytes(),
            },
            output_config,
        );
        let retirer = Arc::new(
            RedisCommandRetirer::new(
                Arc::clone(&redis),
                RedisRetirementConfig {
                    stream: deployment.redis_stream.clone(),
                    group: deployment.redis_group.clone(),
                    consumer: deployment.consumer_id.clone(),
                },
            )
            .map_err(|_| ProductionRuntimeBuildError)?,
        );
        let admission = InvocationAdmission::new(
            InvocationAdmissionConfig::new(
                limits.delivery_max_concurrency,
                Duration::from_millis(limits.admission_timeout_millis),
            )
            .map_err(|_| ProductionRuntimeBuildError)?,
        );
        let preparation =
            AgentPreparationConfig::new(Duration::from_millis(limits.lease_poll_interval_millis))
                .map_err(|_| ProductionRuntimeBuildError)?;
        let terminal_recovery = AgentTerminalRecoveryConfig::new(limits.output_max_sessions)
            .map_err(|_| ProductionRuntimeBuildError)?;
        let assembler = Arc::new(NativeRuntimeAssembler::postgres(
            platform,
            model_facade,
            tool_policy,
            agentstate,
            SessionLimits::default(),
            CheckpointLimits::default(),
        ));
        let clock = Arc::new(SystemUnixMillisClock);
        let processor = Arc::new(native_agent_delivery_processor(
            command_authenticator,
            output_preflight,
            control,
            retirer,
            input,
            clock,
            admission,
            preparation,
            assembler,
            output,
            limits.output_max_sessions,
            terminal_recovery,
        ));
        let intake = RedisDeliveryIntakeConfig::new(
            limits.delivery_max_concurrency,
            limits.delivery_queue_capacity,
            limits.redis_block_millis,
            limits.redis_reclaim_idle_millis,
            limits.redis_reclaim_interval_millis,
        )
        .map_err(|_| ProductionRuntimeBuildError)?;
        let runtime_config = RedisDeliveryRuntimeConfig::new(
            intake,
            limits.dependency_retry_millis,
            limits.shutdown_timeout_millis,
        )
        .map_err(|_| ProductionRuntimeBuildError)?;
        let delivery = RedisDeliveryRuntime::new(redis, Arc::clone(&processor), runtime_config);
        Ok(Self {
            delivery,
            processor,
        })
    }

    /// Run intake until Stop, drain all PEL-owned processing, then stop and
    /// await the native invocation supervisor. The future remains one-shot.
    pub(crate) async fn run(
        self,
        stop: watch::Receiver<bool>,
    ) -> Result<(), ProductionAgentRuntimeError> {
        let Self {
            delivery,
            processor,
        } = self;
        let delivery_result = delivery.run(stop).await;
        let stop_result = processor.stop();
        let close_result = processor.close().await;
        if let Err(error) = delivery_result {
            return Err(ProductionAgentRuntimeError {
                code: error.code(),
                retryable: error.retryable(),
            });
        }
        if stop_result.is_err() || close_result.is_err() {
            return Err(ProductionAgentRuntimeError {
                code: "agent_runtime.drain_failed",
                retryable: true,
            });
        }
        Ok(())
    }
}

/// Stable, data-free runtime exit classification.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProductionAgentRuntimeError {
    code: &'static str,
    retryable: bool,
}

impl ProductionAgentRuntimeError {
    #[must_use]
    pub(crate) const fn code(self) -> &'static str {
        self.code
    }

    #[must_use]
    pub(crate) const fn retryable(self) -> bool {
        self.retryable
    }
}

impl fmt::Display for ProductionAgentRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the production agent runtime stopped before a complete drain")
    }
}

impl std::error::Error for ProductionAgentRuntimeError {}

#[cfg(test)]
mod tests {
    use super::{ProductionAgentRuntimeError, ProductionRuntimeBuildError};

    #[test]
    fn production_runtime_failures_are_data_free() {
        assert_eq!(
            ProductionRuntimeBuildError.to_string(),
            "the production agent runtime configuration is invalid"
        );
        let runtime = ProductionAgentRuntimeError {
            code: "redis_delivery.drain_timeout",
            retryable: true,
        };
        assert_eq!(runtime.code(), "redis_delivery.drain_timeout");
        assert!(runtime.retryable());
        assert!(!runtime.to_string().contains("redis_delivery"));
    }
}
