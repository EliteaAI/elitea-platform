//! Strict production `LlmAgent` assembly admission before credential redemption.
//!
//! Application `agent_type=agent` and ad-hoc turns share this direct ADK-Rust
//! `LlmAgent` profile. Pipelines use the graph compiler, while toolsets, MCP,
//! HITL, sessions and browser projection are composed around both runtimes by
//! Elitea-owned boundaries.

#![allow(dead_code)] // Production provider/session assembly remains disabled.

use adk_rust::Content;
use serde_json::{Map, Value};

use super::context_management::ContextManagementPlan;
use super::internal_tools::{InternalToolCatalog, InternalToolError};
use super::request::{AgentExecutionKind, AgentExecutionRequest, UserInput};
use super::runtime::{NativeAgentAssemblyError, NativeAgentAssemblyErrorCode};

const MAX_MODEL_NAME_BYTES: usize = 256;
const MAX_USER_INPUT_BYTES: usize = 512 * 1_024;
const MAX_CHAT_HISTORY_MESSAGES: usize = 999;
const DEFAULT_AGENT_STEP_LIMIT: u32 = 25;
const MAX_AGENT_STEP_LIMIT: u32 = 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReasoningEffort {
    Low,
    Medium,
    High,
    None,
}

/// Provider dialect selected by the authoritative frozen Main input.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OrdinaryModelProvider {
    OpenAiChat,
    NativeAnthropic,
}

/// Frozen model, history, and execution controls for the strict no-tool profile.
#[derive(Clone, Debug)]
pub(crate) struct OrdinaryNoToolProfile {
    kind: AgentExecutionKind,
    instructions: String,
    model_name: String,
    model_provider: OrdinaryModelProvider,
    model_project_id: u32,
    max_tokens: u32,
    reasoning_effort: Option<ReasoningEffort>,
    temperature: Option<f32>,
    step_limit: u32,
    chat_history: Vec<Content>,
    context_management: ContextManagementPlan,
    internal_tools: InternalToolCatalog,
}

impl OrdinaryNoToolProfile {
    /// Validate every unsupported current feature before PAT redemption.
    pub(crate) fn validate(
        request: &AgentExecutionRequest,
    ) -> Result<Self, NativeAgentAssemblyError> {
        Self::validate_with_mode(request, CommonProfileMode::Fresh)
    }

    /// Validate the same direct `LlmAgent` definition for one exact HITL resume.
    ///
    /// The decision payload itself is admitted separately by `DirectHitlDecision`;
    /// this mode only prevents the otherwise identical model/tool definition from
    /// being rejected because Main supplied the four continuation fields.
    pub(crate) fn validate_direct_hitl_resume(
        request: &AgentExecutionRequest,
    ) -> Result<Self, NativeAgentAssemblyError> {
        Self::validate_with_mode(request, CommonProfileMode::DirectGuardrailContinuation)
    }

    /// Validate a direct `LlmAgent` shell while Main supplies only one
    /// claim-fetched delegated-authorization decision.
    pub(crate) fn validate_delegated_authorization_resume(
        request: &AgentExecutionRequest,
    ) -> Result<Self, NativeAgentAssemblyError> {
        Self::validate_with_mode(request, CommonProfileMode::McpAuthorization)
    }

    /// Validate the model/session shell shared by a stored pipeline.
    ///
    /// The model fields remain part of the frozen application contract even
    /// when the currently admitted pure/control graph does not call a model. Pipeline YAML is
    /// returned as instructions and parsed by the graph-owned boundary.
    pub(crate) fn validate_pipeline_shell(
        request: &AgentExecutionRequest,
        resume: bool,
    ) -> Result<Self, NativeAgentAssemblyError> {
        let mode = if resume {
            CommonProfileMode::Continuation
        } else {
            CommonProfileMode::Fresh
        };
        let common = validate_common_profile(request, mode)?;
        Self::pipeline_shell(request, common)
    }

    pub(crate) fn validate_pipeline_mcp_authorization_shell(
        request: &AgentExecutionRequest,
    ) -> Result<Self, NativeAgentAssemblyError> {
        let common = validate_common_profile(request, CommonProfileMode::McpAuthorization)?;
        Self::pipeline_shell(request, common)
    }

    pub(crate) fn validate_pipeline_guardrail_authorization_shell(
        request: &AgentExecutionRequest,
    ) -> Result<Self, NativeAgentAssemblyError> {
        let common =
            validate_common_profile(request, CommonProfileMode::DirectGuardrailContinuation)?;
        Self::pipeline_shell(request, common)
    }

    fn pipeline_shell(
        request: &AgentExecutionRequest,
        common: CommonProfile,
    ) -> Result<Self, NativeAgentAssemblyError> {
        if request.kind != AgentExecutionKind::Application {
            return Err(unsupported_profile());
        }
        let model = application_model_for_agent_type(request, "pipeline")?;
        let internal_tools = application_internal_tools(request)?;
        Ok(Self {
            kind: request.kind,
            instructions: model.instructions,
            model_name: model.model_name,
            model_provider: model.model_provider,
            model_project_id: model.model_project_id,
            max_tokens: model.max_tokens,
            reasoning_effort: model.reasoning_effort,
            temperature: model.temperature,
            step_limit: validate_step_limit(request.payload.steps_limit)?,
            chat_history: common.chat_history,
            context_management: common.context_management,
            internal_tools,
        })
    }

    fn validate_with_mode(
        request: &AgentExecutionRequest,
        mode: CommonProfileMode,
    ) -> Result<Self, NativeAgentAssemblyError> {
        let common = validate_common_profile(request, mode)?;
        let model = match request.kind {
            AgentExecutionKind::Application => application_model(request)?,
            AgentExecutionKind::Adhoc => adhoc_model(request)?,
        };
        let internal_tools = match request.kind {
            AgentExecutionKind::Application => application_internal_tools(request)?,
            AgentExecutionKind::Adhoc => {
                InternalToolCatalog::from_names(&request.payload.internal_tools)
                    .map_err(internal_tool_profile_error)?
            }
        };
        Ok(Self {
            kind: request.kind,
            instructions: model.instructions,
            model_name: model.model_name,
            model_provider: model.model_provider,
            model_project_id: model.model_project_id,
            max_tokens: model.max_tokens,
            reasoning_effort: model.reasoning_effort,
            temperature: model.temperature,
            step_limit: validate_step_limit(request.payload.steps_limit)?,
            chat_history: common.chat_history,
            context_management: common.context_management,
            internal_tools,
        })
    }

    /// Validate one nested direct agent from Main's claim-materialized version.
    ///
    /// The current SDK falls back to the parent's model when an embedded child
    /// has null model settings. Rust preserves that behavior while giving the
    /// child a fresh provider invocation for every `AgentTool` call.
    pub(crate) fn from_nested_version(
        version: &Map<String, Value>,
        fallback: &Self,
    ) -> Result<Self, NativeAgentAssemblyError> {
        Self::from_nested_version_for_type(version, fallback, "agent")
    }

    /// Validate one nested stored pipeline while preserving the parent's model
    /// as the SDK-compatible fallback for its LLM/Decision nodes.
    pub(crate) fn from_nested_pipeline_version(
        version: &Map<String, Value>,
        fallback: &Self,
    ) -> Result<Self, NativeAgentAssemblyError> {
        Self::from_nested_version_for_type(version, fallback, "pipeline")
    }

    fn from_nested_version_for_type(
        version: &Map<String, Value>,
        fallback: &Self,
        expected_agent_type: &'static str,
    ) -> Result<Self, NativeAgentAssemblyError> {
        match version.get("agent_type") {
            None if expected_agent_type == "agent" => {}
            Some(Value::String(value)) if value == expected_agent_type => {}
            Some(Value::String(_)) => return Err(unsupported_profile()),
            Some(_) | None => return Err(invalid_profile()),
        }
        validate_feature_array(version.get("tools"), true)?;
        let internal_tools = internal_tools_from_version(version)?;
        validate_empty_feature_array(version.get("skills"), false)?;
        validate_application_meta(version.get("meta"))?;
        if version
            .get("variables")
            .and_then(Value::as_array)
            .is_some_and(|variables| !variables.is_empty())
        {
            return Err(unsupported_profile());
        }
        let instructions = version
            .get("instructions")
            .and_then(Value::as_str)
            .filter(|value| bounded_instruction(value))
            .ok_or_else(invalid_profile)?;
        if expected_agent_type == "agent"
            && ["{{", "{%", "{#"]
                .iter()
                .any(|marker| instructions.contains(marker))
        {
            return Err(unsupported_profile());
        }
        let model = match version.get("llm_settings") {
            None | Some(Value::Null) => ValidatedModel {
                instructions: instructions.to_owned(),
                model_name: fallback.model_name.clone(),
                model_provider: fallback.model_provider,
                model_project_id: fallback.model_project_id,
                max_tokens: fallback.max_tokens,
                reasoning_effort: fallback.reasoning_effort,
                temperature: fallback.temperature,
            },
            Some(Value::Object(settings)) if settings.is_empty() => ValidatedModel {
                instructions: instructions.to_owned(),
                model_name: fallback.model_name.clone(),
                model_provider: fallback.model_provider,
                model_project_id: fallback.model_project_id,
                max_tokens: fallback.max_tokens,
                reasoning_effort: fallback.reasoning_effort,
                temperature: fallback.temperature,
            },
            Some(Value::Object(settings)) => {
                validate_model(settings, ModelFieldNames::APPLICATION, None, instructions)?
            }
            Some(_) => return Err(invalid_profile()),
        };
        Ok(Self {
            kind: AgentExecutionKind::Application,
            instructions: model.instructions,
            model_name: model.model_name,
            model_provider: model.model_provider,
            model_project_id: model.model_project_id,
            max_tokens: model.max_tokens,
            reasoning_effort: model.reasoning_effort,
            temperature: model.temperature,
            step_limit: fallback.step_limit,
            chat_history: Vec::new(),
            context_management: ContextManagementPlan::Disabled,
            internal_tools,
        })
    }

    #[must_use]
    pub(crate) const fn kind(&self) -> AgentExecutionKind {
        self.kind
    }

    #[must_use]
    pub(crate) fn instructions(&self) -> &str {
        &self.instructions
    }

    #[must_use]
    pub(crate) fn model_name(&self) -> &str {
        &self.model_name
    }

    #[must_use]
    pub(crate) const fn model_provider(&self) -> OrdinaryModelProvider {
        self.model_provider
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
    pub(crate) const fn temperature(&self) -> Option<f32> {
        self.temperature
    }

    #[must_use]
    pub(crate) const fn step_limit(&self) -> u32 {
        self.step_limit
    }

    #[must_use]
    pub(crate) fn chat_history(&self) -> &[Content] {
        &self.chat_history
    }

    #[must_use]
    pub(crate) const fn context_management(&self) -> ContextManagementPlan {
        self.context_management
    }

    #[must_use]
    pub(crate) const fn internal_tools(&self) -> InternalToolCatalog {
        self.internal_tools
    }
}

struct CommonProfile {
    chat_history: Vec<Content>,
    context_management: ContextManagementPlan,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum CommonProfileMode {
    Fresh,
    Continuation,
    DirectGuardrailContinuation,
    McpAuthorization,
}

fn validate_common_profile(
    request: &AgentExecutionRequest,
    mode: CommonProfileMode,
) -> Result<CommonProfile, NativeAgentAssemblyError> {
    let payload = &request.payload;
    match &payload.user_input {
        UserInput::ContentBlocks(_) => return Err(unsupported_profile()),
        UserInput::Text(text) if text.is_empty() || text.contains('\0') => {
            return Err(invalid_profile());
        }
        UserInput::Text(text) if text.len() > MAX_USER_INPUT_BYTES => {
            return Err(resource_exhausted_profile());
        }
        UserInput::Text(_) => {}
    }
    let chat_history = current_text_history(&payload.chat_history)?;
    let context_management = ContextManagementPlan::admit_current(
        &payload.context_settings,
        payload.conversation_id.as_deref(),
    )?;
    let allows_mcp_authority = matches!(
        mode,
        CommonProfileMode::DirectGuardrailContinuation | CommonProfileMode::McpAuthorization
    );
    if (!allows_mcp_authority
        && (!payload.mcp_tokens.is_empty()
            || !payload.ignored_mcp_servers.is_empty()
            || !payload.user_declined_mcp_servers.is_empty()))
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
        || payload.persona != "generic"
    {
        return Err(unsupported_profile());
    }
    let has_direct_hitl_fields = payload.should_continue
        || payload.hitl_resume
        || payload.hitl_action.is_some()
        || payload.hitl_value.is_some()
        || !payload.hitl_decisions.is_empty();
    if (mode == CommonProfileMode::Fresh && has_direct_hitl_fields)
        || (mode != CommonProfileMode::Fresh && !has_direct_hitl_fields)
        || (mode == CommonProfileMode::McpAuthorization
            && (payload.hitl_resume
                || payload.hitl_action.is_some()
                || payload.hitl_value.is_some()
                || !payload.hitl_decisions.is_empty()))
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
        || payload
            .execution_generation
            .as_deref()
            .is_some_and(|value| !bounded_runtime_identity(value))
    {
        return Err(invalid_profile());
    }
    Ok(CommonProfile {
        chat_history,
        context_management,
    })
}

fn validate_step_limit(value: Option<u32>) -> Result<u32, NativeAgentAssemblyError> {
    match value {
        None => Ok(DEFAULT_AGENT_STEP_LIMIT),
        Some(value) if (1..=MAX_AGENT_STEP_LIMIT).contains(&value) => Ok(value),
        Some(_) => Err(invalid_profile()),
    }
}

fn current_text_history(history: &[Value]) -> Result<Vec<Content>, NativeAgentAssemblyError> {
    if history.len() > MAX_CHAT_HISTORY_MESSAGES {
        return Err(resource_exhausted_profile());
    }
    history.iter().map(current_text_history_message).collect()
}

fn current_text_history_message(value: &Value) -> Result<Content, NativeAgentAssemblyError> {
    let message = value.as_object().ok_or_else(invalid_profile)?;
    if message.len() != 3
        || !message
            .get("additional_kwargs")
            .and_then(Value::as_object)
            .is_some_and(Map::is_empty)
    {
        return Err(invalid_profile());
    }
    let role = match message.get("role").and_then(Value::as_str) {
        Some("user") => "user",
        Some("assistant") => "model",
        Some(_) => return Err(unsupported_profile()),
        None => return Err(invalid_profile()),
    };
    let parts = message
        .get("content")
        .and_then(Value::as_array)
        .filter(|parts| !parts.is_empty())
        .ok_or_else(invalid_profile)?;
    let mut content = Content::new(role);
    for part in parts {
        let part = part.as_object().ok_or_else(invalid_profile)?;
        if part.len() != 2 {
            return Err(invalid_profile());
        }
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {}
            Some(_) => return Err(unsupported_profile()),
            None => return Err(invalid_profile()),
        }
        let text = part
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty() && !text.contains('\0'))
            .ok_or_else(invalid_profile)?;
        content = content.with_text(text);
    }
    Ok(content)
}

fn application_model(
    request: &AgentExecutionRequest,
) -> Result<ValidatedModel, NativeAgentAssemblyError> {
    application_model_for_agent_type(request, "agent")
}

fn application_internal_tools(
    request: &AgentExecutionRequest,
) -> Result<InternalToolCatalog, NativeAgentAssemblyError> {
    let version = request
        .payload
        .application
        .get("version_details")
        .and_then(Value::as_object)
        .ok_or_else(invalid_profile)?;
    let configured = internal_tools_from_version(version)?;
    let conversation = InternalToolCatalog::from_names(&request.payload.internal_tools)
        .map_err(internal_tool_profile_error)?;
    Ok(configured.merge(conversation))
}

fn internal_tools_from_version(
    version: &Map<String, Value>,
) -> Result<InternalToolCatalog, NativeAgentAssemblyError> {
    let root = InternalToolCatalog::from_values(version.get("internal_tools"))
        .map_err(internal_tool_profile_error)?;
    let meta = match version.get("meta") {
        None | Some(Value::Null) => InternalToolCatalog::default(),
        Some(Value::Object(meta)) => InternalToolCatalog::from_values(meta.get("internal_tools"))
            .map_err(internal_tool_profile_error)?,
        Some(_) => return Err(invalid_profile()),
    };
    Ok(root.merge(meta))
}

fn application_model_for_agent_type(
    request: &AgentExecutionRequest,
    expected_agent_type: &str,
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
        None if expected_agent_type == "agent" => {}
        Some(Value::String(value)) if value == expected_agent_type => {}
        Some(Value::String(_)) => return Err(unsupported_profile()),
        Some(_) | None => return Err(invalid_profile()),
    }
    validate_feature_array(version.get("tools"), true)?;
    InternalToolCatalog::from_values(version.get("internal_tools"))
        .map_err(internal_tool_profile_error)?;
    validate_empty_feature_array(version.get("skills"), false)?;
    validate_application_meta(version.get("meta"))?;
    let instructions = version
        .get("instructions")
        .and_then(Value::as_str)
        .filter(|value| bounded_instruction(value))
        .ok_or_else(invalid_profile)?;
    if expected_agent_type == "agent"
        && ["{{", "{%", "{#"]
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
    if kwargs.len() != 1 {
        return Err(unsupported_profile());
    }
    let compatible = match kwargs.get("openai_compatible") {
        Some(Value::Bool(value)) => *value,
        Some(_) => return Err(invalid_profile()),
        None => return Err(unsupported_profile()),
    };
    validate_model(
        settings,
        ModelFieldNames::APPLICATION,
        Some(compatible),
        instructions,
    )
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

fn validate_feature_array(
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
    value.as_array().map(|_| ()).ok_or_else(invalid_profile)
}

fn validate_application_meta(value: Option<&Value>) -> Result<(), NativeAgentAssemblyError> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(());
    };
    let meta = value.as_object().ok_or_else(invalid_profile)?;
    if meta.contains_key("step_limit") {
        return Err(unsupported_profile());
    }
    InternalToolCatalog::from_values(meta.get("internal_tools"))
        .map_err(internal_tool_profile_error)?;
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
        .filter(|value| bounded_instruction(value))
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
    validate_model(kwargs, ModelFieldNames::ADHOC, None, instructions)
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
    instructions: String,
    model_name: String,
    model_provider: OrdinaryModelProvider,
    model_project_id: u32,
    max_tokens: u32,
    reasoning_effort: Option<ReasoningEffort>,
    temperature: Option<f32>,
}

fn validate_model(
    settings: &Map<String, Value>,
    names: ModelFieldNames,
    compatibility_override: Option<bool>,
    instructions: &str,
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
    let compatible = match compatibility_override {
        Some(value) => value,
        None => match settings.get("openai_compatible") {
            Some(Value::Bool(value)) => *value,
            None | Some(_) => return Err(invalid_profile()),
        },
    };
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
    let model_provider = if compatible || !anthropic_model_name(&model_name) {
        OrdinaryModelProvider::OpenAiChat
    } else {
        OrdinaryModelProvider::NativeAnthropic
    };
    if model_provider == OrdinaryModelProvider::NativeAnthropic
        && reasoning_effort == Some(ReasoningEffort::None)
        && adaptive_anthropic_model(&model_name)
    {
        return Err(invalid_profile());
    }
    Ok(ValidatedModel {
        instructions: instructions.to_owned(),
        model_name,
        model_provider,
        model_project_id,
        max_tokens,
        reasoning_effort,
        temperature,
    })
}

fn anthropic_model_name(model_name: &str) -> bool {
    let model_name = model_name.to_ascii_lowercase();
    model_name.contains("anthropic") || model_name.contains("claude")
}

fn adaptive_anthropic_model(model_name: &str) -> bool {
    let model_name = model_name.to_ascii_lowercase();
    [
        "opus-4-7",
        "opus_4_7",
        "opus-4.7",
        "opus-4-8",
        "opus_4_8",
        "opus-4.8",
        "sonnet-4-6",
        "sonnet_4_6",
        "sonnet-4.6",
        "sonnet-5",
        "sonnet_5",
        "opus-5",
        "opus_5",
    ]
    .iter()
    .any(|pattern| model_name.contains(pattern))
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

fn parse_temperature(value: &Value) -> Result<f32, NativeAgentAssemblyError> {
    serde_json::from_value::<f32>(value.clone())
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 1.0)
        .ok_or_else(invalid_profile)
}

fn bounded_runtime_identity(value: &str) -> bool {
    bounded_text(value, 256)
}

fn bounded_instruction(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 * 1_024 && !value.contains('\0')
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

fn internal_tool_profile_error(error: InternalToolError) -> NativeAgentAssemblyError {
    match error {
        InternalToolError::InvalidInput => invalid_profile(),
        InternalToolError::UnsupportedCapability => unsupported_profile(),
        InternalToolError::ResourceExhausted => resource_exhausted_profile(),
    }
}

fn resource_exhausted_profile() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::ResourceExhausted,
        "the authorized agent profile exceeds its approved limit",
    )
}
