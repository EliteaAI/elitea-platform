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

use adk_rust::futures::{FutureExt as _, StreamExt};
use adk_rust::runner::Runner;
use adk_rust::{AdkError, Content, Event, EventStream, SessionId, UserId};
use async_trait::async_trait;

use super::events::{AgentEventProjector, CompletedAgentBrowserOutput};
use super::request::AgentExecutionRequest;

/// Stable native assembly and result-selection failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NativeAgentAssemblyErrorCode {
    InvalidConfiguration,
    UnsupportedCapability,
    DependencyUnavailable,
    InvalidResult,
}

impl NativeAgentAssemblyErrorCode {
    #[must_use]
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "native_agent.invalid_configuration",
            Self::UnsupportedCapability => "native_agent.unsupported_capability",
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

/// Select the explicit application/ad-hoc browser result after real ADK EOS.
///
/// Selection must be cancellation-safe, internally bounded, and free of
/// externally visible effects: durable Stop or fatal lease loss may drop the
/// returned future. Any dependency I/O must carry its own reviewed timeout.
#[async_trait]
pub(crate) trait NativeAgentCompletionSelector: Send {
    async fn select(self) -> Result<CompletedAgentBrowserOutput, NativeAgentAssemblyError>;
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
        request: &AgentExecutionRequest,
    ) -> Result<AssembledNativeAgentInvocation<Self::Completion>, NativeAgentAssemblyError>;
}

/// Native runner, browser projector and explicit post-EOS result selector.
///
/// This aggregate contains no claim, fence, settlement, or Redis authority.
pub(crate) struct AssembledNativeAgentInvocation<S> {
    invocation: NativeAgentInvocation,
    projector: AgentEventProjector,
    completion: S,
}

impl<S> AssembledNativeAgentInvocation<S> {
    pub(crate) const fn new(
        invocation: NativeAgentInvocation,
        projector: AgentEventProjector,
        completion: S,
    ) -> Self {
        Self {
            invocation,
            projector,
            completion,
        }
    }

    pub(crate) fn into_parts(self) -> (NativeAgentInvocation, AgentEventProjector, S) {
        (self.invocation, self.projector, self.completion)
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
}

impl NativeAgentInvocation {
    #[cfg(test)]
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
            .run(self.user_id, self.session_id, self.user_content)
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
