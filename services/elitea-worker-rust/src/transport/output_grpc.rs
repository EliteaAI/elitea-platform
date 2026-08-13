use std::fmt;
use std::num::NonZeroU64;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use prost::Message;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_stream::wrappers::ReceiverStream;
use tonic::metadata::MetadataValue;
use tonic::transport::Channel;
use tonic::{Request, Streaming};

use crate::protocol::elitea::runtime::v1::{
    ExecutionOutcomeV1, ExecutionOutputAckV1, ExecutionOutputFrameV1, RuntimeErrorCodeV1,
    execution_output_frame_v1, execution_output_service_client::ExecutionOutputServiceClient,
};
use crate::protocol::output::MAX_OUTPUT_FRAME_BYTES;
use crate::spool::{EncryptedOutputSpool, SpoolError};

use super::output_session::{
    DurableOutputFrame, OutputSessionError, OutputSessionLimits, OutputSessionState,
};

const MAX_METADATA_BYTES: usize = 256;
const MAX_ACK_BYTES: usize = 80 * 1024;
const MAX_QUEUED_FRAMES: usize = 128;
const MAX_QUEUED_BYTES: usize = 64 * 1024 * 1024;
const MAX_ACK_TIMEOUT: Duration = Duration::from_mins(5);
const MAX_STREAM_DEADLINE: Duration = Duration::from_hours(1);

/// Bounded output-stream settings supplied by deployment composition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputGrpcConfig {
    pub max_queued_frames: usize,
    pub max_queued_bytes: usize,
    pub max_frame_bytes: usize,
    pub max_server_credit_frames: u32,
    pub max_server_credit_bytes: u64,
    pub stream_deadline: Duration,
    pub ack_timeout: Duration,
    pub workload_session_id: String,
    pub producer_id: String,
}

impl OutputGrpcConfig {
    fn state_limits(&self) -> OutputSessionLimits {
        OutputSessionLimits {
            queued_frame_capacity: self.max_queued_frames,
            queued_byte_capacity: self.max_queued_bytes,
            frame_byte_limit: self.max_frame_bytes,
            server_credit_frame_limit: self.max_server_credit_frames,
            server_credit_byte_limit: self.max_server_credit_bytes,
        }
    }

    fn validate(&self) -> Result<(), OutputGrpcError> {
        self.state_limits()
            .validate()
            .map_err(OutputGrpcError::Protocol)?;
        if self.stream_deadline.is_zero()
            || self.ack_timeout.is_zero()
            || self.max_queued_frames > MAX_QUEUED_FRAMES
            || self.max_queued_bytes > MAX_QUEUED_BYTES
            || self.max_frame_bytes > MAX_OUTPUT_FRAME_BYTES
            || usize::try_from(self.max_server_credit_frames)
                .map_or(true, |frames| frames > MAX_QUEUED_FRAMES)
            || self.max_server_credit_bytes > MAX_QUEUED_BYTES as u64
            || self.stream_deadline > MAX_STREAM_DEADLINE
            || self.ack_timeout > MAX_ACK_TIMEOUT
            || !valid_metadata_value(&self.workload_session_id)
            || !valid_metadata_value(&self.producer_id)
        {
            return Err(OutputGrpcError::InvalidConfiguration(
                "the output gRPC configuration is malformed",
            ));
        }
        Ok(())
    }
}

/// Stable, data-free output delivery failures.
#[derive(Debug)]
pub enum OutputGrpcError {
    InvalidConfiguration(&'static str),
    Protocol(OutputSessionError),
    Spool(SpoolError),
    Unavailable(&'static str),
}

impl fmt::Display for OutputGrpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration(message) | Self::Unavailable(message) => {
                formatter.write_str(message)
            }
            Self::Protocol(error) => error.fmt(formatter),
            Self::Spool(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for OutputGrpcError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Protocol(error) => Some(error),
            Self::Spool(error) => Some(error),
            Self::InvalidConfiguration(_) | Self::Unavailable(_) => None,
        }
    }
}

impl From<OutputSessionError> for OutputGrpcError {
    fn from(value: OutputSessionError) -> Self {
        Self::Protocol(value)
    }
}

impl From<SpoolError> for OutputGrpcError {
    fn from(value: SpoolError) -> Self {
        Self::Spool(value)
    }
}

#[async_trait]
trait OutputStreamIo: Send {
    async fn send(&mut self, frame: ExecutionOutputFrameV1) -> Result<(), OutputGrpcError>;
    async fn receive(&mut self) -> Result<Option<ExecutionOutputAckV1>, OutputGrpcError>;
    async fn close(&mut self) -> Result<(), OutputGrpcError>;
}

struct TonicOutputStream {
    outbound: Option<mpsc::Sender<ExecutionOutputFrameV1>>,
    inbound: Streaming<ExecutionOutputAckV1>,
}

impl TonicOutputStream {
    async fn open(channel: Channel, config: &OutputGrpcConfig) -> Result<Self, OutputGrpcError> {
        config.validate()?;
        let (outbound, receiver) = mpsc::channel(config.max_queued_frames);
        let mut request = Request::new(ReceiverStream::new(receiver));
        request.set_timeout(config.stream_deadline);
        let workload =
            MetadataValue::try_from(config.workload_session_id.as_str()).map_err(|_| {
                OutputGrpcError::InvalidConfiguration("the output gRPC metadata is malformed")
            })?;
        let producer = MetadataValue::try_from(config.producer_id.as_str()).map_err(|_| {
            OutputGrpcError::InvalidConfiguration("the output gRPC metadata is malformed")
        })?;
        request
            .metadata_mut()
            .insert("x-elitea-workload-session", workload);
        request
            .metadata_mut()
            .insert("x-elitea-producer-id", producer);

        let mut client = ExecutionOutputServiceClient::new(channel)
            .max_encoding_message_size(config.max_frame_bytes)
            .max_decoding_message_size(MAX_ACK_BYTES);
        let response = client
            .publish(request)
            .await
            .map_err(|_| OutputGrpcError::Unavailable("the output gRPC stream is unavailable"))?;
        Ok(Self {
            outbound: Some(outbound),
            inbound: response.into_inner(),
        })
    }
}

#[async_trait]
impl OutputStreamIo for TonicOutputStream {
    async fn send(&mut self, frame: ExecutionOutputFrameV1) -> Result<(), OutputGrpcError> {
        self.outbound
            .as_ref()
            .ok_or(OutputGrpcError::Unavailable(
                "the output gRPC stream is closed",
            ))?
            .send(frame)
            .await
            .map_err(|_| OutputGrpcError::Unavailable("the output gRPC stream is unavailable"))
    }

    async fn receive(&mut self) -> Result<Option<ExecutionOutputAckV1>, OutputGrpcError> {
        self.inbound
            .message()
            .await
            .map_err(|_| OutputGrpcError::Unavailable("the output gRPC stream is unavailable"))
    }

    async fn close(&mut self) -> Result<(), OutputGrpcError> {
        self.outbound.take();
        Ok(())
    }
}

struct OutputSession<S> {
    io: S,
    spool: Option<EncryptedOutputSpool>,
    state: OutputSessionState,
    config: OutputGrpcConfig,
    terminal_committed: bool,
    failed: bool,
}

/// Validated durable state before any output endpoint is contacted.
///
/// Delivery coordination can inspect, reconcile, exact-replace, or append to
/// the encrypted spool before choosing whether a stream replay is authorized.
pub struct PreparedOutputSpool {
    spool: EncryptedOutputSpool,
    state: OutputSessionState,
    pending: Vec<DurableOutputFrame>,
    config: OutputGrpcConfig,
    reconciled: bool,
}

impl PreparedOutputSpool {
    /// Validate the complete durable spool without opening a network stream.
    ///
    /// This synchronous recovery boundary is intended to run on the worker's
    /// bounded blocking executor.
    ///
    /// # Errors
    ///
    /// Returns a stable error for invalid limits, corrupt/noncanonical frames,
    /// sequence gaps, identity changes, or filesystem failures.
    pub fn prepare(
        mut spool: EncryptedOutputSpool,
        config: OutputGrpcConfig,
    ) -> Result<Self, OutputGrpcError> {
        config.validate()?;
        let pending = spool.pending()?;
        let (state, pending) = OutputSessionState::restore(config.state_limits(), pending)?;
        Ok(Self {
            spool,
            state,
            pending,
            config,
            reconciled: false,
        })
    }

    /// Return a defensive copy of the last restored frame.
    #[must_use]
    pub fn pending_replay_frame(&self) -> Option<ExecutionOutputFrameV1> {
        self.pending.last().map(|frame| frame.message().clone())
    }

    /// Report whether the spool contains these exact deterministic bytes.
    #[must_use]
    pub fn replays(&self, frame: &ExecutionOutputFrameV1) -> bool {
        let encoded = frame.encode_to_vec();
        self.pending.iter().any(|candidate| {
            candidate.sequence() == frame.sequence && candidate.encoded() == encoded
        })
    }

    /// Persist a new contiguous frame before endpoint availability is assumed.
    ///
    /// # Errors
    ///
    /// Returns a typed protocol, capacity, or spool error without mutating the
    /// in-memory admission state when durable publication fails.
    pub fn persist(&mut self, frame: ExecutionOutputFrameV1) -> Result<u64, OutputGrpcError> {
        self.require_unreconciled()?;
        let mut next_state = self.state.clone();
        let frame = next_state.prepare_new_frame(frame)?;
        let sequence = NonZeroU64::new(frame.sequence()).ok_or(OutputGrpcError::Protocol(
            OutputSessionError::InvalidInput("the output sequence is malformed"),
        ))?;
        self.require_pending_capacity(frame.encoded().len())?;
        self.spool.put(sequence, frame.encoded())?;
        next_state.commit_durable_admission(&frame)?;
        self.state = next_state;
        self.pending.push(frame);
        Ok(sequence.get())
    }

    /// Retire a spool only when an authenticated control receipt covers its
    /// complete durable prefix.
    ///
    /// # Errors
    ///
    /// Returns authorization failure when the watermark does not cover every
    /// pending frame.
    pub fn reconcile_pending_through(&mut self, sequence: u64) -> Result<(), OutputGrpcError> {
        self.require_unreconciled()?;
        let sequence = NonZeroU64::new(sequence)
            .filter(|sequence| i64::try_from(sequence.get()).is_ok())
            .ok_or(OutputGrpcError::Protocol(OutputSessionError::InvalidInput(
                "the output reconciliation watermark is malformed",
            )))?;
        if self.pending.is_empty() {
            return Ok(());
        }
        if self
            .pending
            .last()
            .is_some_and(|frame| sequence.get() < frame.sequence())
        {
            return Err(OutputGrpcError::Protocol(
                OutputSessionError::AuthorizationFailed(
                    "the output reconciliation watermark does not cover the durable spool",
                ),
            ));
        }
        self.spool.acknowledge_through(sequence)?;
        self.pending.clear();
        self.reconciled = true;
        Ok(())
    }

    /// CAS one exact pending frame without changing its stream binding.
    ///
    /// # Errors
    ///
    /// Returns authorization failure unless exactly one byte-identical frame is
    /// pending and the replacement retains its sequence and complete binding.
    pub fn replace_pending_exact(
        &mut self,
        expected: &ExecutionOutputFrameV1,
        replacement: &ExecutionOutputFrameV1,
    ) -> Result<(), OutputGrpcError> {
        self.require_single_expected(expected)?;
        if replacement.sequence != expected.sequence {
            return Err(OutputGrpcError::Protocol(OutputSessionError::InvalidInput(
                "the terminal replacement changed its output sequence",
            )));
        }
        self.state.validate_replacement_binding(replacement)?;
        let (state, pending) = self.restore_replacement(replacement)?;
        self.replace_pending_bytes(expected, replacement)?;
        self.state = state;
        self.pending = pending;
        Ok(())
    }

    /// CAS an exact old-fence frame to the canonical fresh-fence cancellation.
    ///
    /// # Errors
    ///
    /// Returns authorization failure unless every recovery binding and
    /// canonical cancellation field matches the current contract.
    pub fn replace_pending_cancelled_recovery(
        &mut self,
        expected: &ExecutionOutputFrameV1,
        replacement: &ExecutionOutputFrameV1,
    ) -> Result<(), OutputGrpcError> {
        self.require_single_expected(expected)?;
        validate_recovery_rebind(expected, replacement, RecoveryKind::Cancelled)?;
        self.replace_rebound_pending(expected, replacement)
    }

    /// CAS an exact old-fence terminal to the canonical ambiguous failure.
    ///
    /// # Errors
    ///
    /// Returns authorization failure unless every recovery binding and
    /// canonical failure field matches the current contract.
    pub fn replace_pending_ambiguous_recovery(
        &mut self,
        expected: &ExecutionOutputFrameV1,
        replacement: &ExecutionOutputFrameV1,
    ) -> Result<(), OutputGrpcError> {
        self.require_single_expected(expected)?;
        validate_recovery_rebind(expected, replacement, RecoveryKind::Ambiguous)?;
        self.replace_rebound_pending(expected, replacement)
    }

    /// Connect only after recovery policy has authorized exact replay.
    ///
    /// # Errors
    ///
    /// Returns a stable transport or replay error. Unacknowledged bytes remain
    /// durable on every failure.
    pub async fn connect(self, channel: Channel) -> Result<OutputGrpcSession, OutputGrpcError> {
        self.require_unreconciled()?;
        let max_frame_bytes = self.config.max_frame_bytes;
        let io = TonicOutputStream::open(channel, &self.config).await?;
        let inner = OutputSession::from_prepared(io, self).await?;
        Ok(spawn_output_actor(inner, max_frame_bytes))
    }

    fn require_single_expected(
        &self,
        expected: &ExecutionOutputFrameV1,
    ) -> Result<(), OutputGrpcError> {
        self.require_unreconciled()?;
        if self.pending.len() != 1 || !self.replays(expected) {
            return Err(OutputGrpcError::Protocol(
                OutputSessionError::AuthorizationFailed(
                    "the durable output spool changed before recovery",
                ),
            ));
        }
        Ok(())
    }

    fn require_unreconciled(&self) -> Result<(), OutputGrpcError> {
        if self.reconciled {
            return Err(OutputGrpcError::Protocol(
                OutputSessionError::AuthorizationFailed(
                    "the durable output spool was already reconciled",
                ),
            ));
        }
        Ok(())
    }

    fn require_pending_capacity(&self, encoded_bytes: usize) -> Result<(), OutputGrpcError> {
        let pending_bytes = self.pending.iter().try_fold(0usize, |total, frame| {
            total.checked_add(frame.encoded().len())
        });
        if self.pending.len() >= self.config.max_queued_frames
            || pending_bytes
                .and_then(|total| total.checked_add(encoded_bytes))
                .is_none_or(|total| total > self.config.max_queued_bytes)
        {
            return Err(OutputGrpcError::Protocol(
                OutputSessionError::ResourceExhausted(
                    "the durable output queue capacity was exceeded",
                ),
            ));
        }
        Ok(())
    }

    fn replace_pending_bytes(
        &mut self,
        expected: &ExecutionOutputFrameV1,
        replacement: &ExecutionOutputFrameV1,
    ) -> Result<(), OutputGrpcError> {
        let sequence = NonZeroU64::new(expected.sequence).ok_or(OutputGrpcError::Protocol(
            OutputSessionError::InvalidInput("the replacement output sequence is malformed"),
        ))?;
        self.spool.replace_exact(
            sequence,
            &expected.encode_to_vec(),
            &replacement.encode_to_vec(),
        )?;
        Ok(())
    }

    fn restore_replacement(
        &self,
        replacement: &ExecutionOutputFrameV1,
    ) -> Result<(OutputSessionState, Vec<DurableOutputFrame>), OutputGrpcError> {
        let restored = vec![crate::spool::SpooledFrame {
            sequence: NonZeroU64::new(replacement.sequence).ok_or(OutputGrpcError::Protocol(
                OutputSessionError::InvalidInput("the replacement output sequence is malformed"),
            ))?,
            payload: replacement.encode_to_vec(),
        }];
        OutputSessionState::restore(self.config.state_limits(), restored)
            .map_err(OutputGrpcError::Protocol)
    }

    fn replace_rebound_pending(
        &mut self,
        expected: &ExecutionOutputFrameV1,
        replacement: &ExecutionOutputFrameV1,
    ) -> Result<(), OutputGrpcError> {
        if replacement.encoded_len() > self.config.max_frame_bytes {
            return Err(OutputGrpcError::Protocol(
                OutputSessionError::ResourceExhausted(
                    "the replacement output frame exceeds the transport limit",
                ),
            ));
        }
        let (state, pending) = self.restore_replacement(replacement)?;
        self.replace_pending_bytes(expected, replacement)?;
        self.state = state;
        self.pending = pending;
        Ok(())
    }
}

impl<S: OutputStreamIo> OutputSession<S> {
    #[cfg(test)]
    async fn open(
        io: S,
        spool: EncryptedOutputSpool,
        config: OutputGrpcConfig,
    ) -> Result<Self, OutputGrpcError> {
        let prepared = PreparedOutputSpool::prepare(spool, config)?;
        Self::from_prepared(io, prepared).await
    }

    async fn from_prepared(io: S, prepared: PreparedOutputSpool) -> Result<Self, OutputGrpcError> {
        prepared.require_unreconciled()?;
        let PreparedOutputSpool {
            spool,
            state,
            pending: restored,
            config,
            reconciled: _,
        } = prepared;
        let mut session = Self {
            io,
            spool: Some(spool),
            state,
            config,
            terminal_committed: false,
            failed: false,
        };
        let bootstrap = session.receive_ack().await?;
        let plan = session.state.validate_ack(&bootstrap)?;
        session.state.commit_ack(plan);
        let (_shutdown, mut shutdown_receiver) = watch::channel(false);
        for frame in restored {
            session.state.queue_replay(&frame)?;
            session
                .transmit_and_commit(&frame, &mut shutdown_receiver)
                .await?;
            if frame.message().terminal {
                session.terminal_committed = true;
            }
        }
        Ok(session)
    }

    #[cfg(test)]
    async fn send(&mut self, frame: ExecutionOutputFrameV1) -> Result<u64, OutputGrpcError> {
        let (_shutdown, mut receiver) = watch::channel(false);
        self.send_with_shutdown(frame, &mut receiver).await
    }

    async fn send_with_shutdown(
        &mut self,
        frame: ExecutionOutputFrameV1,
        shutdown: &mut watch::Receiver<bool>,
    ) -> Result<u64, OutputGrpcError> {
        if self.failed {
            return Err(OutputGrpcError::Unavailable(
                "the output gRPC session is unavailable",
            ));
        }
        let result = self.send_once(frame, shutdown).await;
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    async fn send_once(
        &mut self,
        frame: ExecutionOutputFrameV1,
        shutdown: &mut watch::Receiver<bool>,
    ) -> Result<u64, OutputGrpcError> {
        if self.terminal_committed {
            return Err(OutputGrpcError::Protocol(OutputSessionError::InvalidInput(
                "the logical output stream already committed a terminal frame",
            )));
        }
        let mut next_state = self.state.clone();
        let frame = next_state.prepare_new_frame(frame)?;
        let sequence = frame.sequence();
        let nonzero_sequence = NonZeroU64::new(sequence).ok_or(OutputGrpcError::Protocol(
            OutputSessionError::InvalidInput("the output sequence is malformed"),
        ))?;
        let encoded = frame.encoded().to_vec();
        self.with_spool(move |spool| spool.put(nonzero_sequence, &encoded))
            .await?;
        next_state.commit_persisted_admission(&frame)?;
        self.state = next_state;
        self.transmit_and_commit(&frame, shutdown).await?;
        if frame.message().terminal {
            self.terminal_committed = true;
        }
        Ok(sequence)
    }

    async fn transmit_and_commit(
        &mut self,
        frame: &DurableOutputFrame,
        shutdown: &mut watch::Receiver<bool>,
    ) -> Result<(), OutputGrpcError> {
        let ack_timeout = self.config.ack_timeout;
        match timeout(
            ack_timeout,
            self.transmit_and_commit_within_deadline(frame, shutdown),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(OutputGrpcError::Unavailable(
                "the output ACK deadline was exceeded",
            )),
        }
    }

    async fn transmit_and_commit_within_deadline(
        &mut self,
        frame: &DurableOutputFrame,
        shutdown: &mut watch::Receiver<bool>,
    ) -> Result<(), OutputGrpcError> {
        while !self.state.has_transmission_credit(frame) {
            let ack = self.receive_ack_or_shutdown(shutdown).await?;
            let plan = self.state.validate_ack(&ack)?;
            self.apply_ack(plan).await?;
        }
        self.state.reserve_transmission(frame)?;
        tokio::select! {
            biased;
            _ = shutdown.changed() => {
                return Err(OutputGrpcError::Unavailable(
                    "the output gRPC session is closing",
                ));
            }
            result = self.io.send(frame.message().clone()) => result?,
        }
        self.state.complete_transmission(frame)?;
        loop {
            let ack = self.receive_ack_or_shutdown(shutdown).await?;
            let plan = self.state.validate_ack(&ack)?;
            let acknowledged = plan.acknowledged_sequence();
            self.apply_ack(plan).await?;
            if acknowledged == frame.sequence() {
                return Ok(());
            }
        }
    }

    async fn apply_ack(
        &mut self,
        plan: super::output_session::AckPlan,
    ) -> Result<(), OutputGrpcError> {
        if let Some(sequence) = plan.retire_spool_through() {
            let nonzero_sequence = NonZeroU64::new(sequence).ok_or(OutputGrpcError::Protocol(
                OutputSessionError::InvalidInput("the output ACK sequence is malformed"),
            ))?;
            self.with_spool(move |spool| spool.acknowledge_through(nonzero_sequence))
                .await?;
        }
        self.state.commit_ack(plan);
        Ok(())
    }

    async fn receive_ack_or_shutdown(
        &mut self,
        shutdown: &mut watch::Receiver<bool>,
    ) -> Result<ExecutionOutputAckV1, OutputGrpcError> {
        if *shutdown.borrow() {
            return Err(OutputGrpcError::Unavailable(
                "the output gRPC session is closing",
            ));
        }
        tokio::select! {
            biased;
            _ = shutdown.changed() => {
                Err(OutputGrpcError::Unavailable("the output gRPC session is closing"))
            }
            result = self.io.receive() => match result? {
                Some(ack) => Ok(ack),
                None => Err(OutputGrpcError::Unavailable(
                    "the output gRPC stream closed before its bound ACK",
                )),
            }
        }
    }

    async fn receive_ack(&mut self) -> Result<ExecutionOutputAckV1, OutputGrpcError> {
        match timeout(self.config.ack_timeout, self.io.receive()).await {
            Ok(Ok(Some(ack))) => Ok(ack),
            Ok(Ok(None)) => Err(OutputGrpcError::Unavailable(
                "the output gRPC stream closed before its bound ACK",
            )),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(OutputGrpcError::Unavailable(
                "the output ACK deadline was exceeded",
            )),
        }
    }

    async fn with_spool<T, F>(&mut self, operation: F) -> Result<T, OutputGrpcError>
    where
        T: Send + 'static,
        F: FnOnce(&mut EncryptedOutputSpool) -> Result<T, SpoolError> + Send + 'static,
    {
        let spool = self.spool.take().ok_or(OutputGrpcError::Unavailable(
            "the output spool ownership is unavailable",
        ))?;
        let (spool, result) = run_spool(spool, operation).await?;
        self.spool = Some(spool);
        result.map_err(OutputGrpcError::Spool)
    }
}

enum SessionCommand {
    Send {
        frame: Box<ExecutionOutputFrameV1>,
        permit: OwnedSemaphorePermit,
        response: oneshot::Sender<Result<u64, OutputGrpcError>>,
    },
}

/// One ordered, execution-bound output stream over a caller-verified channel.
///
/// An owned task serializes durable work after command admission. Cancelling a
/// caller's wait cannot cancel a spool write, steal a preceding frame's ACK, or
/// strand the session halfway through ACK deletion.
pub struct OutputGrpcSession {
    commands: mpsc::Sender<SessionCommand>,
    admission: Arc<Semaphore>,
    acknowledged_sequence: Arc<AtomicU64>,
    max_frame_bytes: usize,
    shutdown: watch::Sender<bool>,
    task: Option<JoinHandle<()>>,
}

impl OutputGrpcSession {
    /// Open the bounded stream, validate bootstrap credit, and replay the
    /// encrypted spool before returning admission to the caller.
    ///
    /// The supplied channel must already enforce the deployment's mTLS trust
    /// policy. TLS material loading and endpoint construction are owned by the
    /// deployment-composition slice.
    ///
    /// # Errors
    ///
    /// Returns a stable [`OutputGrpcError`] when configuration, restored state,
    /// bootstrap credit, transport, or spool recovery fails.
    pub async fn open(
        channel: Channel,
        spool: EncryptedOutputSpool,
        config: OutputGrpcConfig,
    ) -> Result<Self, OutputGrpcError> {
        let prepared =
            tokio::task::spawn_blocking(move || PreparedOutputSpool::prepare(spool, config))
                .await
                .map_err(|_| {
                    OutputGrpcError::Unavailable("the output spool task is unavailable")
                })??;
        prepared.connect(channel).await
    }

    /// Persist, transmit, authenticate the bound ACK, then retire the durable
    /// spool prefix. Calls are serialized by exclusive ownership.
    ///
    /// # Errors
    ///
    /// Returns a typed protocol, spool, or transport error. A failure never
    /// deletes an unacknowledged frame.
    pub async fn send(&mut self, frame: ExecutionOutputFrameV1) -> Result<u64, OutputGrpcError> {
        if frame.encoded_len() > self.max_frame_bytes {
            return Err(OutputGrpcError::Protocol(
                OutputSessionError::ResourceExhausted(
                    "the output frame exceeds the transport limit",
                ),
            ));
        }
        let permit = Arc::clone(&self.admission)
            .acquire_owned()
            .await
            .map_err(|_| OutputGrpcError::Unavailable("the output session task is unavailable"))?;
        let (response, result) = oneshot::channel();
        self.commands
            .send(SessionCommand::Send {
                frame: Box::new(frame),
                permit,
                response,
            })
            .await
            .map_err(|_| OutputGrpcError::Unavailable("the output session task is unavailable"))?;
        result
            .await
            .map_err(|_| OutputGrpcError::Unavailable("the output session task is unavailable"))?
    }

    /// Return the highest sequence whose bound Main ACK was durably applied to
    /// the local spool.
    #[must_use]
    pub fn acknowledged_sequence(&self) -> u64 {
        self.acknowledged_sequence.load(Ordering::Acquire)
    }

    /// Close the outbound half without changing any unacknowledged spool data.
    ///
    /// # Errors
    ///
    /// Returns a stable transport error if the output driver cannot close.
    pub async fn close(&mut self) -> Result<(), OutputGrpcError> {
        let _ignored = self.shutdown.send(true);
        if let Some(task) = self.task.take() {
            task.await.map_err(|_| {
                OutputGrpcError::Unavailable("the output session task is unavailable")
            })?;
        }
        Ok(())
    }
}

impl Drop for OutputGrpcSession {
    fn drop(&mut self) {
        let _ignored = self.shutdown.send(true);
    }
}

fn spawn_output_actor<S>(mut inner: OutputSession<S>, max_frame_bytes: usize) -> OutputGrpcSession
where
    S: OutputStreamIo + 'static,
{
    let (commands, mut receiver) = mpsc::channel(1);
    let admission = Arc::new(Semaphore::new(1));
    let (shutdown, mut shutdown_receiver) = watch::channel(false);
    let acknowledged_sequence = Arc::new(AtomicU64::new(inner.state.acknowledged_sequence()));
    let actor_acknowledged = Arc::clone(&acknowledged_sequence);
    let task = tokio::spawn(async move {
        loop {
            if *shutdown_receiver.borrow() {
                break;
            }
            let command = tokio::select! {
                biased;
                _ = shutdown_receiver.changed() => {
                    break;
                }
                command = receiver.recv() => match command {
                    Some(command) => command,
                    None => break,
                }
            };
            match command {
                SessionCommand::Send {
                    frame,
                    permit: _permit,
                    response,
                } => {
                    let result = inner
                        .send_with_shutdown(*frame, &mut shutdown_receiver)
                        .await;
                    actor_acknowledged
                        .store(inner.state.acknowledged_sequence(), Ordering::Release);
                    let _ignored = response.send(result);
                    if *shutdown_receiver.borrow() {
                        break;
                    }
                }
            }
        }
        let _ignored = inner.io.close().await;
    });
    OutputGrpcSession {
        commands,
        admission,
        acknowledged_sequence,
        max_frame_bytes,
        shutdown,
        task: Some(task),
    }
}

async fn run_spool<T, F>(
    mut spool: EncryptedOutputSpool,
    operation: F,
) -> Result<(EncryptedOutputSpool, Result<T, SpoolError>), OutputGrpcError>
where
    T: Send + 'static,
    F: FnOnce(&mut EncryptedOutputSpool) -> Result<T, SpoolError> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let result = operation(&mut spool);
        (spool, result)
    })
    .await
    .map_err(|_| OutputGrpcError::Unavailable("the output spool task is unavailable"))
}

fn valid_metadata_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_METADATA_BYTES
        && value.is_ascii()
        && !value.as_bytes().contains(&b'\0')
        && !value.as_bytes().contains(&b'\r')
        && !value.as_bytes().contains(&b'\n')
}

#[derive(Clone, Copy)]
enum RecoveryKind {
    Cancelled,
    Ambiguous,
}

fn validate_recovery_rebind(
    expected: &ExecutionOutputFrameV1,
    replacement: &ExecutionOutputFrameV1,
    kind: RecoveryKind,
) -> Result<(), OutputGrpcError> {
    let Some(expected_identity) = expected.identity.as_ref() else {
        return Err(recovery_binding_error(kind));
    };
    let Some(expected_fence) = expected.fence.as_ref() else {
        return Err(recovery_binding_error(kind));
    };
    let Some(replacement_identity) = replacement.identity.as_ref() else {
        return Err(recovery_binding_error(kind));
    };
    let Some(replacement_fence) = replacement.fence.as_ref() else {
        return Err(recovery_binding_error(kind));
    };
    let Some(settlement) = replacement.settlement_proposal.as_ref() else {
        return Err(recovery_binding_error(kind));
    };
    let expected_predecessor = replacement.sequence.checked_sub(1);
    if !replacement.terminal
        || replacement.sequence != expected.sequence
        || replacement.stream_id != expected.stream_id
        || replacement_identity != expected_identity
        || replacement_fence.claim_attempt <= expected_fence.claim_attempt
        || replacement_fence.lease_epoch <= expected_fence.lease_epoch
        || replacement_fence.fence_token == expected_fence.fence_token
        || replacement.claim_handoff_watermark < expected.claim_handoff_watermark
        || expected_predecessor != Some(replacement.claim_handoff_watermark)
    {
        return Err(recovery_binding_error(kind));
    }

    let valid_payload = match (kind, replacement.payload.as_ref()) {
        (
            RecoveryKind::Cancelled,
            Some(execution_output_frame_v1::Payload::RuntimeError(error)),
        ) => {
            error.code == RuntimeErrorCodeV1::Cancelled as i32
                && settlement.requested_outcome == ExecutionOutcomeV1::Cancelled as i32
        }
        (
            RecoveryKind::Ambiguous,
            Some(execution_output_frame_v1::Payload::RuntimeError(error)),
        ) => {
            expected.terminal
                && expected.logical_output_id == replacement.logical_output_id
                && expected.event_id == replacement.event_id
                && error.code == RuntimeErrorCodeV1::Internal as i32
                && error.safe_message == "The runtime operation failed."
                && !error.retryable
                && settlement.requested_outcome == ExecutionOutcomeV1::Failed as i32
        }
        _ => false,
    };
    if !valid_payload {
        return Err(recovery_binding_error(kind));
    }
    Ok(())
}

fn recovery_binding_error(kind: RecoveryKind) -> OutputGrpcError {
    let message = match kind {
        RecoveryKind::Cancelled => "the cancellation recovery replacement is not exactly bound",
        RecoveryKind::Ambiguous => "the ambiguous recovery replacement is not exactly bound",
    };
    OutputGrpcError::Protocol(OutputSessionError::AuthorizationFailed(message))
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::sync::Mutex;

    use prost::Message;
    use tokio::sync::Notify;

    use crate::protocol::elitea::runtime::v1::{
        DesiredExecutionStateV1, ExecutionFenceV1, ExecutionIdentityV1, RuntimeErrorV1,
        SettlementProposalV1,
    };
    use crate::spool::{
        ExecutionSpoolBinding, ExecutionSpoolIdentity, SpoolLimits, SpoolMasterKey,
    };

    use super::*;

    struct FakeStream {
        acknowledgements: VecDeque<Result<Option<ExecutionOutputAckV1>, OutputGrpcError>>,
        writes: Vec<ExecutionOutputFrameV1>,
        closed: bool,
    }

    struct GatedStream {
        acknowledgements: mpsc::Receiver<ExecutionOutputAckV1>,
        writes: Arc<Mutex<Vec<ExecutionOutputFrameV1>>>,
        wrote: Arc<Notify>,
    }

    #[async_trait]
    impl OutputStreamIo for FakeStream {
        async fn send(&mut self, frame: ExecutionOutputFrameV1) -> Result<(), OutputGrpcError> {
            self.writes.push(frame);
            Ok(())
        }

        async fn receive(&mut self) -> Result<Option<ExecutionOutputAckV1>, OutputGrpcError> {
            self.acknowledgements.pop_front().unwrap_or(Ok(None))
        }

        async fn close(&mut self) -> Result<(), OutputGrpcError> {
            self.closed = true;
            Ok(())
        }
    }

    #[async_trait]
    impl OutputStreamIo for GatedStream {
        async fn send(&mut self, frame: ExecutionOutputFrameV1) -> Result<(), OutputGrpcError> {
            self.writes.lock().expect("writes lock").push(frame);
            self.wrote.notify_one();
            Ok(())
        }

        async fn receive(&mut self) -> Result<Option<ExecutionOutputAckV1>, OutputGrpcError> {
            Ok(self.acknowledgements.recv().await)
        }

        async fn close(&mut self) -> Result<(), OutputGrpcError> {
            Ok(())
        }
    }

    fn config() -> OutputGrpcConfig {
        OutputGrpcConfig {
            max_queued_frames: 2,
            max_queued_bytes: 2_048,
            max_frame_bytes: 1_024,
            max_server_credit_frames: 2,
            max_server_credit_bytes: 2_048,
            stream_deadline: Duration::from_mins(5),
            ack_timeout: Duration::from_secs(1),
            workload_session_id: "session-1".to_owned(),
            producer_id: "worker-1".to_owned(),
        }
    }

    fn frame(sequence: u64, terminal: bool) -> ExecutionOutputFrameV1 {
        ExecutionOutputFrameV1 {
            output_schema_revision: "elitea.runtime.execution-output.v1".to_owned(),
            stream_id: "execution-1:1".to_owned(),
            identity: Some(ExecutionIdentityV1 {
                tenant_id: "tenant-1".to_owned(),
                resource_project_id: "resource-1".to_owned(),
                projection_project_id: "projection-1".to_owned(),
                command_id: "command-1".to_owned(),
                execution_id: "execution-1".to_owned(),
                generation: 1,
            }),
            fence: Some(ExecutionFenceV1 {
                workload_session_id: "session-1".to_owned(),
                producer_id: "worker-1".to_owned(),
                claim_attempt: 1,
                lease_epoch: 1,
                fence_token: vec![b'f'; 32],
            }),
            logical_output_id: format!("logical-{sequence}"),
            event_id: format!("event-{sequence}"),
            sequence,
            claim_handoff_watermark: 0,
            event_type: 0,
            occurred_at_unix_millis: 1_700_000_000_000,
            payload_digest: None,
            terminal,
            settlement_proposal: None,
            payload: None,
        }
    }

    fn bootstrap() -> ExecutionOutputAckV1 {
        ExecutionOutputAckV1 {
            credit_frames: 2,
            credit_bytes: 2_048,
            desired_state: DesiredExecutionStateV1::Running as i32,
            ..ExecutionOutputAckV1::default()
        }
    }

    fn bound_ack(frame: &ExecutionOutputFrameV1) -> ExecutionOutputAckV1 {
        ExecutionOutputAckV1 {
            stream_id: frame.stream_id.clone(),
            identity: frame.identity.clone(),
            fence: frame.fence.clone(),
            committed_contiguous_sequence: frame.sequence,
            claim_handoff_watermark: frame.claim_handoff_watermark,
            credit_frames: 2,
            credit_bytes: 2_048,
            desired_state: DesiredExecutionStateV1::Running as i32,
            rejection: None,
        }
    }

    fn rejection(
        frame: &ExecutionOutputFrameV1,
        code: RuntimeErrorCodeV1,
        retryable: bool,
    ) -> ExecutionOutputAckV1 {
        let mut rejection = bound_ack(frame);
        rejection.committed_contiguous_sequence = 0;
        rejection.credit_frames = 0;
        rejection.credit_bytes = 0;
        rejection.desired_state = DesiredExecutionStateV1::Unspecified as i32;
        rejection.rejection = Some(RuntimeErrorV1 {
            code: code as i32,
            safe_message: String::new(),
            retryable,
        });
        rejection
    }

    fn recovery_frame(
        expected: &ExecutionOutputFrameV1,
        kind: RecoveryKind,
    ) -> ExecutionOutputFrameV1 {
        let mut replacement = expected.clone();
        let fence = replacement.fence.as_mut().expect("replacement fence");
        fence.claim_attempt += 1;
        fence.lease_epoch += 1;
        fence.fence_token = if fence.fence_token == vec![b'g'; 32] {
            vec![b'h'; 32]
        } else {
            vec![b'g'; 32]
        };
        replacement.claim_handoff_watermark = replacement.sequence - 1;
        replacement.terminal = true;
        let (code, safe_message, outcome) = match kind {
            RecoveryKind::Cancelled => (
                RuntimeErrorCodeV1::Cancelled,
                "Execution was cancelled.",
                ExecutionOutcomeV1::Cancelled,
            ),
            RecoveryKind::Ambiguous => (
                RuntimeErrorCodeV1::Internal,
                "The runtime operation failed.",
                ExecutionOutcomeV1::Failed,
            ),
        };
        replacement.payload = Some(execution_output_frame_v1::Payload::RuntimeError(
            RuntimeErrorV1 {
                code: code as i32,
                safe_message: safe_message.to_owned(),
                retryable: false,
            },
        ));
        replacement.settlement_proposal = Some(SettlementProposalV1 {
            requested_outcome: outcome as i32,
            ..SettlementProposalV1::default()
        });
        replacement
    }

    fn try_spool(root: &Path) -> Result<EncryptedOutputSpool, SpoolError> {
        if !root.exists() {
            fs::create_dir(root).expect("spool root");
            fs::set_permissions(root, fs::Permissions::from_mode(0o700)).expect("private root");
        }
        let root = fs::canonicalize(root).expect("canonical spool root");
        let binding = ExecutionSpoolBinding::new(&ExecutionSpoolIdentity {
            tenant_id: "tenant-1".to_owned(),
            resource_project_id: "resource-1".to_owned(),
            projection_project_id: "projection-1".to_owned(),
            command_id: "command-1".to_owned(),
            execution_id: "execution-1".to_owned(),
            generation: 1,
            producer_id: "worker-1".to_owned(),
        })
        .expect("binding");
        EncryptedOutputSpool::open(
            &root,
            &SpoolMasterKey::new([7; 32]),
            &binding,
            SpoolLimits {
                max_frames: 2,
                max_encrypted_bytes: 2_176,
                max_frame_bytes: 1_024,
            },
        )
    }

    fn spool(root: &Path) -> EncryptedOutputSpool {
        try_spool(root).expect("spool")
    }

    #[test]
    fn prepared_spool_persists_and_restores_exact_bytes_without_a_network() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let root = temp.path().join("root");
        let first = frame(1, false);
        let mut prepared =
            PreparedOutputSpool::prepare(spool(&root), config()).expect("prepared spool");
        assert!(prepared.pending_replay_frame().is_none());
        assert_eq!(prepared.persist(first.clone()).expect("durable frame"), 1);
        assert!(prepared.replays(&first));
        drop(prepared);

        let recovered =
            PreparedOutputSpool::prepare(spool(&root), config()).expect("restored spool");
        assert_eq!(recovered.pending_replay_frame(), Some(first.clone()));
        assert!(recovered.replays(&first));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn offline_persisted_frame_replays_once_and_restores_capacity_one() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let first = frame(1, false);
        let second = frame(2, false);
        let mut bounded = config();
        bounded.max_queued_frames = 1;
        bounded.max_server_credit_frames = 1;
        let mut bootstrap = bootstrap();
        bootstrap.credit_frames = 1;
        let mut first_ack = bound_ack(&first);
        first_ack.credit_frames = 1;
        let mut second_ack = bound_ack(&second);
        second_ack.credit_frames = 1;

        let mut prepared = PreparedOutputSpool::prepare(spool(&temp.path().join("root")), bounded)
            .expect("prepared spool");
        prepared
            .persist(first.clone())
            .expect("offline persisted frame");
        let io = FakeStream {
            acknowledgements: VecDeque::from([
                Ok(Some(bootstrap)),
                Ok(Some(first_ack)),
                Ok(Some(second_ack)),
            ]),
            writes: Vec::new(),
            closed: false,
        };
        let mut session = OutputSession::from_prepared(io, prepared)
            .await
            .expect("exact replay");
        assert_eq!(session.io.writes, vec![first]);
        assert_eq!(
            session
                .send(second.clone())
                .await
                .expect("capacity restored"),
            2
        );
        assert_eq!(session.io.writes, vec![frame(1, false), second]);
        assert!(
            session
                .spool
                .as_mut()
                .expect("spool")
                .pending()
                .expect("pending")
                .is_empty()
        );
    }

    #[test]
    fn terminal_admission_ends_both_live_and_restored_durable_streams() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let root = temp.path().join("root");
        let terminal = frame(1, true);
        let mut prepared =
            PreparedOutputSpool::prepare(spool(&root), config()).expect("prepared spool");
        prepared
            .persist(terminal.clone())
            .expect("durable terminal");
        assert!(matches!(
            prepared.persist(frame(2, false)),
            Err(OutputGrpcError::Protocol(OutputSessionError::InvalidInput(
                _
            )))
        ));
        drop(prepared);

        let mut invalid_spool = spool(&root);
        invalid_spool
            .put(
                NonZeroU64::new(2).expect("nonzero"),
                &frame(2, false).encode_to_vec(),
            )
            .expect("corrupt continuation fixture");
        drop(invalid_spool);
        assert!(matches!(
            PreparedOutputSpool::prepare(spool(&root), config()),
            Err(OutputGrpcError::Protocol(OutputSessionError::InvalidInput(
                _
            )))
        ));
    }

    #[test]
    fn reconciliation_requires_the_complete_prefix_and_finalizes_the_spool() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let mut prepared = PreparedOutputSpool::prepare(spool(&temp.path().join("root")), config())
            .expect("prepared spool");
        prepared
            .reconcile_pending_through(1)
            .expect("empty spool reconciliation is a no-op");
        prepared.persist(frame(1, false)).expect("first frame");
        prepared.persist(frame(2, false)).expect("second frame");
        assert!(matches!(
            prepared.reconcile_pending_through(1),
            Err(OutputGrpcError::Protocol(
                OutputSessionError::AuthorizationFailed(_)
            ))
        ));
        prepared
            .reconcile_pending_through(2)
            .expect("complete receipt");
        assert!(matches!(
            prepared.persist(frame(3, false)),
            Err(OutputGrpcError::Protocol(
                OutputSessionError::AuthorizationFailed(_)
            ))
        ));
    }

    #[test]
    fn reconciliation_rejects_watermarks_outside_the_durable_integer_domain() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let mut prepared = PreparedOutputSpool::prepare(spool(&temp.path().join("root")), config())
            .expect("prepared spool");
        assert!(matches!(
            prepared.reconcile_pending_through(i64::MAX as u64 + 1),
            Err(OutputGrpcError::Protocol(OutputSessionError::InvalidInput(
                _
            )))
        ));
    }

    #[test]
    fn exact_replacement_recomputes_terminal_state_before_durable_cas() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let first = frame(1, false);
        let mut replacement = first.clone();
        replacement.terminal = true;
        let mut prepared = PreparedOutputSpool::prepare(spool(&temp.path().join("root")), config())
            .expect("prepared spool");
        prepared.persist(first.clone()).expect("first frame");
        prepared
            .replace_pending_exact(&first, &replacement)
            .expect("terminal CAS");
        assert!(prepared.replays(&replacement));
        assert!(matches!(
            prepared.persist(frame(2, false)),
            Err(OutputGrpcError::Protocol(OutputSessionError::InvalidInput(
                _
            )))
        ));
    }

    #[test]
    fn recovery_rebinds_are_canonical_and_cas_the_exact_old_fence() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let root = temp.path().join("root");
        let old_progress = frame(1, false);
        let cancelled = recovery_frame(&old_progress, RecoveryKind::Cancelled);
        let mut prepared =
            PreparedOutputSpool::prepare(spool(&root), config()).expect("prepared spool");
        prepared
            .persist(old_progress.clone())
            .expect("old progress");
        prepared
            .replace_pending_cancelled_recovery(&old_progress, &cancelled)
            .expect("cancelled recovery");
        assert!(prepared.replays(&cancelled));
        drop(prepared);

        let mut prepared =
            PreparedOutputSpool::prepare(spool(&root), config()).expect("restored cancellation");
        let ambiguous = recovery_frame(&cancelled, RecoveryKind::Ambiguous);
        let mut malformed = ambiguous.clone();
        if let Some(execution_output_frame_v1::Payload::RuntimeError(error)) =
            malformed.payload.as_mut()
        {
            error.safe_message = "different".to_owned();
        }
        assert!(matches!(
            prepared.replace_pending_ambiguous_recovery(&cancelled, &malformed),
            Err(OutputGrpcError::Protocol(
                OutputSessionError::AuthorizationFailed(_)
            ))
        ));
        assert!(prepared.replays(&cancelled));
        prepared
            .replace_pending_ambiguous_recovery(&cancelled, &ambiguous)
            .expect("ambiguous recovery");
        assert!(prepared.replays(&ambiguous));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_is_spooled_before_send_and_deleted_only_after_bound_ack() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let first = frame(1, false);
        let io = FakeStream {
            acknowledgements: VecDeque::from([Ok(Some(bootstrap())), Ok(Some(bound_ack(&first)))]),
            writes: Vec::new(),
            closed: false,
        };
        let mut session = OutputSession::open(io, spool(&temp.path().join("root")), config())
            .await
            .expect("session");
        assert_eq!(session.send(first.clone()).await.expect("committed"), 1);
        assert_eq!(session.state.acknowledged_sequence(), 1);
        assert_eq!(session.io.writes, vec![first]);
        assert!(
            session
                .spool
                .as_mut()
                .expect("spool")
                .pending()
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn lost_ack_preserves_exact_spool_for_next_session_replay() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let first = frame(1, true);
        let io = FakeStream {
            acknowledgements: VecDeque::from([Ok(Some(bootstrap())), Ok(None)]),
            writes: Vec::new(),
            closed: false,
        };
        let mut failed = OutputSession::open(io, spool(&temp.path().join("root")), config())
            .await
            .expect("session");
        assert!(matches!(
            failed.send(first.clone()).await,
            Err(OutputGrpcError::Unavailable(_))
        ));
        let spool = failed.spool.take().expect("preserved spool");
        let replay_io = FakeStream {
            acknowledgements: VecDeque::from([Ok(Some(bootstrap())), Ok(Some(bound_ack(&first)))]),
            writes: Vec::new(),
            closed: false,
        };
        let recovered = OutputSession::open(replay_io, spool, config())
            .await
            .expect("replay");
        assert_eq!(recovered.io.writes, vec![first]);
        assert_eq!(recovered.state.acknowledged_sequence(), 1);
        assert!(recovered.terminal_committed);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_failed_stream_cannot_be_reused_after_preserving_its_spool() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let first = frame(1, false);
        let io = FakeStream {
            acknowledgements: VecDeque::from([Ok(Some(bootstrap())), Ok(None)]),
            writes: Vec::new(),
            closed: false,
        };
        let mut failed = OutputSession::open(io, spool(&temp.path().join("root")), config())
            .await
            .expect("session");
        assert!(failed.send(first).await.is_err());
        assert!(matches!(
            failed.send(frame(2, false)).await,
            Err(OutputGrpcError::Unavailable(_))
        ));
        assert_eq!(
            failed
                .spool
                .as_mut()
                .expect("spool")
                .pending()
                .expect("pending")
                .len(),
            1
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn retryable_and_authorization_rejections_preserve_the_exact_spool() {
        for (ordinal, code, retryable, expected_dependency) in [
            (1, RuntimeErrorCodeV1::DependencyUnavailable, true, true),
            (2, RuntimeErrorCodeV1::Internal, true, true),
            (3, RuntimeErrorCodeV1::AuthenticationFailed, true, false),
            (4, RuntimeErrorCodeV1::StaleFence, true, false),
        ] {
            let temp = tempfile::tempdir().expect("temporary directory");
            let current = frame(1, false);
            let io = FakeStream {
                acknowledgements: VecDeque::from([
                    Ok(Some(bootstrap())),
                    Ok(Some(rejection(&current, code, retryable))),
                ]),
                writes: Vec::new(),
                closed: false,
            };
            let mut session = OutputSession::open(
                io,
                spool(&temp.path().join(format!("root-{ordinal}"))),
                config(),
            )
            .await
            .expect("session");
            let result = session.send(current.clone()).await;
            if expected_dependency {
                assert!(matches!(
                    result,
                    Err(OutputGrpcError::Protocol(
                        OutputSessionError::DependencyUnavailable
                    ))
                ));
            } else {
                assert!(matches!(
                    result,
                    Err(OutputGrpcError::Protocol(
                        OutputSessionError::AuthorizationFailed(_)
                    ))
                ));
            }
            let pending = session
                .spool
                .as_mut()
                .expect("spool")
                .pending()
                .expect("preserved rejection spool");
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].payload, current.encode_to_vec());
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn prior_watermark_ack_is_applied_but_waits_for_the_current_commit() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let first = frame(1, false);
        let second = frame(2, true);
        let mut prior = bound_ack(&second);
        prior.committed_contiguous_sequence = 1;
        let io = FakeStream {
            acknowledgements: VecDeque::from([
                Ok(Some(bootstrap())),
                Ok(Some(bound_ack(&first))),
                Ok(Some(prior)),
                Ok(Some(bound_ack(&second))),
            ]),
            writes: Vec::new(),
            closed: false,
        };
        let mut session = OutputSession::open(io, spool(&temp.path().join("root")), config())
            .await
            .expect("session");
        assert_eq!(session.send(first).await.expect("first commit"), 1);
        assert_eq!(session.send(second).await.expect("second commit"), 2);
        let pending = session
            .spool
            .as_mut()
            .expect("spool")
            .pending()
            .expect("pending terminal");
        assert!(pending.is_empty());
        assert!(session.terminal_committed);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn zero_bootstrap_credit_waits_for_a_bound_absolute_replenishment() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let current = frame(1, false);
        let mut zero = bootstrap();
        zero.credit_frames = 0;
        zero.credit_bytes = 0;
        let mut replenished = bound_ack(&current);
        replenished.committed_contiguous_sequence = 0;
        let io = FakeStream {
            acknowledgements: VecDeque::from([
                Ok(Some(zero)),
                Ok(Some(replenished)),
                Ok(Some(bound_ack(&current))),
            ]),
            writes: Vec::new(),
            closed: false,
        };
        let mut session = OutputSession::open(io, spool(&temp.path().join("root")), config())
            .await
            .expect("session");
        assert_eq!(session.send(current.clone()).await.expect("commit"), 1);
        assert_eq!(session.io.writes, vec![current]);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cancelling_a_caller_wait_cannot_reassign_its_ack_to_the_next_frame() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let (acknowledgements, receiver) = mpsc::channel(4);
        acknowledgements
            .send(bootstrap())
            .await
            .expect("bootstrap ACK");
        let writes = Arc::new(Mutex::new(Vec::new()));
        let wrote = Arc::new(Notify::new());
        let io = GatedStream {
            acknowledgements: receiver,
            writes: Arc::clone(&writes),
            wrote: Arc::clone(&wrote),
        };
        let inner = OutputSession::open(io, spool(&temp.path().join("root")), config())
            .await
            .expect("session");
        let mut session = spawn_output_actor(inner, config().max_frame_bytes);
        let first = frame(1, false);
        {
            let first_wait = session.send(first.clone());
            tokio::pin!(first_wait);
            tokio::select! {
                result = &mut first_wait => panic!("send returned before its ACK: {result:?}"),
                () = wrote.notified() => {}
            }
        }

        let second = frame(2, false);
        let second_result = {
            let second_wait = session.send(second.clone());
            tokio::pin!(second_wait);
            assert!(
                timeout(Duration::from_millis(10), &mut second_wait)
                    .await
                    .is_err(),
                "the next command bypassed the first command's actor permit"
            );
            assert_eq!(writes.lock().expect("writes lock").len(), 1);
            acknowledgements
                .send(bound_ack(&first))
                .await
                .expect("first bound ACK");
            acknowledgements
                .send(bound_ack(&second))
                .await
                .expect("second bound ACK");
            second_wait.await
        };
        assert_eq!(second_result.expect("second commit"), 2);
        assert_eq!(session.acknowledged_sequence(), 2);
        assert_eq!(*writes.lock().expect("writes lock"), vec![first, second]);
        session.close().await.expect("close actor");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn close_interrupts_an_ack_blocked_actor_and_releases_the_spool_lock() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let root = temp.path().join("root");
        let (acknowledgements, receiver) = mpsc::channel(1);
        acknowledgements
            .send(bootstrap())
            .await
            .expect("bootstrap ACK");
        let wrote = Arc::new(Notify::new());
        let io = GatedStream {
            acknowledgements: receiver,
            writes: Arc::new(Mutex::new(Vec::new())),
            wrote: Arc::clone(&wrote),
        };
        let inner = OutputSession::open(io, spool(&root), config())
            .await
            .expect("session");
        let mut session = spawn_output_actor(inner, config().max_frame_bytes);
        {
            let wait = session.send(frame(1, false));
            tokio::pin!(wait);
            tokio::select! {
                result = &mut wait => panic!("send returned before close: {result:?}"),
                () = wrote.notified() => {}
            }
        }
        timeout(Duration::from_secs(1), session.close())
            .await
            .expect("bounded close")
            .expect("closed actor");
        let mut reopened = spool(&root);
        assert_eq!(reopened.pending().expect("pending frame").len(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn drop_interrupts_an_ack_blocked_actor_and_eventually_releases_the_spool_lock() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let root = temp.path().join("root");
        let (acknowledgements, receiver) = mpsc::channel(1);
        acknowledgements
            .send(bootstrap())
            .await
            .expect("bootstrap ACK");
        let wrote = Arc::new(Notify::new());
        let io = GatedStream {
            acknowledgements: receiver,
            writes: Arc::new(Mutex::new(Vec::new())),
            wrote: Arc::clone(&wrote),
        };
        let inner = OutputSession::open(io, spool(&root), config())
            .await
            .expect("session");
        let mut session = spawn_output_actor(inner, config().max_frame_bytes);
        {
            let wait = session.send(frame(1, false));
            tokio::pin!(wait);
            tokio::select! {
                result = &mut wait => panic!("send returned before drop: {result:?}"),
                () = wrote.notified() => {}
            }
        }
        drop(session);

        let mut reopened = timeout(Duration::from_secs(1), async {
            loop {
                match try_spool(&root) {
                    Ok(spool) => break spool,
                    Err(SpoolError::OwnershipUnavailable(_)) => tokio::task::yield_now().await,
                    Err(error) => panic!("unexpected reopen failure: {error}"),
                }
            }
        })
        .await
        .expect("bounded drop cleanup");
        assert_eq!(reopened.pending().expect("pending frame").len(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn oversized_frame_is_rejected_before_actor_queue_admission() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let (acknowledgements, receiver) = mpsc::channel(1);
        acknowledgements
            .send(bootstrap())
            .await
            .expect("bootstrap ACK");
        let writes = Arc::new(Mutex::new(Vec::new()));
        let io = GatedStream {
            acknowledgements: receiver,
            writes: Arc::clone(&writes),
            wrote: Arc::new(Notify::new()),
        };
        let inner = OutputSession::open(io, spool(&temp.path().join("root")), config())
            .await
            .expect("session");
        let mut session = spawn_output_actor(inner, config().max_frame_bytes);
        let mut oversized = frame(1, false);
        oversized.logical_output_id = "x".repeat(2_048);
        assert!(matches!(
            session.send(oversized).await,
            Err(OutputGrpcError::Protocol(
                OutputSessionError::ResourceExhausted(_)
            ))
        ));
        assert!(writes.lock().expect("writes lock").is_empty());
        session.close().await.expect("close actor");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn malformed_bootstrap_and_early_eof_leave_spool_intact() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let mut invalid = bootstrap();
        invalid.credit_frames = 3;
        let io = FakeStream {
            acknowledgements: VecDeque::from([Ok(Some(invalid))]),
            writes: Vec::new(),
            closed: false,
        };
        assert!(matches!(
            OutputSession::open(io, spool(&temp.path().join("root")), config()).await,
            Err(OutputGrpcError::Protocol(OutputSessionError::InvalidInput(
                _
            )))
        ));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn early_eof_during_replay_preserves_the_durable_frame() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let root = temp.path().join("root");
        let pending_frame = frame(1, false);
        let mut initial_spool = spool(&root);
        initial_spool
            .put(
                NonZeroU64::new(1).expect("nonzero"),
                &pending_frame.encode_to_vec(),
            )
            .expect("pending frame");
        let io = FakeStream {
            acknowledgements: VecDeque::from([Ok(Some(bootstrap())), Ok(None)]),
            writes: Vec::new(),
            closed: false,
        };
        assert!(matches!(
            OutputSession::open(io, initial_spool, config()).await,
            Err(OutputGrpcError::Unavailable(_))
        ));
        let mut reopened = spool(&root);
        let pending = reopened.pending().expect("preserved pending frame");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].payload, pending_frame.encode_to_vec());
    }

    #[test]
    fn metadata_is_exact_ascii_bounded_and_control_free() {
        assert!(valid_metadata_value("session-1"));
        assert!(!valid_metadata_value(""));
        assert!(!valid_metadata_value("line\nfeed"));
        assert!(!valid_metadata_value("nul\0byte"));
        assert!(!valid_metadata_value("é"));
        assert!(!valid_metadata_value(&"x".repeat(257)));
    }

    #[test]
    fn deployment_limits_are_bounded_to_protocol_v1() {
        let mut invalid = config();
        invalid.max_queued_frames = 129;
        assert!(invalid.validate().is_err());
        let mut invalid = config();
        invalid.max_frame_bytes = MAX_OUTPUT_FRAME_BYTES + 1;
        assert!(invalid.validate().is_err());
        let mut invalid = config();
        invalid.ack_timeout = Duration::from_secs(301);
        assert!(invalid.validate().is_err());
        let mut invalid = config();
        invalid.stream_deadline = Duration::from_secs(3_601);
        assert!(invalid.validate().is_err());
    }
}
