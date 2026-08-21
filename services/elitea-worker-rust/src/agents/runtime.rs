//! Invocation-scoped ADK-Rust 2.0.0 runner ownership.
//!
//! ADK's public interruption APIs cancel every matching active run owned by a
//! `Runner`. Elitea therefore never shares one Runner across admitted work: an
//! assembled invocation transfers an exclusive Runner by value into this
//! module, starts it once, and keeps both its event stream and interruption
//! capability inside one non-cloneable value. This preserves same-session
//! concurrency without turning durable Stop into session-wide cancellation.

#![allow(dead_code)] // Production composition waits for assembly and event projection.

use std::fmt;
use std::sync::Arc;

use adk_rust::futures::{FutureExt as _, StreamExt};
use adk_rust::runner::Runner;
use adk_rust::{AdkError, Content, Event, EventStream, SessionId, UserId};
use async_trait::async_trait;
use chrono::{DateTime, Utc};

use super::assembly::OrdinaryNoToolProfile;
use super::direct_hitl::{
    DirectHitlDecisionSet, DirectHitlError, DirectHitlErrorCode, DirectHitlRunInput,
};
use super::events::{
    AgentEventProjectionError, AgentEventProjector, CompletedAgentBrowserOutput,
    ProjectedAgentEventBatch,
};
use super::graph::resume::{
    PipelineContinuationDecision, PipelineResumeError, PipelineResumeErrorCode, PrinterContinuation,
};
use super::pipeline::PipelineExecutionProfile;
use super::request::AgentExecutionRequest;
use super::session::{AuthorizedNativeCommandBinding, OrdinaryNativeAgentPlan};
use crate::protocol::control::{ClaimBoundRuntimeContextAuthority, ClaimBoundSessionAuthority};
use crate::state::StateWriterLease;
use crate::toolkits::{AdmittedToolSnapshot, FrozenToolSnapshot, ToolAdmissionPolicy};
use crate::transport::platform_client::PlatformClient;
use crate::transport::runtime_context::{ClaimScopedEliteaContext, RuntimeContextError};

/// Stable native assembly and result-selection failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NativeAgentAssemblyErrorCode {
    InvalidConfiguration,
    InvalidInput,
    UnsupportedCapability,
    ResourceExhausted,
    AuthorizationFailed,
    DependencyUnavailable,
    InvalidResult,
}

impl NativeAgentAssemblyErrorCode {
    #[must_use]
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "native_agent.invalid_configuration",
            Self::InvalidInput => "native_agent.invalid_input",
            Self::UnsupportedCapability => "native_agent.unsupported_capability",
            Self::ResourceExhausted => "native_agent.resource_exhausted",
            Self::AuthorizationFailed => "native_agent.authorization_failed",
            Self::DependencyUnavailable => "native_agent.dependency_unavailable",
            Self::InvalidResult => "native_agent.invalid_result",
        }
    }
}

/// Data-free failure before or after one native ADK stream.
pub(crate) struct NativeAgentAssemblyError {
    code: NativeAgentAssemblyErrorCode,
    message: &'static str,
}

impl NativeAgentAssemblyError {
    pub(crate) const fn new(code: NativeAgentAssemblyErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }

    #[must_use]
    pub(crate) const fn code(&self) -> NativeAgentAssemblyErrorCode {
        self.code
    }

    #[must_use]
    pub(crate) const fn retryable(&self) -> bool {
        matches!(
            self.code,
            NativeAgentAssemblyErrorCode::DependencyUnavailable
        )
    }
}

impl fmt::Debug for NativeAgentAssemblyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NativeAgentAssemblyError")
            .field("code", &self.code)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for NativeAgentAssemblyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for NativeAgentAssemblyError {}

impl From<RuntimeContextError> for NativeAgentAssemblyError {
    fn from(error: RuntimeContextError) -> Self {
        let code = match error {
            RuntimeContextError::InvalidConfiguration(_) => {
                NativeAgentAssemblyErrorCode::InvalidConfiguration
            }
            RuntimeContextError::InvalidResponse(_) => NativeAgentAssemblyErrorCode::InvalidInput,
            RuntimeContextError::ResourceExhausted(_) => {
                NativeAgentAssemblyErrorCode::ResourceExhausted
            }
            RuntimeContextError::AuthorizationFailed(_) => {
                NativeAgentAssemblyErrorCode::AuthorizationFailed
            }
            RuntimeContextError::DependencyUnavailable(_)
            | RuntimeContextError::Transport(_)
            | RuntimeContextError::Timeout(_) => {
                NativeAgentAssemblyErrorCode::DependencyUnavailable
            }
        };
        Self::new(code, "native agent runtime-context assembly failed")
    }
}

/// Select the explicit application/ad-hoc browser result after real ADK EOS.
///
/// Selection must be cancellation-safe, internally bounded, and free of
/// externally visible effects: durable Stop or fatal lease loss may drop the
/// returned future. Any dependency I/O must carry its own reviewed timeout.
#[async_trait]
pub(crate) trait NativeAgentCompletionSelector: Send {
    async fn select(self) -> Result<CompletedAgentBrowserOutput, NativeAgentAssemblyError>;
}

/// Post-authorization assembly input with one runtime-context redemption.
///
/// The request and claim-scoped credential grant remain one owned run. An
/// assembler may inspect the validated request and redeem the execution actor
/// through the hardened client, but cannot extract or retain raw claim/fence
/// authority independently.
pub(crate) struct AuthorizedNativeAssembly<'a> {
    request: &'a AgentExecutionRequest,
    runtime_context: ClaimBoundRuntimeContextAuthority,
    session: ClaimBoundSessionAuthority,
    state_writer_lease: Arc<dyn StateWriterLease>,
    command: AuthorizedNativeCommandBinding,
}

impl<'a> AuthorizedNativeAssembly<'a> {
    #[must_use]
    pub(crate) const fn from_authorized(
        request: &'a AgentExecutionRequest,
        runtime_context: ClaimBoundRuntimeContextAuthority,
        session: ClaimBoundSessionAuthority,
        state_writer_lease: Arc<dyn StateWriterLease>,
        command: AuthorizedNativeCommandBinding,
    ) -> Self {
        Self {
            request,
            runtime_context,
            session,
            state_writer_lease,
            command,
        }
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn new(
        request: &'a AgentExecutionRequest,
        runtime_context: ClaimBoundRuntimeContextAuthority,
        command: AuthorizedNativeCommandBinding,
    ) -> Self {
        Self::from_authorized(
            request,
            runtime_context,
            crate::protocol::control::test_session_authority(),
            Arc::new(crate::state::TestStateWriterLease::current()),
            command,
        )
    }

    #[must_use]
    pub(crate) const fn request(&self) -> &AgentExecutionRequest {
        self.request
    }

    /// Validate the first production assembly profile before credential
    /// redemption becomes reachable.
    pub(crate) fn admit_llm_agent(
        self,
        policy: &ToolAdmissionPolicy,
    ) -> Result<AdmittedOrdinaryNativeAssembly<'a>, NativeAgentAssemblyError> {
        let start = admit_native_start(self.request)?;
        let profile = match &start {
            AdmittedNativeStart::Fresh => OrdinaryNoToolProfile::validate(self.request)?,
            AdmittedNativeStart::DirectHitl(_) => {
                OrdinaryNoToolProfile::validate_direct_hitl_resume(self.request)?
            }
        };
        let plan = OrdinaryNativeAgentPlan::from_authorized(self.request, &profile, &self.command)?;
        let toolsets = FrozenToolSnapshot::from_request(self.request)
            .map_err(tool_snapshot_error)?
            .apply_policy(policy);
        Ok(AdmittedOrdinaryNativeAssembly {
            request: self.request,
            runtime_context: self.runtime_context,
            session: self.session,
            state_writer_lease: self.state_writer_lease,
            profile,
            plan,
            toolsets,
            start,
        })
    }

    /// Admit one frozen stored pipeline before provider or tool construction.
    pub(crate) fn admit_pipeline_with_policy(
        self,
        policy: &ToolAdmissionPolicy,
    ) -> Result<AdmittedPipelineNativeAssembly<'a>, NativeAgentAssemblyError> {
        let has_continuation = has_continuation(self.request);
        let start = if has_continuation {
            if self.request.payload.should_continue && !self.request.payload.hitl_resume {
                PrinterContinuation::from_payload(&self.request.payload)
                    .map(PipelineNativeStart::Printer)
                    .map_err(|error| pipeline_hitl_admission_error(&error))?
            } else {
                PipelineContinuationDecision::from_payload(&self.request.payload)
                    .map(PipelineNativeStart::Hitl)
                    .map_err(|error| pipeline_hitl_admission_error(&error))?
            }
        } else {
            PipelineNativeStart::Fresh
        };
        let mut profile = PipelineExecutionProfile::validate(self.request, start.is_resume())?;
        let frozen_toolsets =
            FrozenToolSnapshot::from_request(self.request).map_err(tool_snapshot_error)?;
        profile.validate_tool_snapshot(&frozen_toolsets, policy)?;
        let toolsets = frozen_toolsets.apply_policy(policy);
        let plan = OrdinaryNativeAgentPlan::from_authorized_pipeline(
            self.request,
            profile.shell(),
            &self.command,
            start.is_resume(),
            start.is_hitl_resume(),
        )?;
        Ok(AdmittedPipelineNativeAssembly {
            request: self.request,
            runtime_context: self.runtime_context,
            session: self.session,
            state_writer_lease: self.state_writer_lease,
            profile,
            plan,
            toolsets,
            start,
        })
    }

    #[cfg(test)]
    pub(crate) fn admit_pipeline(
        self,
    ) -> Result<AdmittedPipelineNativeAssembly<'a>, NativeAgentAssemblyError> {
        let policy =
            ToolAdmissionPolicy::new(&[], &std::collections::BTreeMap::new()).map_err(|_| {
                NativeAgentAssemblyError::new(
                    NativeAgentAssemblyErrorCode::InvalidConfiguration,
                    "the native toolkit policy is invalid",
                )
            })?;
        self.admit_pipeline_with_policy(&policy)
    }
}

pub(crate) enum PipelineNativeStart {
    Fresh,
    Hitl(PipelineContinuationDecision),
    Printer(PrinterContinuation),
}

impl PipelineNativeStart {
    #[must_use]
    pub(crate) const fn is_resume(&self) -> bool {
        !matches!(self, Self::Fresh)
    }

    #[must_use]
    pub(crate) const fn is_hitl_resume(&self) -> bool {
        matches!(self, Self::Hitl(_))
    }
}

/// Authorized pipeline state retained for the graph assembler.
pub(crate) struct AdmittedPipelineNativeAssembly<'a> {
    request: &'a AgentExecutionRequest,
    runtime_context: ClaimBoundRuntimeContextAuthority,
    session: ClaimBoundSessionAuthority,
    state_writer_lease: Arc<dyn StateWriterLease>,
    profile: PipelineExecutionProfile,
    plan: OrdinaryNativeAgentPlan,
    toolsets: AdmittedToolSnapshot<'a>,
    start: PipelineNativeStart,
}

impl<'a> AdmittedPipelineNativeAssembly<'a> {
    #[must_use]
    pub(crate) const fn request(&self) -> &AgentExecutionRequest {
        self.request
    }

    #[must_use]
    pub(crate) const fn profile(&self) -> &PipelineExecutionProfile {
        &self.profile
    }

    #[must_use]
    pub(crate) const fn is_resume(&self) -> bool {
        self.start.is_resume()
    }

    #[allow(clippy::type_complexity)]
    pub(super) fn into_parts(
        self,
    ) -> (
        PipelineExecutionProfile,
        OrdinaryNativeAgentPlan,
        AdmittedToolSnapshot<'a>,
        PipelineNativeStart,
        ClaimBoundRuntimeContextAuthority,
        ClaimBoundSessionAuthority,
        Arc<dyn StateWriterLease>,
    ) {
        (
            self.profile,
            self.plan,
            self.toolsets,
            self.start,
            self.runtime_context,
            self.session,
            self.state_writer_lease,
        )
    }
}

/// The only two direct-agent start modes admitted before PAT redemption.
pub(crate) enum AdmittedNativeStart {
    Fresh,
    DirectHitl(DirectHitlDecisionSet),
}

impl AdmittedNativeStart {
    #[must_use]
    pub(crate) const fn is_resume(&self) -> bool {
        matches!(self, Self::DirectHitl(_))
    }
}

/// Strict ordinary/no-tool profile admitted before ephemeral PAT redemption.
pub(crate) struct AdmittedOrdinaryNativeAssembly<'a> {
    request: &'a AgentExecutionRequest,
    runtime_context: ClaimBoundRuntimeContextAuthority,
    session: ClaimBoundSessionAuthority,
    state_writer_lease: Arc<dyn StateWriterLease>,
    profile: OrdinaryNoToolProfile,
    plan: OrdinaryNativeAgentPlan,
    toolsets: AdmittedToolSnapshot<'a>,
    start: AdmittedNativeStart,
}

impl<'a> AdmittedOrdinaryNativeAssembly<'a> {
    #[must_use]
    pub(crate) const fn request(&self) -> &AgentExecutionRequest {
        self.request
    }

    #[must_use]
    pub(crate) const fn profile(&self) -> &OrdinaryNoToolProfile {
        &self.profile
    }

    #[must_use]
    pub(crate) const fn is_resume(&self) -> bool {
        self.start.is_resume()
    }

    /// Redeem the ephemeral execution actor only after `AUTHORIZED_NOW`.
    ///
    /// The returned PAT remains zeroized, non-cloneable and non-formattable.
    /// The caller must keep this one-attempt future inside the lease-raced
    /// assembly phase.
    pub(crate) async fn redeem_runtime_context(
        self,
        client: &PlatformClient,
    ) -> Result<RedeemedOrdinaryNativeAssembly<'a>, RuntimeContextError> {
        let Self {
            runtime_context,
            session,
            state_writer_lease,
            profile,
            plan,
            toolsets,
            start,
            ..
        } = self;
        let context = client.redeem_elitea_context(&runtime_context).await?;
        Ok(RedeemedOrdinaryNativeAssembly {
            profile,
            plan,
            toolsets,
            start,
            context,
            runtime_context,
            session,
            state_writer_lease,
        })
    }
}

/// Admitted ordinary assembly after its sole claim-scoped PAT redemption.
pub(crate) struct RedeemedOrdinaryNativeAssembly<'a> {
    profile: OrdinaryNoToolProfile,
    plan: OrdinaryNativeAgentPlan,
    toolsets: AdmittedToolSnapshot<'a>,
    start: AdmittedNativeStart,
    context: ClaimScopedEliteaContext,
    runtime_context: ClaimBoundRuntimeContextAuthority,
    session: ClaimBoundSessionAuthority,
    state_writer_lease: Arc<dyn StateWriterLease>,
}

impl<'a> RedeemedOrdinaryNativeAssembly<'a> {
    pub(super) fn into_parts(
        self,
    ) -> (
        OrdinaryNoToolProfile,
        OrdinaryNativeAgentPlan,
        AdmittedToolSnapshot<'a>,
        AdmittedNativeStart,
        ClaimScopedEliteaContext,
        ClaimBoundRuntimeContextAuthority,
        ClaimBoundSessionAuthority,
        Arc<dyn StateWriterLease>,
    ) {
        (
            self.profile,
            self.plan,
            self.toolsets,
            self.start,
            self.context,
            self.runtime_context,
            self.session,
            self.state_writer_lease,
        )
    }
}

fn admit_native_start(
    request: &AgentExecutionRequest,
) -> Result<AdmittedNativeStart, NativeAgentAssemblyError> {
    let payload = &request.payload;
    if !has_continuation(request) {
        return Ok(AdmittedNativeStart::Fresh);
    }
    DirectHitlDecisionSet::from_payload(payload)
        .map(AdmittedNativeStart::DirectHitl)
        .map_err(|error| direct_hitl_admission_error(&error))
}

fn has_continuation(request: &AgentExecutionRequest) -> bool {
    let payload = &request.payload;
    payload.should_continue
        || payload.hitl_resume
        || payload.hitl_action.is_some()
        || payload.hitl_value.is_some()
        || !payload.hitl_decisions.is_empty()
}

fn direct_hitl_admission_error(error: &DirectHitlError) -> NativeAgentAssemblyError {
    let code = match error.code() {
        DirectHitlErrorCode::InvalidInput
        | DirectHitlErrorCode::StaleDecision
        | DirectHitlErrorCode::CorruptSession => NativeAgentAssemblyErrorCode::InvalidInput,
        DirectHitlErrorCode::UnsupportedCapability => {
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        }
        DirectHitlErrorCode::ResourceExhausted => NativeAgentAssemblyErrorCode::ResourceExhausted,
    };
    NativeAgentAssemblyError::new(code, "the direct sensitive-tool continuation is malformed")
}

fn pipeline_hitl_admission_error(error: &PipelineResumeError) -> NativeAgentAssemblyError {
    let code = match error.code() {
        PipelineResumeErrorCode::InvalidInput
        | PipelineResumeErrorCode::StaleDecision
        | PipelineResumeErrorCode::CorruptSession => NativeAgentAssemblyErrorCode::InvalidInput,
        PipelineResumeErrorCode::UnsupportedCapability => {
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        }
        PipelineResumeErrorCode::DependencyUnavailable => {
            NativeAgentAssemblyErrorCode::DependencyUnavailable
        }
    };
    NativeAgentAssemblyError::new(code, "the pipeline HITL continuation is malformed")
}

fn tool_snapshot_error(
    error: crate::toolkits::FrozenToolSnapshotError,
) -> NativeAgentAssemblyError {
    let code = match error.code() {
        crate::toolkits::FrozenToolSnapshotErrorCode::InvalidInput => {
            NativeAgentAssemblyErrorCode::InvalidInput
        }
        crate::toolkits::FrozenToolSnapshotErrorCode::ResourceExhausted => {
            NativeAgentAssemblyErrorCode::ResourceExhausted
        }
    };
    NativeAgentAssemblyError::new(code, "the frozen agent tool snapshot is malformed")
}

/// Trusted assembler for one validated, already-authorized request.
///
/// Assembly may construct local/provider/session dependencies but must not
/// start ADK or perform a business effect. Its future must be
/// cancellation-safe and every dependency attempt must be explicitly bounded,
/// because durable Stop or fatal lease loss wins this phase.
#[async_trait]
pub(crate) trait NativeAgentAssembler: Send + Sync + 'static {
    type Completion: NativeAgentCompletionSelector;

    async fn assemble(
        &self,
        assembly: AuthorizedNativeAssembly<'_>,
    ) -> Result<AssembledNativeAgentInvocation<Self::Completion>, NativeAgentAssemblyError>;
}

/// Native runner, browser projector and explicit post-EOS result selector.
///
/// This aggregate contains no claim, fence, settlement, or Redis authority.
pub(crate) struct AssembledNativeAgentInvocation<S> {
    invocation: NativeAgentInvocation,
    // The projector grows with the browser compatibility surface. Heap-own it
    // once so additional node states do not inflate every lifecycle poll frame.
    projector: Box<AgentEventProjector>,
    completion: S,
}

impl<S> AssembledNativeAgentInvocation<S> {
    pub(crate) fn new(
        invocation: NativeAgentInvocation,
        projector: AgentEventProjector,
        completion: S,
    ) -> Self {
        Self {
            invocation,
            projector: Box::new(projector),
            completion,
        }
    }

    /// Replace only the terminal-result selector while preserving the exact
    /// Runner and browser projector assembled for this invocation.
    ///
    /// Runtime routing uses this consuming transform to erase the concrete
    /// direct/pipeline completion type without creating a second execution or
    /// separating completion ownership from its Runner.
    pub(crate) fn map_completion<T>(
        self,
        map: impl FnOnce(S) -> T,
    ) -> AssembledNativeAgentInvocation<T> {
        let Self {
            invocation,
            projector,
            completion,
        } = self;
        AssembledNativeAgentInvocation {
            invocation,
            projector,
            completion: map(completion),
        }
    }

    pub(crate) fn project_start(
        &mut self,
        occurred_at: DateTime<Utc>,
    ) -> Result<ProjectedAgentEventBatch, AgentEventProjectionError> {
        self.projector.start(occurred_at)
    }

    pub(crate) fn start(
        self,
    ) -> Result<(NativeAgentRun, Box<AgentEventProjector>, S), NativeAgentRuntimeError> {
        let Self {
            invocation,
            projector,
            completion,
        } = self;
        Ok((invocation.start()?, projector, completion))
    }
}

/// Stable, data-free native runtime failure categories.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NativeAgentRuntimeErrorCode {
    InvalidState,
    StartFailed,
    EventFailed,
}

impl NativeAgentRuntimeErrorCode {
    #[must_use]
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidState => "native_agent.invalid_state",
            Self::StartFailed => "native_agent.start_failed",
            Self::EventFailed => "native_agent.event_failed",
        }
    }
}

/// Redacted ADK execution failure.
///
/// The upstream value is retained for future typed classification but is not
/// exposed through `Debug`, `Display`, or `Error::source`: provider, tool, and
/// request data can occur inside an ADK error chain.
pub(crate) struct NativeAgentRuntimeError {
    code: NativeAgentRuntimeErrorCode,
    _upstream: Option<Box<AdkError>>,
}

impl NativeAgentRuntimeError {
    fn invalid_state() -> Self {
        Self {
            code: NativeAgentRuntimeErrorCode::InvalidState,
            _upstream: None,
        }
    }

    pub(crate) fn invalid_state_for_lifecycle() -> Self {
        Self::invalid_state()
    }

    fn start_failed(error: AdkError) -> Self {
        Self {
            code: NativeAgentRuntimeErrorCode::StartFailed,
            _upstream: Some(Box::new(error)),
        }
    }

    fn start_deferred() -> Self {
        Self {
            code: NativeAgentRuntimeErrorCode::StartFailed,
            _upstream: None,
        }
    }

    fn event_failed(error: AdkError) -> Self {
        Self {
            code: NativeAgentRuntimeErrorCode::EventFailed,
            _upstream: Some(Box::new(error)),
        }
    }

    #[must_use]
    pub(crate) const fn code(&self) -> NativeAgentRuntimeErrorCode {
        self.code
    }
}

impl fmt::Debug for NativeAgentRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NativeAgentRuntimeError")
            .field("code", &self.code)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for NativeAgentRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self.code {
            NativeAgentRuntimeErrorCode::InvalidState => {
                "the native agent runner is not available for one exclusive invocation"
            }
            NativeAgentRuntimeErrorCode::StartFailed => "the native agent runtime could not start",
            NativeAgentRuntimeErrorCode::EventFailed => "the native agent event stream failed",
        })
    }
}

impl std::error::Error for NativeAgentRuntimeError {}

/// Fully assembled, not-yet-started single-use ADK invocation.
///
/// Production construction stays closed until the authorized application/ad-hoc
/// assembler lands. The Runner is transferred by value and must have no
/// existing active run; the future assembler must create a new Runner for each
/// authorized invocation.
pub(crate) struct NativeAgentInvocation {
    runner: Runner,
    user_id: UserId,
    session_id: SessionId,
    user_content: Content,
    run_config: Option<adk_rust::RunConfig>,
}

impl NativeAgentInvocation {
    /// Seal one freshly assembled Runner with its exact typed session input.
    ///
    /// This constructor is crate-private and accepts no claim, fence, output,
    /// settlement, or Redis authority. The authorized assembly layer keeps the
    /// resulting value inseparable from its projector and result selector.
    pub(crate) fn new(
        runner: Runner,
        user_id: UserId,
        session_id: SessionId,
        user_content: Content,
    ) -> Self {
        Self {
            runner,
            user_id,
            session_id,
            user_content,
            run_config: None,
        }
    }

    /// Seal a fresh invocation with an explicit bounded ADK run policy.
    pub(crate) fn new_with_run_config(
        runner: Runner,
        user_id: UserId,
        session_id: SessionId,
        user_content: Content,
        run_config: adk_rust::RunConfig,
    ) -> Self {
        Self {
            runner,
            user_id,
            session_id,
            user_content,
            run_config: Some(run_config),
        }
    }

    /// Seal a read-only direct-HITL replay prepared from one persisted call.
    pub(crate) fn new_direct_hitl(
        runner: Runner,
        user_id: UserId,
        session_id: SessionId,
        replay: DirectHitlRunInput,
    ) -> Self {
        let (user_content, run_config) = replay.into_parts();
        Self {
            runner,
            user_id,
            session_id,
            user_content,
            run_config: Some(run_config),
        }
    }

    /// Start exactly one run and seal its interruption scope with its stream.
    ///
    /// Exact ADK-Rust 2.0.0 constructs the `EventStream` on its first poll and
    /// defers session I/O and agent execution into that stream. This boundary
    /// deliberately polls once and rejects any deferred start so it can never
    /// retain the one-shot submission permit across an unbounded await.
    ///
    /// # Errors
    ///
    /// Fails closed if the supplied Runner already owns an active run or ADK
    /// cannot create the event stream.
    pub(crate) fn start(self) -> Result<NativeAgentRun, NativeAgentRuntimeError> {
        if !self.runner.active_runs().is_empty() {
            return Err(NativeAgentRuntimeError::invalid_state());
        }
        let runner = self.runner;
        let app_name = runner.app_name().to_owned();
        let user_id = self.user_id.to_string();
        let session_id = self.session_id.to_string();
        // Exact ADK-Rust 2.0.0 registers the run and constructs EventStream on
        // its first poll; session lookup and agent work live inside that stream.
        // Refuse a future version that moves I/O into this authority-consuming
        // boundary instead of allowing an unbounded, non-interruptible start.
        let events = runner
            .run_with_config(
                self.user_id,
                self.session_id,
                self.user_content,
                self.run_config,
            )
            .now_or_never()
            .ok_or_else(NativeAgentRuntimeError::start_deferred)?
            .map_err(NativeAgentRuntimeError::start_failed)?;
        Ok(NativeAgentRun {
            runner,
            events,
            app_name,
            user_id,
            session_id,
            complete: false,
        })
    }
}

/// One exact active ADK invocation and its only cancellation scope.
///
/// The raw `Runner` and `EventStream` are never returned separately. The owner may
/// drop a pending `next_event` future when a lease transition wins a `select!`;
/// that cancels only the wait, not the stream. It can then request Stop on this
/// same value and continue draining to end-of-stream.
pub(crate) struct NativeAgentRun {
    runner: Runner,
    events: EventStream,
    app_name: String,
    user_id: String,
    session_id: String,
    complete: bool,
}

impl NativeAgentRun {
    /// Poll one ADK semantic event. End-of-stream is not by itself a terminal
    /// business outcome; the execution coordinator combines it with its
    /// separately latched Stop, deadline, lease, and projected-result state.
    ///
    /// # Errors
    ///
    /// Returns a redacted failure for an upstream stream error or reuse after
    /// the stream has already completed.
    pub(crate) async fn next_event(&mut self) -> Result<Option<Event>, NativeAgentRuntimeError> {
        if self.complete {
            return Err(NativeAgentRuntimeError::invalid_state());
        }
        match self.events.next().await {
            Some(Ok(event)) => Ok(Some(event)),
            Some(Err(error)) => {
                self.complete = true;
                Err(NativeAgentRuntimeError::event_failed(error))
            }
            None => {
                self.complete = true;
                Ok(None)
            }
        }
    }

    /// Cooperatively stop only this single-use Runner's exact identity.
    ///
    /// The worker process drain path never calls this method; only an admitted
    /// execution's durable Stop/output winner may do so.
    #[must_use]
    pub(crate) fn request_stop(&self) -> bool {
        !self.complete
            && self
                .runner
                .interrupt_identity(&self.app_name, &self.user_id, &self.session_id)
    }
}

impl Drop for NativeAgentRun {
    fn drop(&mut self) {
        if !self.complete {
            let _ignored =
                self.runner
                    .interrupt_identity(&self.app_name, &self.user_id, &self.session_id);
        }
    }
}
