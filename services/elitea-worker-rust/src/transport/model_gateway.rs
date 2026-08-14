//! Hardened Elitea OpenAI-compatible model gateway for ADK-Rust 2.0.0.
//!
//! The stock ADK OpenAI-compatible provider owns an unrestricted HTTP client
//! and includes upstream response bodies in errors. The worker instead keeps a
//! shared origin-bound mTLS HTTP/2 channel, consumes one claim-scoped PAT into
//! one single-use model, bounds every request/SSE allocation, and exposes only
//! stable data-free failures. This module intentionally supports the first
//! ordinary text/no-tool profile only; production assembly remains disabled.

#![allow(dead_code)] // The production assembler lands after this transport proof.

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use adk_rust::{
    AdkError, Content, ErrorCategory, ErrorComponent, FinishReason, GenerateContentConfig, Llm,
    LlmRequest, LlmResponse, LlmResponseStream, Part,
};
use async_stream::try_stream;
use async_trait::async_trait;
use bytes::Bytes;
use http::header::{ACCEPT, AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE};
use http::{HeaderMap, HeaderName, HeaderValue, Method, Request, Response, StatusCode, Version};
use http_body_util::{BodyExt as _, Full};
use tokio::time::timeout;
use tonic::body::Body;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Endpoint, Identity};
use tower::ServiceExt as _;
use zeroize::Zeroizing;

use super::runtime_context::ClaimScopedEliteaContext;
use crate::agents::runtime::{NativeAgentAssemblyError, NativeAgentAssemblyErrorCode};
use crate::agents::session::BoundOrdinaryAgentModel;

const MODEL_ROUTE: &str = "/llm/v1/chat/completions";
const MAX_ORIGIN_BYTES: usize = 2_048;
const MAX_MODEL_NAME_BYTES: usize = 256;
const MAX_INSTRUCTION_BYTES: usize = 64 * 1_024;
const MAX_REQUEST_BYTES: usize = 1_024 * 1_024;
const MAX_SSE_EVENT_BYTES: usize = 256 * 1_024;
const MAX_STREAM_BYTES: usize = 8 * 1_024 * 1_024;
const MAX_COMPLETION_BYTES: usize = 60 * 1_024;
const MAX_SSE_EVENTS: usize = 4_096;
const MAX_TIMEOUT: Duration = Duration::from_mins(5);
const OPENAI_ORGANIZATION: HeaderName = HeaderName::from_static("openai-organization");

/// Immutable deployment policy for the shared platform model channel.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ModelGatewayConfig {
    pub(crate) origin: String,
    pub(crate) connect_timeout: Duration,
    pub(crate) response_header_timeout: Duration,
    pub(crate) stream_idle_timeout: Duration,
    pub(crate) max_request_bytes: usize,
    pub(crate) max_sse_event_bytes: usize,
    pub(crate) max_stream_bytes: usize,
    pub(crate) max_sse_events: usize,
}

impl ModelGatewayConfig {
    fn validate(&self) -> Result<String, ModelGatewayError> {
        let origin = canonical_https_origin(&self.origin)?;
        if !valid_timeout(self.connect_timeout)
            || !valid_timeout(self.response_header_timeout)
            || !valid_timeout(self.stream_idle_timeout)
            || self.max_request_bytes == 0
            || self.max_request_bytes > MAX_REQUEST_BYTES
            || self.max_sse_event_bytes == 0
            || self.max_sse_event_bytes > MAX_SSE_EVENT_BYTES
            || self.max_stream_bytes < self.max_sse_event_bytes
            || self.max_stream_bytes > MAX_STREAM_BYTES
            || self.max_sse_events == 0
            || self.max_sse_events > MAX_SSE_EVENTS
        {
            return Err(ModelGatewayError::InvalidConfiguration);
        }
        Ok(origin)
    }
}

/// Frozen generation controls admitted before the PAT reaches this module.
pub(crate) struct ModelGatewayInvocation {
    pub(crate) model_name: String,
    pub(crate) system_instruction: String,
    pub(crate) max_tokens: u32,
    pub(crate) reasoning_effort: Option<ModelReasoningEffort>,
    pub(crate) temperature: Option<f32>,
}

/// OpenAI-compatible reasoning control preserved from the frozen SDK input.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ModelReasoningEffort {
    Low,
    Medium,
    High,
    None,
}

impl ModelReasoningEffort {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::None => "none",
        }
    }
}

/// Stable, data-free model-gateway setup failure.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ModelGatewayError {
    InvalidConfiguration,
    InvalidInvocation,
    ResourceExhausted,
    DependencyUnavailable,
}

impl ModelGatewayError {
    #[must_use]
    pub(crate) const fn code(self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "model_gateway.invalid_configuration",
            Self::InvalidInvocation => "model_gateway.invalid_invocation",
            Self::ResourceExhausted => "model_gateway.resource_exhausted",
            Self::DependencyUnavailable => "model_gateway.dependency_unavailable",
        }
    }

    #[must_use]
    pub(crate) const fn retryable(self) -> bool {
        matches!(self, Self::DependencyUnavailable)
    }
}

impl fmt::Display for ModelGatewayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "the model gateway configuration is malformed",
            Self::InvalidInvocation => "the model gateway invocation is malformed",
            Self::ResourceExhausted => "the model gateway request exceeds its approved limit",
            Self::DependencyUnavailable => "the model gateway is unavailable",
        })
    }
}

impl std::error::Error for ModelGatewayError {}

#[async_trait]
trait ModelGatewayTransport: Send + Sync {
    async fn post(
        &self,
        request: Request<Body>,
    ) -> Result<Response<Body>, ModelGatewayTransportError>;
}

#[derive(Clone)]
struct TonicModelGatewayTransport {
    channel: Channel,
}

#[async_trait]
impl ModelGatewayTransport for TonicModelGatewayTransport {
    async fn post(
        &self,
        request: Request<Body>,
    ) -> Result<Response<Body>, ModelGatewayTransportError> {
        self.channel
            .clone()
            .oneshot(request)
            .await
            .map_err(ModelGatewayTransportError::Tonic)
    }
}

enum ModelGatewayTransportError {
    Unavailable,
    Tonic(tonic::transport::Error),
}

impl fmt::Debug for ModelGatewayTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ModelGatewayTransportError(..)")
    }
}

impl fmt::Display for ModelGatewayTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the model gateway transport is unavailable")
    }
}

impl std::error::Error for ModelGatewayTransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Unavailable => None,
            Self::Tonic(error) => Some(error),
        }
    }
}

/// Shared connection pool for claim-scoped model invocations.
pub(crate) struct ModelGatewayClient {
    transport: Arc<dyn ModelGatewayTransport>,
    config: ModelGatewayConfig,
}

impl ModelGatewayClient {
    /// Build one reusable mTLS HTTP/2 channel from the trusted platform origin.
    pub(crate) async fn connect(
        mut config: ModelGatewayConfig,
        private_ca: Certificate,
        client_identity: Identity,
    ) -> Result<Self, ModelGatewayError> {
        let origin = config.validate()?;
        let tls = ClientTlsConfig::new()
            .ca_certificate(private_ca)
            .identity(client_identity);
        let endpoint = Endpoint::from_shared(origin.clone())
            .and_then(|endpoint| endpoint.tls_config(tls))
            .map_err(|_| ModelGatewayError::InvalidConfiguration)?;
        let channel = timeout(config.connect_timeout, endpoint.connect())
            .await
            .map_err(|_| ModelGatewayError::DependencyUnavailable)?
            .map_err(|_| ModelGatewayError::DependencyUnavailable)?;
        config.origin = origin;
        Ok(Self {
            transport: Arc::new(TonicModelGatewayTransport { channel }),
            config,
        })
    }

    #[cfg(test)]
    fn with_rpc(
        transport: impl ModelGatewayTransport + 'static,
        mut config: ModelGatewayConfig,
    ) -> Result<Self, ModelGatewayError> {
        config.origin = config.validate()?;
        Ok(Self {
            transport: Arc::new(transport),
            config,
        })
    }

    /// Consume one ephemeral claim credential into one single-use ADK model.
    pub(crate) fn bind_ordinary(
        &self,
        context: ClaimScopedEliteaContext,
        invocation: ModelGatewayInvocation,
    ) -> Result<BoundModelGateway, ModelGatewayError> {
        validate_invocation(&invocation)?;
        let (project_id, token) = context.into_model_gateway_parts();
        if project_id == 0 || i64::try_from(project_id).is_err() || token.is_empty() {
            return Err(ModelGatewayError::InvalidInvocation);
        }
        let completion = Arc::new(Mutex::new(CompletionState::default()));
        let model = Arc::new(EliteaOpenAiCompatibleModel {
            transport: self.transport.clone(),
            config: self.config.clone(),
            invocation,
            project_id,
            token,
            completion: completion.clone(),
            called: AtomicBool::new(false),
        });
        Ok(BoundModelGateway {
            model,
            completion: ModelGatewayCompletion { state: completion },
        })
    }
}

/// Inseparable single-use model and its exact completion capture.
pub(crate) struct BoundModelGateway {
    model: Arc<EliteaOpenAiCompatibleModel>,
    completion: ModelGatewayCompletion,
}

impl BoundOrdinaryAgentModel for BoundModelGateway {
    fn adk_model(&self) -> Arc<dyn Llm> {
        self.model.clone()
    }

    fn take_completed_text(self) -> Result<String, NativeAgentAssemblyError> {
        self.completion.take().map_err(model_completion_error)
    }
}

fn model_completion_error(error: ModelGatewayError) -> NativeAgentAssemblyError {
    let code = match error {
        ModelGatewayError::InvalidConfiguration => {
            NativeAgentAssemblyErrorCode::InvalidConfiguration
        }
        ModelGatewayError::InvalidInvocation => NativeAgentAssemblyErrorCode::InvalidResult,
        ModelGatewayError::ResourceExhausted => NativeAgentAssemblyErrorCode::ResourceExhausted,
        ModelGatewayError::DependencyUnavailable => {
            NativeAgentAssemblyErrorCode::DependencyUnavailable
        }
    };
    NativeAgentAssemblyError::new(code, "the bound model completion is unavailable")
}

#[cfg(test)]
impl BoundModelGateway {
    pub(super) async fn generate_for_test(
        &self,
        request: LlmRequest,
    ) -> Result<LlmResponseStream, AdkError> {
        self.model.generate_content(request, true).await
    }

    pub(super) fn take_completion_for_test(self) -> Result<String, ModelGatewayError> {
        self.completion.take()
    }
}

#[derive(Default)]
struct CompletionState {
    value: Option<String>,
    consumed: bool,
}

struct ModelGatewayCompletion {
    state: Arc<Mutex<CompletionState>>,
}

impl ModelGatewayCompletion {
    fn take(self) -> Result<String, ModelGatewayError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| ModelGatewayError::DependencyUnavailable)?;
        if state.consumed {
            return Err(ModelGatewayError::InvalidInvocation);
        }
        let value = state
            .value
            .take()
            .ok_or(ModelGatewayError::InvalidInvocation)?;
        state.consumed = true;
        Ok(value)
    }
}

struct EliteaOpenAiCompatibleModel {
    transport: Arc<dyn ModelGatewayTransport>,
    config: ModelGatewayConfig,
    invocation: ModelGatewayInvocation,
    project_id: u64,
    token: Zeroizing<String>,
    completion: Arc<Mutex<CompletionState>>,
    called: AtomicBool,
}

#[async_trait]
impl Llm for EliteaOpenAiCompatibleModel {
    fn name(&self) -> &str {
        &self.invocation.model_name
    }

    async fn generate_content(
        &self,
        request: LlmRequest,
        stream: bool,
    ) -> Result<LlmResponseStream, AdkError> {
        if self.called.swap(true, Ordering::AcqRel) {
            return Err(model_error(
                ErrorCategory::InvalidInput,
                "model_gateway.reused",
                "the claim-scoped model invocation was already consumed",
            ));
        }
        let body = build_request_body(&request, stream, &self.invocation, &self.config)?;
        let request = build_http_request(body, self.project_id, self.token.as_str())?;
        let response = timeout(
            self.config.response_header_timeout,
            self.transport.post(request),
        )
        .await
        .map_err(|_| {
            model_error(
                ErrorCategory::Timeout,
                "model_gateway.response_header_timeout",
                "the model gateway response header timed out",
            )
        })?
        .map_err(|_| {
            model_error(
                ErrorCategory::Unavailable,
                "model_gateway.transport",
                "the model gateway transport is unavailable",
            )
        })?;
        validate_response_head(&response)?;
        Ok(model_response_stream(
            response,
            self.config.stream_idle_timeout,
            self.config.max_sse_event_bytes,
            self.config.max_stream_bytes,
            self.config.max_sse_events,
            self.completion.clone(),
        ))
    }
}

fn validate_invocation(invocation: &ModelGatewayInvocation) -> Result<(), ModelGatewayError> {
    if !bounded_header_text(&invocation.model_name, MAX_MODEL_NAME_BYTES)
        || invocation.system_instruction.is_empty()
        || invocation.system_instruction.len() > MAX_INSTRUCTION_BYTES
        || invocation.system_instruction.contains('\0')
        || invocation.max_tokens == 0
        || i32::try_from(invocation.max_tokens).is_err()
        || (invocation
            .reasoning_effort
            .is_some_and(|effort| effort != ModelReasoningEffort::None)
            && invocation.temperature.is_some())
        || invocation
            .temperature
            .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
    {
        return Err(ModelGatewayError::InvalidInvocation);
    }
    Ok(())
}

fn build_request_body(
    request: &LlmRequest,
    stream: bool,
    invocation: &ModelGatewayInvocation,
    config: &ModelGatewayConfig,
) -> Result<Bytes, AdkError> {
    let user_text = validate_llm_request(request, stream, invocation)?;
    let mut body = serde_json::Map::new();
    body.insert(
        "model".to_owned(),
        serde_json::Value::String(invocation.model_name.clone()),
    );
    body.insert(
        "messages".to_owned(),
        serde_json::json!([
            {"role": instruction_role(&invocation.model_name), "content": invocation.system_instruction},
            {"role": "user", "content": user_text},
        ]),
    );
    body.insert("stream".to_owned(), serde_json::Value::Bool(true));
    body.insert(
        "stream_options".to_owned(),
        serde_json::json!({"include_usage": true}),
    );
    body.insert(
        "max_completion_tokens".to_owned(),
        serde_json::Value::from(invocation.max_tokens),
    );
    if let Some(temperature) = invocation.temperature {
        body.insert(
            "temperature".to_owned(),
            serde_json::Value::from(temperature),
        );
    }
    if let Some(reasoning_effort) = invocation.reasoning_effort {
        body.insert(
            "reasoning_effort".to_owned(),
            serde_json::Value::String(reasoning_effort.as_str().to_owned()),
        );
    }
    let encoded = serde_json::to_vec(&body).map_err(|_| {
        model_error(
            ErrorCategory::InvalidInput,
            "model_gateway.request_encoding",
            "the model gateway request is malformed",
        )
    })?;
    if encoded.len() > config.max_request_bytes {
        return Err(model_error(
            ErrorCategory::InvalidInput,
            "model_gateway.request_too_large",
            "the model gateway request exceeds its approved limit",
        ));
    }
    Ok(Bytes::from(encoded))
}

fn validate_llm_request<'a>(
    request: &'a LlmRequest,
    stream: bool,
    invocation: &ModelGatewayInvocation,
) -> Result<&'a str, AdkError> {
    let config = request.config.as_ref().ok_or_else(invalid_llm_request)?;
    if !stream
        || request.model != invocation.model_name
        || !request.tools.is_empty()
        || request.previous_response_id.is_some()
        || request.contents.len() != 1
        || !generation_config_matches(config, invocation)
    {
        return Err(invalid_llm_request());
    }
    let content = &request.contents[0];
    if content.role != "user" || content.parts.len() != 1 {
        return Err(invalid_llm_request());
    }
    match &content.parts[0] {
        Part::Text { text } if !text.is_empty() && !text.contains('\0') => Ok(text),
        _ => Err(invalid_llm_request()),
    }
}

fn instruction_role(model_name: &str) -> &'static str {
    let bytes = model_name.as_bytes();
    if bytes.len() >= 2 && bytes[0] == b'o' && bytes[1].is_ascii_digit() {
        "developer"
    } else {
        "system"
    }
}

fn generation_config_matches(
    config: &GenerateContentConfig,
    invocation: &ModelGatewayInvocation,
) -> bool {
    config.temperature == invocation.temperature
        && config.max_output_tokens == i32::try_from(invocation.max_tokens).ok()
        && config.top_p.is_none()
        && config.top_k.is_none()
        && config.frequency_penalty.is_none()
        && config.presence_penalty.is_none()
        && config.seed.is_none()
        && config.top_logprobs.is_none()
        && config.stop_sequences.is_empty()
        && config.response_schema.is_none()
        && config.cached_content.is_none()
        && config.extensions.is_empty()
}

fn invalid_llm_request() -> AdkError {
    model_error(
        ErrorCategory::InvalidInput,
        "model_gateway.invalid_request",
        "the ADK model request is outside the admitted ordinary profile",
    )
}

fn build_http_request(
    body: Bytes,
    project_id: u64,
    token: &str,
) -> Result<Request<Body>, AdkError> {
    let body_length = body.len();
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(MODEL_ROUTE)
        .version(Version::HTTP_2)
        .body(Body::new(Full::new(body)))
        .map_err(|_| invalid_llm_request())?;
    let headers = request.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&body_length.to_string()).map_err(|_| invalid_llm_request())?,
    );
    headers.insert(
        OPENAI_ORGANIZATION,
        HeaderValue::from_str(&project_id.to_string()).map_err(|_| invalid_llm_request())?,
    );
    let mut bearer = Zeroizing::new(String::with_capacity(7 + token.len()));
    bearer.push_str("Bearer ");
    bearer.push_str(token);
    let mut authorization =
        HeaderValue::from_str(bearer.as_str()).map_err(|_| invalid_llm_request())?;
    authorization.set_sensitive(true);
    headers.insert(AUTHORIZATION, authorization);
    Ok(request)
}

fn validate_response_head(response: &Response<Body>) -> Result<(), AdkError> {
    if response.version() != Version::HTTP_2 {
        return Err(model_error(
            ErrorCategory::Unavailable,
            "model_gateway.http_version",
            "the model gateway did not negotiate HTTP/2",
        ));
    }
    match response.status() {
        StatusCode::UNAUTHORIZED => {
            return Err(model_error(
                ErrorCategory::Unauthorized,
                "model_gateway.unauthorized",
                "the model gateway rejected the execution credential",
            ));
        }
        StatusCode::FORBIDDEN => {
            return Err(model_error(
                ErrorCategory::Forbidden,
                "model_gateway.forbidden",
                "the model gateway rejected the execution project",
            ));
        }
        StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => {
            return Err(model_error(
                ErrorCategory::Timeout,
                "model_gateway.upstream_timeout",
                "the model gateway timed out",
            ));
        }
        StatusCode::TOO_MANY_REQUESTS => {
            return Err(model_error(
                ErrorCategory::RateLimited,
                "model_gateway.rate_limited",
                "the model gateway rate limit was reached",
            ));
        }
        StatusCode::PAYMENT_REQUIRED => {
            return Err(model_error(
                ErrorCategory::InvalidInput,
                "model_gateway.budget_exhausted",
                "the model budget is exhausted",
            ));
        }
        StatusCode::CONFLICT => {
            return Err(model_error(
                ErrorCategory::Unavailable,
                "model_gateway.conflict",
                "the model gateway reported a retryable conflict",
            ));
        }
        status if status.is_redirection() || status.is_server_error() => {
            return Err(model_error(
                ErrorCategory::Unavailable,
                "model_gateway.unavailable",
                "the model gateway is unavailable",
            ));
        }
        status if !status.is_success() => {
            return Err(model_error(
                ErrorCategory::InvalidInput,
                "model_gateway.rejected",
                "the model gateway rejected the admitted request",
            ));
        }
        _ => {}
    }
    let media_type = single_header(response.headers(), &CONTENT_TYPE)?;
    if !media_type
        .split(';')
        .next()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("text/event-stream"))
    {
        return Err(model_error(
            ErrorCategory::Unavailable,
            "model_gateway.response_type",
            "the model gateway response type is malformed",
        ));
    }
    Ok(())
}

fn single_header<'a>(headers: &'a HeaderMap, name: &HeaderName) -> Result<&'a str, AdkError> {
    let mut values = headers.get_all(name).iter();
    let value = values.next().ok_or_else(|| {
        model_error(
            ErrorCategory::Unavailable,
            "model_gateway.response_header_missing",
            "the model gateway response metadata is missing",
        )
    })?;
    if values.next().is_some() {
        return Err(model_error(
            ErrorCategory::Unavailable,
            "model_gateway.response_header_ambiguous",
            "the model gateway response metadata is ambiguous",
        ));
    }
    value.to_str().map_err(|_| {
        model_error(
            ErrorCategory::Unavailable,
            "model_gateway.response_header_invalid",
            "the model gateway response metadata is malformed",
        )
    })
}

fn model_response_stream(
    mut response: Response<Body>,
    idle_timeout: Duration,
    max_event_bytes: usize,
    max_stream_bytes: usize,
    max_events: usize,
    completion: Arc<Mutex<CompletionState>>,
) -> LlmResponseStream {
    Box::pin(try_stream! {
        let mut parser = SseParser::new(max_event_bytes, max_stream_bytes, max_events);
        let mut accumulated = String::new();
        let mut semantic_bytes = 0_usize;
        let mut terminal = None;
        let mut saw_done = false;
        loop {
            let chunk = next_response_chunk(&mut response, idle_timeout).await?;
            let input_finished = chunk.is_none();
            if let Some(chunk) = chunk {
                parser.push(&chunk)?;
            } else {
                parser.finish_input();
            }
            while let Some(event) = parser.next_event()? {
                match parse_sse_event(&event)? {
                    ParsedSseEvent::Response(model_response) => {
                        if saw_done || terminal.is_some() {
                            Err(model_error(
                                ErrorCategory::Unavailable,
                                "model_gateway.event_after_completion",
                                "the model gateway emitted an event after completion",
                            ))?;
                        }
                        record_response(
                            &model_response,
                            &mut accumulated,
                            &mut semantic_bytes,
                        )?;
                        if model_response.turn_complete {
                            terminal = Some(model_response);
                        } else {
                            yield *model_response;
                        }
                    }
                    ParsedSseEvent::Done => {
                        if saw_done || terminal.is_none() {
                            Err(model_error(
                                ErrorCategory::Unavailable,
                                "model_gateway.done_before_completion",
                                "the model gateway ended before a completed response",
                            ))?;
                        }
                        saw_done = true;
                    }
                    ParsedSseEvent::Usage if !saw_done => {}
                    ParsedSseEvent::Usage => Err(model_error(
                        ErrorCategory::Unavailable,
                        "model_gateway.event_after_completion",
                        "the model gateway emitted an event after completion",
                    ))?,
                }
            }
            if input_finished {
                break;
            }
        }
        let terminal = terminal.filter(|_| saw_done).ok_or_else(|| {
            model_error(
                ErrorCategory::Unavailable,
                "model_gateway.incomplete_stream",
                "the model gateway stream ended before completion",
            )
        })?;
        record_completion(&mut accumulated, &completion)?;
        yield *terminal;
    })
}

async fn next_response_chunk(
    response: &mut Response<Body>,
    idle_timeout: Duration,
) -> Result<Option<Bytes>, AdkError> {
    let Some(frame) = timeout(idle_timeout, response.body_mut().frame())
        .await
        .map_err(|_| {
            model_error(
                ErrorCategory::Timeout,
                "model_gateway.stream_idle_timeout",
                "the model gateway stream became idle",
            )
        })?
    else {
        return Ok(None);
    };
    let frame = frame.map_err(|_| {
        model_error(
            ErrorCategory::Unavailable,
            "model_gateway.stream_transport",
            "the model gateway stream was interrupted",
        )
    })?;
    frame.into_data().map(Some).map_err(|_| {
        model_error(
            ErrorCategory::Unavailable,
            "model_gateway.stream_trailers",
            "the model gateway stream contains unexpected trailers",
        )
    })
}

fn record_response(
    response: &LlmResponse,
    accumulated: &mut String,
    semantic_bytes: &mut usize,
) -> Result<(), AdkError> {
    if let Some(content) = &response.content {
        for part in &content.parts {
            let part_bytes = match part {
                Part::Text { text } => text.len(),
                Part::Thinking { thinking, .. } => thinking.len(),
                _ => 0,
            };
            *semantic_bytes = semantic_bytes
                .checked_add(part_bytes)
                .ok_or_else(model_output_too_large)?;
            if *semantic_bytes > MAX_COMPLETION_BYTES {
                return Err(model_output_too_large());
            }
            if let Part::Text { text } = part {
                accumulated.push_str(text);
            }
        }
    }
    Ok(())
}

fn record_completion(
    accumulated: &mut String,
    completion: &Arc<Mutex<CompletionState>>,
) -> Result<(), AdkError> {
    let mut state = completion.lock().map_err(|_| {
        model_error(
            ErrorCategory::Internal,
            "model_gateway.completion_state",
            "the model completion state is unavailable",
        )
    })?;
    if state.value.is_some() || state.consumed {
        return Err(model_error(
            ErrorCategory::Internal,
            "model_gateway.completion_reused",
            "the model completion was produced more than once",
        ));
    }
    state.value = Some(std::mem::take(accumulated));
    Ok(())
}

fn model_output_too_large() -> AdkError {
    model_error(
        ErrorCategory::InvalidInput,
        "model_gateway.output_too_large",
        "the model output exceeds its approved limit",
    )
}

struct SseParser {
    bytes: Vec<u8>,
    cursor: usize,
    data: Vec<u8>,
    total_bytes: usize,
    max_event_bytes: usize,
    max_stream_bytes: usize,
    max_events: usize,
    emitted_events: usize,
    input_finished: bool,
}

impl SseParser {
    fn new(max_event_bytes: usize, max_stream_bytes: usize, max_events: usize) -> Self {
        Self {
            bytes: Vec::new(),
            cursor: 0,
            data: Vec::new(),
            total_bytes: 0,
            max_event_bytes,
            max_stream_bytes,
            max_events,
            emitted_events: 0,
            input_finished: false,
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Result<(), AdkError> {
        if self.input_finished {
            return Err(invalid_sse());
        }
        self.total_bytes = self
            .total_bytes
            .checked_add(chunk.len())
            .ok_or_else(stream_too_large)?;
        if self.total_bytes > self.max_stream_bytes {
            return Err(stream_too_large());
        }
        let buffered = self.bytes.len().saturating_sub(self.cursor);
        if buffered.saturating_add(chunk.len()) > self.max_stream_bytes {
            return Err(stream_too_large());
        }
        self.compact();
        self.bytes.extend_from_slice(chunk);
        Ok(())
    }

    fn finish_input(&mut self) {
        if self.input_finished {
            return;
        }
        self.input_finished = true;
        if self.bytes.len() > self.cursor && !self.bytes[self.cursor..].ends_with(b"\n") {
            self.bytes.push(b'\n');
        }
        self.bytes.push(b'\n');
    }

    fn next_event(&mut self) -> Result<Option<Vec<u8>>, AdkError> {
        loop {
            let Some(relative_end) = self.bytes[self.cursor..]
                .iter()
                .position(|byte| *byte == b'\n')
            else {
                return Ok(None);
            };
            let end = self.cursor + relative_end;
            let mut line = &self.bytes[self.cursor..end];
            if line.last() == Some(&b'\r') {
                line = &line[..line.len() - 1];
            }
            if line.len() > self.max_event_bytes {
                return Err(event_too_large());
            }
            self.cursor = end + 1;
            if line.is_empty() {
                if self.data.is_empty() {
                    self.compact();
                    continue;
                }
                if self.data.last() == Some(&b'\n') {
                    self.data.pop();
                }
                let event = std::mem::take(&mut self.data);
                self.emitted_events = self
                    .emitted_events
                    .checked_add(1)
                    .ok_or_else(too_many_events)?;
                if self.emitted_events > self.max_events {
                    return Err(too_many_events());
                }
                self.compact();
                return Ok(Some(event));
            }
            if line.starts_with(b":") {
                continue;
            }
            let Some(value) = line.strip_prefix(b"data:") else {
                return Err(invalid_sse());
            };
            let value = value.strip_prefix(b" ").unwrap_or(value);
            let next_len = self
                .data
                .len()
                .checked_add(value.len() + 1)
                .ok_or_else(event_too_large)?;
            if next_len > self.max_event_bytes {
                return Err(event_too_large());
            }
            self.data.extend_from_slice(value);
            self.data.push(b'\n');
        }
    }

    fn compact(&mut self) {
        if self.cursor == self.bytes.len() {
            self.bytes.clear();
            self.cursor = 0;
        } else if self.cursor >= 64 * 1_024 {
            self.bytes.drain(..self.cursor);
            self.cursor = 0;
        }
    }
}

enum ParsedSseEvent {
    Response(Box<LlmResponse>),
    Usage,
    Done,
}

fn parse_sse_event(bytes: &[u8]) -> Result<ParsedSseEvent, AdkError> {
    if bytes == b"[DONE]" {
        return Ok(ParsedSseEvent::Done);
    }
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| invalid_sse())?;
    let object = value.as_object().ok_or_else(invalid_sse)?;
    if object.get("error").is_some_and(|error| !error.is_null()) {
        return Err(model_error(
            ErrorCategory::Unavailable,
            "model_gateway.provider_error",
            "the model provider reported an error",
        ));
    }
    let choices = object
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(invalid_sse)?;
    if choices.is_empty() {
        return if object.get("usage").is_some_and(|usage| !usage.is_null()) {
            Ok(ParsedSseEvent::Usage)
        } else {
            Err(invalid_sse())
        };
    }
    if choices.len() != 1 {
        return Err(invalid_sse());
    }
    let choice = choices[0].as_object().ok_or_else(invalid_sse)?;
    let delta = choice
        .get("delta")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(invalid_sse)?;
    if delta.get("tool_calls").is_some_and(|value| {
        !value.is_null() && value.as_array().is_none_or(|calls| !calls.is_empty())
    }) || delta
        .get("function_call")
        .is_some_and(|value| !value.is_null())
    {
        return Err(model_error(
            ErrorCategory::Unsupported,
            "model_gateway.tool_call",
            "the model returned a tool call outside the admitted profile",
        ));
    }
    let content = optional_string(delta.get("content"))?;
    let reasoning_content = optional_string(delta.get("reasoning_content"))?;
    let reasoning = optional_string(delta.get("reasoning"))?;
    if reasoning_content.is_some() && reasoning.is_some() {
        return Err(invalid_sse());
    }
    let reasoning = reasoning_content.or(reasoning);
    let finish_reason = optional_string(choice.get("finish_reason"))?;
    if finish_reason.is_none() && content.is_none() && reasoning.is_none() {
        return Ok(ParsedSseEvent::Usage);
    }
    let mut parts = Vec::with_capacity(2);
    if let Some(reasoning) = reasoning.filter(|value| !value.is_empty()) {
        parts.push(Part::Thinking {
            thinking: reasoning.to_owned(),
            signature: None,
        });
    }
    if let Some(content) = content.filter(|value| !value.is_empty()) {
        parts.push(Part::Text {
            text: content.to_owned(),
        });
    }
    let finish_reason = finish_reason.map(parse_finish_reason).transpose()?;
    let turn_complete = finish_reason.is_some();
    Ok(ParsedSseEvent::Response(Box::new(LlmResponse {
        content: (!parts.is_empty()).then_some(Content {
            role: "model".to_owned(),
            parts,
        }),
        finish_reason,
        partial: !turn_complete,
        turn_complete,
        ..LlmResponse::default()
    })))
}

fn optional_string(value: Option<&serde_json::Value>) -> Result<Option<&str>, AdkError> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(invalid_sse()),
    }
}

fn parse_finish_reason(value: &str) -> Result<FinishReason, AdkError> {
    match value {
        "stop" => Ok(FinishReason::Stop),
        "length" => Ok(FinishReason::MaxTokens),
        "content_filter" => Ok(FinishReason::Safety),
        "tool_calls" | "function_call" => Err(model_error(
            ErrorCategory::Unsupported,
            "model_gateway.tool_finish",
            "the model requested a tool outside the admitted profile",
        )),
        _ => Ok(FinishReason::Other),
    }
}

fn invalid_sse() -> AdkError {
    model_error(
        ErrorCategory::Unavailable,
        "model_gateway.invalid_sse",
        "the model gateway stream is malformed",
    )
}

fn event_too_large() -> AdkError {
    model_error(
        ErrorCategory::InvalidInput,
        "model_gateway.event_too_large",
        "the model gateway event exceeds its approved limit",
    )
}

fn stream_too_large() -> AdkError {
    model_error(
        ErrorCategory::InvalidInput,
        "model_gateway.stream_too_large",
        "the model gateway stream exceeds its approved limit",
    )
}

fn too_many_events() -> AdkError {
    model_error(
        ErrorCategory::Unavailable,
        "model_gateway.too_many_events",
        "the model gateway emitted too many events",
    )
}

fn model_error(category: ErrorCategory, code: &'static str, message: &'static str) -> AdkError {
    AdkError::new(ErrorComponent::Model, category, code, message).with_provider("elitea")
}

fn canonical_https_origin(value: &str) -> Result<String, ModelGatewayError> {
    if value.is_empty() || value.len() > MAX_ORIGIN_BYTES {
        return Err(ModelGatewayError::InvalidConfiguration);
    }
    let uri = value
        .parse::<http::Uri>()
        .map_err(|_| ModelGatewayError::InvalidConfiguration)?;
    if uri.scheme_str() != Some("https")
        || uri.authority().is_none()
        || uri.path() != "/"
        || uri.query().is_some()
        || uri.authority().is_some_and(|authority| {
            authority.as_str().contains('@') || !authority.as_str().is_ascii()
        })
    {
        return Err(ModelGatewayError::InvalidConfiguration);
    }
    let authority = uri
        .authority()
        .ok_or(ModelGatewayError::InvalidConfiguration)?;
    let host = authority.host();
    if host.is_empty() {
        return Err(ModelGatewayError::InvalidConfiguration);
    }
    let host = host.to_ascii_lowercase();
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host
    };
    match authority.port_u16() {
        Some(443) | None => Ok(format!("https://{host}")),
        Some(port) => Ok(format!("https://{host}:{port}")),
    }
}

fn valid_timeout(value: Duration) -> bool {
    !value.is_zero() && value <= MAX_TIMEOUT && value.subsec_nanos().is_multiple_of(1_000_000)
}

fn bounded_header_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value.is_ascii()
        && !value.bytes().any(|byte| byte.is_ascii_control())
}

#[cfg(test)]
pub(crate) struct CapturedModelRequest {
    pub(crate) method: Method,
    pub(crate) uri: http::Uri,
    pub(crate) version: Version,
    pub(crate) headers: HeaderMap,
    pub(crate) body: Bytes,
}

#[cfg(test)]
pub(crate) type CapturedModelRequests = Arc<Mutex<Vec<CapturedModelRequest>>>;

#[cfg(test)]
pub(crate) enum TestModelGatewayOutcome {
    Response(Response<Body>),
    Unavailable,
    Pending,
}

#[cfg(test)]
struct TestModelGatewayTransport {
    outcomes: Mutex<std::collections::VecDeque<TestModelGatewayOutcome>>,
    captured: Arc<Mutex<Vec<CapturedModelRequest>>>,
}

#[cfg(test)]
#[async_trait]
impl ModelGatewayTransport for TestModelGatewayTransport {
    async fn post(
        &self,
        request: Request<Body>,
    ) -> Result<Response<Body>, ModelGatewayTransportError> {
        let (parts, body) = request.into_parts();
        let body = body
            .collect()
            .await
            .map_err(|_| ModelGatewayTransportError::Unavailable)?
            .to_bytes();
        self.captured
            .lock()
            .map_err(|_| ModelGatewayTransportError::Unavailable)?
            .push(CapturedModelRequest {
                method: parts.method,
                uri: parts.uri,
                version: parts.version,
                headers: parts.headers,
                body,
            });
        let outcome = self
            .outcomes
            .lock()
            .map_err(|_| ModelGatewayTransportError::Unavailable)?
            .pop_front()
            .ok_or(ModelGatewayTransportError::Unavailable)?;
        match outcome {
            TestModelGatewayOutcome::Response(response) => Ok(response),
            TestModelGatewayOutcome::Unavailable => Err(ModelGatewayTransportError::Unavailable),
            TestModelGatewayOutcome::Pending => std::future::pending().await,
        }
    }
}

#[cfg(test)]
pub(crate) fn test_model_gateway_config() -> ModelGatewayConfig {
    ModelGatewayConfig {
        origin: "https://platform.internal".to_owned(),
        connect_timeout: Duration::from_secs(1),
        response_header_timeout: Duration::from_secs(1),
        stream_idle_timeout: Duration::from_secs(1),
        max_request_bytes: MAX_REQUEST_BYTES,
        max_sse_event_bytes: MAX_SSE_EVENT_BYTES,
        max_stream_bytes: MAX_STREAM_BYTES,
        max_sse_events: MAX_SSE_EVENTS,
    }
}

#[cfg(test)]
pub(crate) fn test_model_gateway_client(
    outcomes: Vec<TestModelGatewayOutcome>,
    config: ModelGatewayConfig,
) -> Result<(ModelGatewayClient, CapturedModelRequests), ModelGatewayError> {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let client = ModelGatewayClient::with_rpc(
        TestModelGatewayTransport {
            outcomes: Mutex::new(outcomes.into()),
            captured: Arc::clone(&captured),
        },
        config,
    )?;
    Ok((client, captured))
}

#[cfg(test)]
pub(super) fn test_model_gateway_invocation() -> ModelGatewayInvocation {
    ModelGatewayInvocation {
        model_name: "fixture-model".to_owned(),
        system_instruction: "review carefully\nbe concise".to_owned(),
        max_tokens: 4_000,
        reasoning_effort: Some(ModelReasoningEffort::Medium),
        temperature: None,
    }
}

#[cfg(test)]
pub(super) fn test_model_gateway_request(user: &str) -> LlmRequest {
    LlmRequest {
        model: "fixture-model".to_owned(),
        contents: vec![Content::new("user").with_text(user)],
        config: Some(GenerateContentConfig {
            max_output_tokens: Some(4_000),
            ..GenerateContentConfig::default()
        }),
        tools: std::collections::HashMap::new(),
        previous_response_id: None,
    }
}

#[cfg(test)]
pub(crate) fn test_model_gateway_response(body: Body) -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .version(Version::HTTP_2)
        .header(CONTENT_TYPE, "text/event-stream; charset=utf-8")
        .body(body)
        .expect("model gateway test response")
}
