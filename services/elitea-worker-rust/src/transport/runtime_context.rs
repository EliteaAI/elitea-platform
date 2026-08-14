//! Post-authorization, claim-bound Elitea runtime-context redemption.
//!
//! The Rust worker permits execution-actor PAT redemption only after it has
//! crossed `AuthorizeInvocation`. Main currently validates the live claim,
//! fence, desired state and project but does not independently inspect the
//! invocation-state transition for this endpoint. This transport owns one
//! bounded mTLS HTTP/2 attempt and accepts only the opaque authority minted by
//! the worker's durable transition. Response bodies, fence tokens and PATs
//! never enter an error message or tracing field.

#![allow(dead_code)] // Production provider assembly remains capability-disabled.

use std::fmt;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use http::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE};
use http::{HeaderMap, HeaderName, HeaderValue, Method, Request, Response, StatusCode, Version};
use http_body_util::BodyExt as _;
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
use serde::{Deserialize, Deserializer};
use tokio::time::timeout;
use tonic::body::Body;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Endpoint, Identity};
use tower::ServiceExt as _;
use zeroize::Zeroizing;

use crate::protocol::control::{
    ClaimBoundRuntimeContextAuthority, RuntimeContextRedemptionBinding,
};

const TOKEN_CONTEXT_SCHEMA: &str = "elitea.runtime.elitea-client-token.v1";
const MAX_SAFE_TEXT_BYTES: usize = 256;
const MAX_ORIGIN_BYTES: usize = 2_048;
const MAX_TOKEN_CONTEXT_BYTES: usize = 32 * 1_024;
const MAX_TOKEN_BYTES: usize = 16 * 1_024;
const MAX_RUNTIME_CONTEXT_DEADLINE: Duration = Duration::from_mins(5);
const CLAIM_HEADER: HeaderName = HeaderName::from_static("x-elitea-claim-id");
const FENCE_HEADER: HeaderName = HeaderName::from_static("x-elitea-fence");
const PRAGMA_HEADER: HeaderName = HeaderName::from_static("pragma");
const PATH_SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'!')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'(')
    .add(b')')
    .add(b'*')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

/// Immutable policy for the dedicated runtime-context channel.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeContextConfig {
    pub(crate) origin: String,
    pub(crate) deadline: Duration,
    pub(crate) max_response_bytes: usize,
}

impl RuntimeContextConfig {
    fn validate(&self) -> Result<String, RuntimeContextError> {
        let origin = canonical_https_origin(&self.origin)?;
        if self.deadline.is_zero()
            || self.deadline > MAX_RUNTIME_CONTEXT_DEADLINE
            || self.max_response_bytes == 0
            || self.max_response_bytes > MAX_TOKEN_CONTEXT_BYTES
        {
            return Err(RuntimeContextError::InvalidConfiguration(
                "the runtime context configuration is malformed",
            ));
        }
        Ok(origin)
    }
}

/// Stable, data-free runtime-context failure.
pub(crate) enum RuntimeContextError {
    InvalidConfiguration(&'static str),
    InvalidResponse(&'static str),
    ResourceExhausted(&'static str),
    AuthorizationFailed(&'static str),
    DependencyUnavailable(&'static str),
    Transport(RuntimeContextTransportError),
    Timeout(&'static str),
}

impl RuntimeContextError {
    #[must_use]
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration(_) => "runtime_context.invalid_configuration",
            Self::InvalidResponse(_) => "runtime_context.invalid_response",
            Self::ResourceExhausted(_) => "runtime_context.resource_exhausted",
            Self::AuthorizationFailed(_) => "runtime_context.authorization_failed",
            Self::DependencyUnavailable(_) | Self::Transport(_) => {
                "runtime_context.dependency_unavailable"
            }
            Self::Timeout(_) => "runtime_context.timeout",
        }
    }

    #[must_use]
    pub(crate) const fn retryable(&self) -> bool {
        matches!(
            self,
            Self::DependencyUnavailable(_) | Self::Transport(_) | Self::Timeout(_)
        )
    }
}

impl fmt::Debug for RuntimeContextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RuntimeContextError")
            .field("code", &self.code())
            .finish_non_exhaustive()
    }
}

impl fmt::Display for RuntimeContextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration(message)
            | Self::InvalidResponse(message)
            | Self::ResourceExhausted(message)
            | Self::AuthorizationFailed(message)
            | Self::DependencyUnavailable(message)
            | Self::Timeout(message) => formatter.write_str(message),
            Self::Transport(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for RuntimeContextError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Transport(error) => Some(error),
            _ => None,
        }
    }
}

/// Redacted transport failure below response validation.
pub(crate) enum RuntimeContextTransportError {
    Unavailable,
    Tonic(tonic::transport::Error),
}

impl fmt::Debug for RuntimeContextTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RuntimeContextTransportError(..)")
    }
}

impl fmt::Display for RuntimeContextTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the runtime context service is unavailable")
    }
}

impl std::error::Error for RuntimeContextTransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Unavailable => None,
            Self::Tonic(error) => Some(error),
        }
    }
}

/// One ephemeral SDK/model credential scoped to the accepted resource project.
///
/// The PAT is erased on drop. The value deliberately exposes no formatting,
/// serialization or cloning surface; the future model-gateway adapter will
/// consume it directly when building bounded request headers.
pub(crate) struct ClaimScopedEliteaContext {
    project_id: u64,
    token: Zeroizing<String>,
}

impl ClaimScopedEliteaContext {
    pub(super) fn into_model_gateway_parts(self) -> (u64, Zeroizing<String>) {
        (self.project_id, self.token)
    }

    #[cfg(test)]
    pub(super) const fn project_id(&self) -> u64 {
        self.project_id
    }

    #[cfg(test)]
    pub(super) fn token(&self) -> &str {
        self.token.as_str()
    }

    #[cfg(test)]
    pub(super) fn fixture(project_id: u64, token: &str) -> Self {
        Self {
            project_id,
            token: Zeroizing::new(token.to_owned()),
        }
    }
}

#[async_trait]
pub(crate) trait RuntimeContextRpc: Send + Sync {
    async fn post(
        &self,
        request: Request<Body>,
    ) -> Result<Response<Body>, RuntimeContextTransportError>;
}

#[derive(Clone)]
struct TonicRuntimeContextRpc {
    channel: Channel,
}

#[async_trait]
impl RuntimeContextRpc for TonicRuntimeContextRpc {
    async fn post(
        &self,
        request: Request<Body>,
    ) -> Result<Response<Body>, RuntimeContextTransportError> {
        self.channel
            .clone()
            .oneshot(request)
            .await
            .map_err(RuntimeContextTransportError::Tonic)
    }
}

/// One-attempt origin-bound runtime-context client.
pub(crate) struct RuntimeContextClient {
    rpc: Box<dyn RuntimeContextRpc>,
    config: RuntimeContextConfig,
}

impl RuntimeContextClient {
    /// Connect one dedicated mTLS HTTP/2 channel from the validated origin.
    pub(crate) async fn connect(
        mut config: RuntimeContextConfig,
        private_ca: Certificate,
        client_identity: Identity,
    ) -> Result<Self, RuntimeContextError> {
        let origin = config.validate()?;
        let tls = ClientTlsConfig::new()
            .ca_certificate(private_ca)
            .identity(client_identity);
        let endpoint = Endpoint::from_shared(origin.clone())
            .and_then(|endpoint| endpoint.tls_config(tls))
            .map_err(RuntimeContextTransportError::Tonic)
            .map_err(RuntimeContextError::Transport)?;
        let channel = timeout(config.deadline, endpoint.connect())
            .await
            .map_err(|_| RuntimeContextError::Timeout("the runtime context connection timed out"))?
            .map_err(RuntimeContextTransportError::Tonic)
            .map_err(RuntimeContextError::Transport)?;
        config.origin = origin;
        Ok(Self {
            rpc: Box::new(TonicRuntimeContextRpc { channel }),
            config,
        })
    }

    #[cfg(test)]
    pub(super) fn with_rpc(
        rpc: impl RuntimeContextRpc + 'static,
        mut config: RuntimeContextConfig,
    ) -> Result<Self, RuntimeContextError> {
        config.origin = config.validate()?;
        Ok(Self {
            rpc: Box::new(rpc),
            config,
        })
    }

    /// Redeem one ephemeral actor PAT from the exact authorized claim.
    pub(crate) async fn redeem(
        &self,
        authority: ClaimBoundRuntimeContextAuthority,
    ) -> Result<ClaimScopedEliteaContext, RuntimeContextError> {
        let binding = authority.redemption_binding();
        validate_binding(&binding)?;
        let request = build_request(&binding)?;
        let operation = redeem_response(self.rpc.as_ref(), request, &binding, &self.config);
        timeout(self.config.deadline, operation)
            .await
            .map_err(|_| RuntimeContextError::Timeout("the runtime context request timed out"))?
    }
}

fn validate_binding(
    binding: &RuntimeContextRedemptionBinding<'_>,
) -> Result<(), RuntimeContextError> {
    if !bounded_text(binding.execution_id)
        || binding.generation == 0
        || binding.generation > i64::MAX as u64
        || !bounded_text(binding.claim_id)
        || binding.fence_token.len() != 32
        || binding.fence_token.iter().all(|byte| *byte == 0)
        || !canonical_positive_integer(binding.resource_project_id)
    {
        return Err(RuntimeContextError::AuthorizationFailed(
            "the runtime context authority is malformed",
        ));
    }
    Ok(())
}

fn build_request(
    binding: &RuntimeContextRedemptionBinding<'_>,
) -> Result<Request<Body>, RuntimeContextError> {
    let execution = utf8_percent_encode(binding.execution_id, PATH_SEGMENT);
    let path = format!(
        "/executions/{execution}/generations/{}/runtime-context/elitea-client-token",
        binding.generation
    );
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(path)
        .body(Body::empty())
        .map_err(|_| {
            RuntimeContextError::AuthorizationFailed(
                "the runtime context request authority is malformed",
            )
        })?;
    request.headers_mut().insert(
        CLAIM_HEADER,
        HeaderValue::from_str(binding.claim_id).map_err(|_| {
            RuntimeContextError::AuthorizationFailed(
                "the runtime context request authority is malformed",
            )
        })?,
    );
    request.headers_mut().insert(
        FENCE_HEADER,
        HeaderValue::from_str(&URL_SAFE_NO_PAD.encode(binding.fence_token)).map_err(|_| {
            RuntimeContextError::AuthorizationFailed(
                "the runtime context request authority is malformed",
            )
        })?,
    );
    Ok(request)
}

async fn redeem_response(
    rpc: &dyn RuntimeContextRpc,
    request: Request<Body>,
    binding: &RuntimeContextRedemptionBinding<'_>,
    config: &RuntimeContextConfig,
) -> Result<ClaimScopedEliteaContext, RuntimeContextError> {
    let response = rpc
        .post(request)
        .await
        .map_err(RuntimeContextError::Transport)?;
    let declared_length = validate_response_head(&response, config)?;
    let body = collect_body(response, declared_length, config.max_response_bytes).await?;
    let decoded: RuntimeContextResponse = serde_json::from_slice(&body).map_err(|_| {
        RuntimeContextError::InvalidResponse("the runtime context response is malformed")
    })?;
    if decoded.schema_version != TOKEN_CONTEXT_SCHEMA
        || decoded.project_id == 0
        || decoded.project_id > i64::MAX as u64
        || decoded.project_id.to_string() != binding.resource_project_id
        || decoded.token.0.is_empty()
        || decoded.token.0.len() > MAX_TOKEN_BYTES
        || decoded
            .token
            .0
            .bytes()
            .any(|byte| matches!(byte, b'\r' | b'\n' | 0))
    {
        return Err(RuntimeContextError::AuthorizationFailed(
            "the runtime context does not match the accepted execution",
        ));
    }
    Ok(ClaimScopedEliteaContext {
        project_id: decoded.project_id,
        token: decoded.token.0,
    })
}

fn validate_response_head(
    response: &Response<Body>,
    config: &RuntimeContextConfig,
) -> Result<usize, RuntimeContextError> {
    if response.version() != Version::HTTP_2 {
        return Err(RuntimeContextError::DependencyUnavailable(
            "the runtime context service did not negotiate HTTP/2",
        ));
    }
    match response.status() {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            return Err(RuntimeContextError::AuthorizationFailed(
                "the claim-bound runtime context was rejected",
            ));
        }
        status if status.is_redirection() => {
            return Err(RuntimeContextError::DependencyUnavailable(
                "the runtime context service attempted an unsupported redirect",
            ));
        }
        status if !status.is_success() => {
            return Err(RuntimeContextError::DependencyUnavailable(
                "the runtime context service did not accept the request",
            ));
        }
        _ => {}
    }
    let headers = response.headers();
    let media_type = single_header(headers, &CONTENT_TYPE)?;
    if !media_type
        .split(';')
        .next()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
    {
        return Err(RuntimeContextError::InvalidResponse(
            "the runtime context response type is malformed",
        ));
    }
    validate_cache_policy(headers)?;
    let declared = single_header(headers, &CONTENT_LENGTH)?;
    if declared.is_empty() || !declared.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(RuntimeContextError::InvalidResponse(
            "the runtime context length is malformed",
        ));
    }
    let declared = declared.parse::<usize>().map_err(|_| {
        RuntimeContextError::ResourceExhausted("the runtime context exceeds the approved limit")
    })?;
    if declared == 0 || declared > config.max_response_bytes {
        return Err(RuntimeContextError::ResourceExhausted(
            "the runtime context exceeds the approved limit",
        ));
    }
    Ok(declared)
}

fn validate_cache_policy(headers: &HeaderMap) -> Result<(), RuntimeContextError> {
    let cache = single_header(headers, &CACHE_CONTROL)?;
    let mut no_store = false;
    let mut no_cache = false;
    for directive in cache.split(',').map(str::trim) {
        no_store |= directive.eq_ignore_ascii_case("no-store");
        no_cache |= directive.eq_ignore_ascii_case("no-cache");
    }
    let pragma = single_header(headers, &PRAGMA_HEADER)?;
    if !no_store || !no_cache || !pragma.trim().eq_ignore_ascii_case("no-cache") {
        return Err(RuntimeContextError::InvalidResponse(
            "the runtime context cache policy is malformed",
        ));
    }
    Ok(())
}

async fn collect_body(
    mut response: Response<Body>,
    declared_length: usize,
    max_response_bytes: usize,
) -> Result<Zeroizing<Vec<u8>>, RuntimeContextError> {
    let mut body = Zeroizing::new(Vec::with_capacity(declared_length));
    while let Some(frame) = response.body_mut().frame().await {
        let frame = frame.map_err(|_| {
            RuntimeContextError::DependencyUnavailable(
                "the runtime context response was interrupted",
            )
        })?;
        if frame.is_trailers() {
            return Err(RuntimeContextError::InvalidResponse(
                "the runtime context response contains unexpected trailers",
            ));
        }
        if let Ok(chunk) = frame.into_data() {
            let length = body.len().checked_add(chunk.len()).ok_or(
                RuntimeContextError::ResourceExhausted(
                    "the runtime context exceeds the approved limit",
                ),
            )?;
            if length > declared_length || length > max_response_bytes {
                return Err(RuntimeContextError::InvalidResponse(
                    "the runtime context length is malformed",
                ));
            }
            body.extend_from_slice(&chunk);
        }
    }
    if body.len() != declared_length {
        return Err(RuntimeContextError::InvalidResponse(
            "the runtime context length is malformed",
        ));
    }
    Ok(body)
}

fn single_header<'a>(
    headers: &'a HeaderMap,
    name: &HeaderName,
) -> Result<&'a str, RuntimeContextError> {
    let mut values = headers.get_all(name).iter();
    let value = values.next().ok_or(RuntimeContextError::InvalidResponse(
        "the runtime context response metadata is missing",
    ))?;
    if values.next().is_some() {
        return Err(RuntimeContextError::InvalidResponse(
            "the runtime context response metadata is ambiguous",
        ));
    }
    value.to_str().map_err(|_| {
        RuntimeContextError::InvalidResponse("the runtime context response metadata is malformed")
    })
}

fn canonical_https_origin(value: &str) -> Result<String, RuntimeContextError> {
    if value.is_empty() || value.len() > MAX_ORIGIN_BYTES {
        return Err(RuntimeContextError::InvalidConfiguration(
            "the runtime context origin is malformed",
        ));
    }
    let uri = value.parse::<http::Uri>().map_err(|_| {
        RuntimeContextError::InvalidConfiguration("the runtime context origin is malformed")
    })?;
    if uri.scheme_str() != Some("https")
        || uri.authority().is_none()
        || uri.path() != "/"
        || uri.query().is_some()
        || uri.authority().is_some_and(|authority| {
            authority.as_str().contains('@') || !authority.as_str().is_ascii()
        })
    {
        return Err(RuntimeContextError::InvalidConfiguration(
            "the runtime context origin is malformed",
        ));
    }
    let authority = uri
        .authority()
        .ok_or(RuntimeContextError::InvalidConfiguration(
            "the runtime context origin is malformed",
        ))?;
    let host = authority.host();
    if host.is_empty() {
        return Err(RuntimeContextError::InvalidConfiguration(
            "the runtime context origin is malformed",
        ));
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

fn bounded_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SAFE_TEXT_BYTES
        && !value.bytes().any(|byte| matches!(byte, b'\r' | b'\n' | 0))
}

fn canonical_positive_integer(value: &str) -> bool {
    value.parse::<u64>().is_ok_and(|parsed| {
        parsed > 0 && i64::try_from(parsed).is_ok() && parsed.to_string() == value
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeContextResponse {
    schema_version: String,
    project_id: u64,
    token: SecretToken,
}

struct SecretToken(Zeroizing<String>);

impl<'de> Deserialize<'de> for SecretToken {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer)
            .map(Zeroizing::new)
            .map(Self)
    }
}
