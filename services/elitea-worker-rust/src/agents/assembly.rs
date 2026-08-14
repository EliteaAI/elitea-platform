//! Strict production assembly admission before credential redemption.
//!
//! This first profile intentionally admits only ordinary text application and
//! ad-hoc turns without tools, skills, MCP, HITL, attachments or checkpoint
//! continuation. Those current Python/SDK capabilities remain mandatory later
//! slices; rejecting them is safer than silently assembling a weaker agent.

#![allow(dead_code)] // Production provider/session assembly remains disabled.

use serde_json::{Map, Value};

use super::request::{AgentExecutionKind, AgentExecutionRequest, UserInput};
use super::runtime::{NativeAgentAssemblyError, NativeAgentAssemblyErrorCode};

const MAX_MODEL_NAME_BYTES: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReasoningEffort {
    Low,
    Medium,
    High,
    None,
}

/// Frozen model and execution controls for the first no-tool profile.
#[derive(Debug, PartialEq)]
pub(crate) struct OrdinaryNoToolProfile {
    kind: AgentExecutionKind,
    model_name: String,
    model_project_id: u32,
    max_tokens: u32,
    reasoning_effort: Option<ReasoningEffort>,
    temperature: Option<f64>,
}

impl OrdinaryNoToolProfile {
    /// Validate every unsupported current feature before PAT redemption.
    pub(crate) fn validate(
        request: &AgentExecutionRequest,
    ) -> Result<Self, NativeAgentAssemblyError> {
        validate_common_profile(request)?;
        let model = match request.kind {
            AgentExecutionKind::Application => application_model(request)?,
            AgentExecutionKind::Adhoc => adhoc_model(request)?,
        };
        Ok(Self {
            kind: request.kind,
            model_name: model.model_name,
            model_project_id: model.model_project_id,
            max_tokens: model.max_tokens,
            reasoning_effort: model.reasoning_effort,
            temperature: model.temperature,
        })
    }

    #[must_use]
    pub(crate) const fn kind(&self) -> AgentExecutionKind {
        self.kind
    }

    #[must_use]
    pub(crate) fn model_name(&self) -> &str {
        &self.model_name
    }

    #[must_use]
    pub(crate) const fn model_project_id(&self) -> u32 {
        self.model_project_id
    }

    #[must_use]
    pub(crate) const fn max_tokens(&self) -> u32 {
        self.max_tokens
    }

    #[must_use]
    pub(crate) const fn reasoning_effort(&self) -> Option<ReasoningEffort> {
        self.reasoning_effort
    }

    #[must_use]
    pub(crate) const fn temperature(&self) -> Option<f64> {
        self.temperature
    }
}

fn validate_common_profile(
    request: &AgentExecutionRequest,
) -> Result<(), NativeAgentAssemblyError> {
    let payload = &request.payload;
    if !matches!(payload.user_input, UserInput::Text(_))
        || !payload.chat_history.is_empty()
        || !payload.tools.is_empty()
        || !payload.internal_tools.is_empty()
        || !payload.mcp_tokens.is_empty()
        || !payload.ignored_mcp_servers.is_empty()
        || !payload.user_declined_mcp_servers.is_empty()
        || payload.should_continue
        || payload.hitl_resume
        || payload.hitl_action.is_some()
        || payload.hitl_value.is_some()
        || !payload.hitl_decisions.is_empty()
        || payload.checkpoint_id.is_some()
        || payload.is_regenerate
        || payload.supports_vision
        || payload.return_chat_history
        || !payload.invoked_skills.is_empty()
        || !payload.applied_skills.is_empty()
        || payload.auto_approve_sensitive_actions
        || !payload.attached_skills.is_empty()
        || !payload.input_attachments.is_empty()
        || payload.parallel_reconcile.is_some()
        || !payload.parallel_terminal_errors.is_empty()
        || payload.exception_handling_enabled == Some(true)
        || payload.debug_mode.is_some()
        || payload.next_input_suggestion.enabled
        || payload.debug
        || !payload.meta.is_empty()
        || !payload.context_settings.is_empty()
        || payload.steps_limit.is_some()
    {
        return Err(unsupported_profile());
    }
    if !payload
        .thread_id
        .as_deref()
        .is_some_and(bounded_runtime_identity)
        || !payload
            .conversation_id
            .as_deref()
            .is_some_and(bounded_runtime_identity)
    {
        return Err(invalid_profile());
    }
    Ok(())
}

fn application_model(
    request: &AgentExecutionRequest,
) -> Result<ValidatedModel, NativeAgentAssemblyError> {
    let version = request
        .payload
        .application
        .get("version_details")
        .and_then(Value::as_object)
        .ok_or_else(invalid_profile)?;
    let variables = request
        .payload
        .application
        .get("variables")
        .and_then(Value::as_array)
        .ok_or_else(invalid_profile)?;
    if !variables.is_empty() {
        return Err(unsupported_profile());
    }
    match version.get("agent_type") {
        None => {}
        Some(Value::String(value)) if value == "agent" => {}
        Some(Value::String(_)) => return Err(unsupported_profile()),
        Some(_) => return Err(invalid_profile()),
    }
    validate_empty_feature_array(version.get("tools"), true)?;
    validate_empty_feature_array(version.get("internal_tools"), false)?;
    validate_application_meta(version.get("meta"))?;
    let instructions = version
        .get("instructions")
        .and_then(Value::as_str)
        .filter(|value| bounded_text(value, 64 * 1_024))
        .ok_or_else(invalid_profile)?;
    if ["{{", "{%", "{#"]
        .iter()
        .any(|marker| instructions.contains(marker))
    {
        return Err(unsupported_profile());
    }
    let settings = version
        .get("llm_settings")
        .and_then(Value::as_object)
        .ok_or_else(invalid_profile)?;
    let kwargs = request
        .payload
        .llm
        .get("kwargs")
        .and_then(Value::as_object)
        .ok_or_else(invalid_profile)?;
    if kwargs.len() != 1 || kwargs.get("openai_compatible") != Some(&Value::Bool(true)) {
        return Err(unsupported_profile());
    }
    validate_model(settings, ModelFieldNames::APPLICATION, false)
}

fn validate_empty_feature_array(
    value: Option<&Value>,
    required: bool,
) -> Result<(), NativeAgentAssemblyError> {
    let Some(value) = value else {
        return if required {
            Err(invalid_profile())
        } else {
            Ok(())
        };
    };
    let values = value.as_array().ok_or_else(invalid_profile)?;
    if values.is_empty() {
        Ok(())
    } else {
        Err(unsupported_profile())
    }
}

fn validate_application_meta(value: Option<&Value>) -> Result<(), NativeAgentAssemblyError> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(());
    };
    let meta = value.as_object().ok_or_else(invalid_profile)?;
    if meta.contains_key("step_limit") {
        return Err(unsupported_profile());
    }
    validate_empty_feature_array(meta.get("internal_tools"), false)?;
    match meta.get("lazy_tools_mode") {
        None | Some(Value::Bool(false)) => {}
        Some(Value::Bool(true)) => return Err(unsupported_profile()),
        Some(_) => return Err(invalid_profile()),
    }
    match meta.get("variables") {
        None => {}
        Some(Value::Object(variables)) if variables.is_empty() => {}
        Some(Value::Object(_)) => return Err(unsupported_profile()),
        Some(_) => return Err(invalid_profile()),
    }
    Ok(())
}

fn adhoc_model(
    request: &AgentExecutionRequest,
) -> Result<ValidatedModel, NativeAgentAssemblyError> {
    let instructions = request
        .payload
        .application
        .get("instructions")
        .and_then(Value::as_str)
        .filter(|value| bounded_text(value, 64 * 1_024))
        .ok_or_else(invalid_profile)?;
    if ["{{", "{%", "{#"]
        .iter()
        .any(|marker| instructions.contains(marker))
    {
        return Err(unsupported_profile());
    }
    let kwargs = request
        .payload
        .llm
        .get("kwargs")
        .and_then(Value::as_object)
        .ok_or_else(invalid_profile)?;
    validate_model(kwargs, ModelFieldNames::ADHOC, true)
}

#[derive(Clone, Copy)]
struct ModelFieldNames {
    model: &'static str,
    allowed: &'static [&'static str],
}

impl ModelFieldNames {
    const ADHOC: Self = Self {
        model: "model",
        allowed: &[
            "model",
            "model_project_id",
            "max_tokens",
            "reasoning_effort",
            "temperature",
            "stream",
            "openai_compatible",
        ],
    };
    const APPLICATION: Self = Self {
        model: "model_name",
        allowed: &[
            "model_name",
            "model_project_id",
            "max_tokens",
            "reasoning_effort",
            "temperature",
            "openai_compatible",
        ],
    };
}

struct ValidatedModel {
    model_name: String,
    model_project_id: u32,
    max_tokens: u32,
    reasoning_effort: Option<ReasoningEffort>,
    temperature: Option<f64>,
}

fn validate_model(
    settings: &Map<String, Value>,
    names: ModelFieldNames,
    require_compatible: bool,
) -> Result<ValidatedModel, NativeAgentAssemblyError> {
    if settings
        .keys()
        .any(|key| !names.allowed.contains(&key.as_str()))
        || settings
            .get("stream")
            .is_some_and(|value| value != &Value::Bool(true))
    {
        return Err(unsupported_profile());
    }
    match settings.get("openai_compatible") {
        Some(Value::Bool(true)) => {}
        Some(Value::Bool(false)) | None if !require_compatible => {}
        Some(Value::Bool(false)) | None => return Err(unsupported_profile()),
        Some(_) => return Err(invalid_profile()),
    }
    let model_name = settings
        .get(names.model)
        .and_then(Value::as_str)
        .filter(|value| bounded_text(value, MAX_MODEL_NAME_BYTES))
        .ok_or_else(invalid_profile)?
        .to_owned();
    let model_project_id = positive_u32(settings.get("model_project_id"))?;
    let max_tokens = normalized_max_tokens(settings.get("max_tokens"))?;
    let reasoning_effort = settings
        .get("reasoning_effort")
        .filter(|value| !value.is_null())
        .map(parse_reasoning_effort)
        .transpose()?;
    let temperature = settings
        .get("temperature")
        .filter(|value| !value.is_null())
        .map(parse_temperature)
        .transpose()?;
    if temperature.is_some()
        && reasoning_effort.is_some_and(|effort| effort != ReasoningEffort::None)
    {
        return Err(invalid_profile());
    }
    Ok(ValidatedModel {
        model_name,
        model_project_id,
        max_tokens,
        reasoning_effort,
        temperature,
    })
}

fn positive_u32(value: Option<&Value>) -> Result<u32, NativeAgentAssemblyError> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0 && i32::try_from(*value).is_ok())
        .ok_or_else(invalid_profile)
}

fn normalized_max_tokens(value: Option<&Value>) -> Result<u32, NativeAgentAssemblyError> {
    match value {
        None | Some(Value::Null) => Ok(4_000),
        Some(value) if value.as_i64() == Some(-1) => Ok(4_000),
        Some(value) => positive_u32(Some(value)),
    }
}

fn parse_reasoning_effort(value: &Value) -> Result<ReasoningEffort, NativeAgentAssemblyError> {
    match value.as_str() {
        Some("low") => Ok(ReasoningEffort::Low),
        Some("medium") => Ok(ReasoningEffort::Medium),
        Some("high") => Ok(ReasoningEffort::High),
        Some("none") => Ok(ReasoningEffort::None),
        _ => Err(invalid_profile()),
    }
}

fn parse_temperature(value: &Value) -> Result<f64, NativeAgentAssemblyError> {
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 1.0)
        .ok_or_else(invalid_profile)
}

fn bounded_runtime_identity(value: &str) -> bool {
    bounded_text(value, 256)
}

fn bounded_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && !value.bytes().any(|byte| matches!(byte, b'\r' | b'\n' | 0))
}

fn unsupported_profile() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::UnsupportedCapability,
        "the authorized agent profile requires a capability that is not admitted yet",
    )
}

fn invalid_profile() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::InvalidInput,
        "the authorized agent profile is malformed",
    )
}
