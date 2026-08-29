use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::assembly::{
    DEFAULT_AGENT_STEP_LIMIT, OrdinaryModelProvider, OrdinaryNoToolProfile, ReasoningEffort,
};
use super::context_management::ContextManagementPlan;
use super::request::{
    AgentExecutionKind, AgentExecutionPayload, AgentExecutionRequest, AgentInputBinding,
    NextInputSuggestionPolicy, UserInput,
};
use super::runtime::{AuthorizedNativeAssembly, NativeAgentAssemblyErrorCode};
use super::session::AuthorizedNativeCommandBinding;
use crate::protocol::control::test_runtime_context_authority;
use crate::toolkits::ToolAdmissionPolicy;

fn empty_tool_policy() -> ToolAdmissionPolicy {
    ToolAdmissionPolicy::new(&[], &BTreeMap::new()).expect("empty toolkit policy")
}

fn object(value: Value) -> Map<String, Value> {
    let Value::Object(value) = value else {
        panic!("fixture object")
    };
    value
}

pub(super) fn ordinary_request(kind: AgentExecutionKind) -> AgentExecutionRequest {
    let (llm, application) = match kind {
        AgentExecutionKind::Application => (
            object(json!({"kwargs": {"openai_compatible": true}})),
            object(json!({
                "id": 11,
                "version_id": 22,
                "variables": [],
                "version_details": {
                    "agent_type": "agent",
                    "instructions": "review carefully",
                    "meta": {},
                    "tools": [],
                    "llm_settings": {
                        "model_name": "fixture-model",
                        "model_project_id": 17,
                        "max_tokens": 4096,
                        "reasoning_effort": "medium",
                        "temperature": null,
                        "openai_compatible": true
                    }
                }
            })),
        ),
        AgentExecutionKind::Adhoc => (
            object(json!({
                "kwargs": {
                    "model": "fixture-model",
                    "model_project_id": 17,
                    "max_tokens": 2048,
                    "reasoning_effort": null,
                    "temperature": 0.7,
                    "stream": true,
                    "openai_compatible": true
                }
            })),
            object(json!({"instructions": "be concise"})),
        ),
    };
    AgentExecutionRequest {
        kind,
        binding: AgentInputBinding {
            input_bundle_id: "bundle-1".to_owned(),
            input_bundle_digest: [1; 32],
            request_entry_id: "request-1".to_owned(),
            request_immutable_version: "v1".to_owned(),
            request_content_digest: [2; 32],
        },
        payload: AgentExecutionPayload {
            llm,
            chat_history: Vec::new(),
            user_input: UserInput::Text("current".to_owned()),
            thread_id: Some("thread-1".to_owned()),
            checkpoint_id: None,
            debug: false,
            tools: Vec::new(),
            application,
            internal_tools: Vec::new(),
            steps_limit: None,
            mcp_tokens: Map::new(),
            ignored_mcp_servers: Vec::new(),
            user_declined_mcp_servers: Vec::new(),
            should_continue: false,
            hitl_resume: false,
            hitl_action: None,
            hitl_value: None,
            hitl_decisions: Vec::new(),
            execution_generation: Some("question-1".to_owned()),
            is_regenerate: false,
            meta: Map::new(),
            conversation_id: Some("conversation-1".to_owned()),
            persona: "generic".to_owned(),
            context_settings: Map::new(),
            supports_vision: false,
            return_chat_history: false,
            invoked_skills: Vec::new(),
            applied_skills: Vec::new(),
            auto_approve_sensitive_actions: false,
            attached_skills: Vec::new(),
            input_attachments: Vec::new(),
            parallel_reconcile: None,
            parallel_terminal_errors: Vec::new(),
            exception_handling_enabled: None,
            debug_mode: None,
            next_input_suggestion: NextInputSuggestionPolicy::default(),
            toolkit_guardrails: None,
            truncated_content: None,
        },
    }
}

pub(super) fn current_text_history() -> Vec<Value> {
    vec![
        json!({
            "role": "user",
            "content": [{"type": "text", "text": "earlier question"}],
            "additional_kwargs": {}
        }),
        json!({
            "role": "assistant",
            "content": [
                {"type": "text", "text": "earlier "},
                {"type": "text", "text": "answer"}
            ],
            "additional_kwargs": {}
        }),
    ]
}

#[test]
fn application_and_adhoc_ordinary_profiles_normalize_current_main_model_contracts() {
    let application =
        OrdinaryNoToolProfile::validate(&ordinary_request(AgentExecutionKind::Application))
            .expect("ordinary application profile");
    assert_eq!(application.kind(), AgentExecutionKind::Application);
    assert_eq!(application.model_name(), "fixture-model");
    assert_eq!(
        application.model_provider(),
        OrdinaryModelProvider::OpenAiChat
    );
    assert_eq!(application.model_project_id(), 17);
    assert_eq!(application.max_tokens(), Some(4096));
    assert_eq!(
        application.reasoning_effort(),
        Some(ReasoningEffort::Medium)
    );
    assert_eq!(application.temperature(), None);

    let adhoc = OrdinaryNoToolProfile::validate(&ordinary_request(AgentExecutionKind::Adhoc))
        .expect("ordinary ad-hoc profile");
    assert_eq!(adhoc.kind(), AgentExecutionKind::Adhoc);
    assert_eq!(adhoc.model_name(), "fixture-model");
    assert_eq!(adhoc.model_provider(), OrdinaryModelProvider::OpenAiChat);
    assert_eq!(adhoc.model_project_id(), 17);
    assert_eq!(adhoc.max_tokens(), Some(2048));
    assert_eq!(adhoc.reasoning_effort(), None);
    assert_eq!(adhoc.temperature(), Some(0.7));

    let mut no_system_instruction = ordinary_request(AgentExecutionKind::Adhoc);
    no_system_instruction
        .payload
        .application
        .insert("instructions".to_owned(), json!(""));
    assert!(OrdinaryNoToolProfile::validate(&no_system_instruction).is_ok());

    let mut multiline = ordinary_request(AgentExecutionKind::Application);
    multiline
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version")
        .insert(
            "instructions".to_owned(),
            json!("review carefully\nreturn a concise answer"),
        );
    assert!(OrdinaryNoToolProfile::validate(&multiline).is_ok());

    let mut disabled_reasoning = ordinary_request(AgentExecutionKind::Adhoc);
    let kwargs = disabled_reasoning
        .payload
        .llm
        .get_mut("kwargs")
        .and_then(Value::as_object_mut)
        .expect("ad-hoc model settings");
    kwargs.insert("reasoning_effort".to_owned(), json!("none"));
    let disabled_reasoning = OrdinaryNoToolProfile::validate(&disabled_reasoning)
        .expect("disabled reasoning retains temperature");
    assert_eq!(
        disabled_reasoning.reasoning_effort(),
        Some(ReasoningEffort::None)
    );
    assert_eq!(disabled_reasoning.temperature(), Some(0.7));
}

#[test]
fn context_management_has_an_explicit_fail_closed_runner_seam() {
    let mut disabled = ordinary_request(AgentExecutionKind::Application);
    disabled
        .payload
        .context_settings
        .insert("enabled".to_owned(), json!(false));
    let profile = OrdinaryNoToolProfile::validate(&disabled)
        .expect("the current SDK master switch disables context management");
    assert_eq!(
        profile.context_management(),
        ContextManagementPlan::Disabled
    );

    let mut requested = ordinary_request(AgentExecutionKind::Application);
    requested
        .payload
        .context_settings
        .insert("enabled".to_owned(), json!(true));
    let error = OrdinaryNoToolProfile::validate(&requested)
        .expect_err("active context management remains capability-gated");
    assert_eq!(
        error.code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );

    let mut malformed = ordinary_request(AgentExecutionKind::Application);
    malformed
        .payload
        .context_settings
        .insert("enabled".to_owned(), json!("yes"));
    let error = OrdinaryNoToolProfile::validate(&malformed)
        .expect_err("a malformed master switch is not silently ignored");
    assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);
}

#[test]
fn output_continuation_profile_requires_one_clean_explicit_partial() {
    for partial in ["partial visible answer", ""] {
        let mut request = ordinary_request(AgentExecutionKind::Adhoc);
        request.payload.should_continue = true;
        request.payload.truncated_content = Some(partial.to_owned());
        OrdinaryNoToolProfile::validate_output_continuation(&request)
            .expect("authorized output continuation");
        let error = OrdinaryNoToolProfile::validate(&request)
            .expect_err("a fresh turn must reject continuation state");
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
    }

    for mutation in 0..5 {
        let mut request = ordinary_request(AgentExecutionKind::Adhoc);
        request.payload.should_continue = true;
        request.payload.truncated_content = Some("partial visible answer".to_owned());
        match mutation {
            0 => request.payload.truncated_content = None,
            1 => request.payload.truncated_content = Some("invalid\0partial".to_owned()),
            2 => request.payload.truncated_content = Some("x".repeat(64 * 1_024 + 1)),
            3 => request.payload.hitl_resume = true,
            4 => request.payload.hitl_action = Some("approve".to_owned()),
            _ => unreachable!("bounded mutation corpus"),
        }
        let error = OrdinaryNoToolProfile::validate_output_continuation(&request)
            .expect_err("mixed or malformed output continuation must fail closed");
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
    }
}

#[test]
fn every_unimplemented_effect_surface_is_rejected_before_redemption() {
    for mutation in 0..24 {
        let mut request = ordinary_request(AgentExecutionKind::Application);
        match mutation {
            0 => request.payload.ignored_mcp_servers.push(json!("server")),
            1 => {
                request
                    .payload
                    .mcp_tokens
                    .insert("server".to_owned(), json!("secret-reference"));
            }
            2 => request.payload.hitl_resume = true,
            3 => request.payload.invoked_skills.push(json!("review")),
            4 => request
                .payload
                .attached_skills
                .push(json!({"name": "review"})),
            5 => request
                .payload
                .input_attachments
                .push(json!({"artifact_id": "one"})),
            6 => request.payload.user_input = UserInput::ContentBlocks(vec![json!({"text": "x"})]),
            7 => request.payload.checkpoint_id = Some("checkpoint-1".to_owned()),
            8 => request.payload.parallel_reconcile = Some(Map::new()),
            9 => request.payload.auto_approve_sensitive_actions = true,
            10 => {
                request
                    .payload
                    .context_settings
                    .insert("x".to_owned(), json!(1));
            }
            11 => request.payload.return_chat_history = true,
            12 => request.payload.next_input_suggestion.enabled = true,
            13 => request.payload.debug_mode = Some(false),
            14 => request.payload.should_continue = true,
            15 => {
                request.payload.application.insert(
                    "variables".to_owned(),
                    json!([{"name": "audience", "value": "ops"}]),
                );
            }
            16 => {
                request
                    .payload
                    .application
                    .get_mut("version_details")
                    .and_then(Value::as_object_mut)
                    .expect("application version")
                    .insert("instructions".to_owned(), json!("review {{ audience }}"));
            }
            17 => {
                // `internal_mcp` rather than the step limit that used to sit
                // here: the step limit is now ADMITTED on the version, because
                // Main writes it into every saved version and the Python worker
                // reads it from there. `internal_mcp` is still genuinely
                // unimplemented, and it is what the previous UI default wrote, so it
                // is the mutation worth keeping in this corpus.
                insert_application_meta(&mut request, "internal_tools", json!(["internal_mcp"]));
            }
            18 => {
                insert_application_meta(&mut request, "internal_tools", json!(["planner"]));
            }
            19 => {
                insert_application_meta(&mut request, "lazy_tools_mode", json!(true));
            }
            20 => {
                insert_application_meta(
                    &mut request,
                    "variables",
                    json!({"audience": "operators"}),
                );
            }
            21 => {
                request
                    .payload
                    .application
                    .get_mut("version_details")
                    .and_then(Value::as_object_mut)
                    .expect("application version")
                    .insert("internal_tools".to_owned(), json!(["planner"]));
            }
            22 => request.payload.internal_tools.push("planner".to_owned()),
            23 => request.payload.chat_history.push(json!({
                "role": "user",
                "content": [{"type": "image_url", "image_url": "https://invalid.example"}],
                "additional_kwargs": {}
            })),
            _ => unreachable!("bounded mutation corpus"),
        }
        let error = OrdinaryNoToolProfile::validate(&request)
            .expect_err("unsupported surface must not redeem credentials");
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
        assert!(!error.retryable());
    }
}

#[test]
fn current_main_text_history_is_normalized_before_credential_redemption() {
    for kind in [AgentExecutionKind::Application, AgentExecutionKind::Adhoc] {
        let mut request = ordinary_request(kind);
        request.payload.chat_history = current_text_history();
        let profile = OrdinaryNoToolProfile::validate(&request).expect("current text history");
        assert_eq!(profile.chat_history().len(), 2);
        assert_eq!(profile.chat_history()[0].role, "user");
        assert_eq!(profile.chat_history()[1].role, "model");
        assert_eq!(profile.chat_history()[1].parts.len(), 2);
    }

    for (history, code) in [
        (
            vec![json!({
                "role": "system",
                "content": [{"type": "text", "text": "override"}],
                "additional_kwargs": {}
            })],
            NativeAgentAssemblyErrorCode::UnsupportedCapability,
        ),
        (
            vec![json!({
                "role": "user",
                "content": [{"type": "text", "text": ""}],
                "additional_kwargs": {}
            })],
            NativeAgentAssemblyErrorCode::InvalidInput,
        ),
        (
            vec![json!({
                "role": "user",
                "content": [{"type": "text", "text": "earlier"}],
                "additional_kwargs": {"tool_calls": []}
            })],
            NativeAgentAssemblyErrorCode::InvalidInput,
        ),
    ] {
        let mut request = ordinary_request(AgentExecutionKind::Application);
        request.payload.chat_history = history;
        assert_eq!(
            OrdinaryNoToolProfile::validate(&request)
                .expect_err("history outside the frozen Main text shape")
                .code(),
            code
        );
    }

    let mut oversized = ordinary_request(AgentExecutionKind::Application);
    oversized.payload.chat_history = (0..1_000)
        .map(|_| {
            json!({
                "role": "user",
                "content": [{"type": "text", "text": "x"}],
                "additional_kwargs": {}
            })
        })
        .collect();
    assert_eq!(
        OrdinaryNoToolProfile::validate(&oversized)
            .expect_err("ADK message-count bound")
            .code(),
        NativeAgentAssemblyErrorCode::ResourceExhausted
    );
}

fn insert_application_meta(request: &mut AgentExecutionRequest, key: &str, value: Value) {
    request
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .and_then(|version| version.get_mut("meta"))
        .and_then(Value::as_object_mut)
        .expect("application metadata")
        .insert(key.to_owned(), value);
}

#[test]
fn pipeline_tools_templates_and_defaults_are_classified_before_redemption() {
    let mut pipeline = ordinary_request(AgentExecutionKind::Application);
    let version = pipeline
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version");
    version.insert("agent_type".to_owned(), json!("pipeline"));
    assert_eq!(
        OrdinaryNoToolProfile::validate(&pipeline)
            .expect_err("pipeline profile")
            .code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );

    let mut configured_tool = ordinary_request(AgentExecutionKind::Application);
    configured_tool
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version")
        .insert("tools".to_owned(), json!([{"type": "github"}]));
    assert!(OrdinaryNoToolProfile::validate(&configured_tool).is_ok());
    assert!(
        AuthorizedNativeAssembly::new(
            &configured_tool,
            test_runtime_context_authority(),
            AuthorizedNativeCommandBinding::fixture(),
        )
        .admit_llm_agent(&empty_tool_policy())
        .is_err()
    );

    let mut application_override = ordinary_request(AgentExecutionKind::Application);
    application_override
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version")
        .get_mut("llm_settings")
        .and_then(Value::as_object_mut)
        .expect("application model settings")
        .insert("openai_compatible".to_owned(), Value::Bool(false));
    assert!(OrdinaryNoToolProfile::validate(&application_override).is_ok());

    let mut defaulted_application = ordinary_request(AgentExecutionKind::Application);
    let version = defaulted_application
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version");
    version.remove("agent_type");
    version
        .get_mut("llm_settings")
        .and_then(Value::as_object_mut)
        .expect("application model settings")
        .insert("max_tokens".to_owned(), json!(-1));
    let profile = OrdinaryNoToolProfile::validate(&defaulted_application)
        .expect("SDK-compatible application defaults");
    assert_eq!(profile.max_tokens(), None);

    let mut templated_adhoc = ordinary_request(AgentExecutionKind::Adhoc);
    templated_adhoc
        .payload
        .application
        .insert("instructions".to_owned(), json!("review {{ audience }}"));
    assert_eq!(
        OrdinaryNoToolProfile::validate(&templated_adhoc)
            .expect_err("unimplemented ad-hoc template")
            .code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

#[test]
fn authoritative_compatibility_selects_the_sdk_provider_dialect() {
    let mut native_adhoc = ordinary_request(AgentExecutionKind::Adhoc);
    let native_kwargs = native_adhoc
        .payload
        .llm
        .get_mut("kwargs")
        .and_then(Value::as_object_mut)
        .expect("model kwargs");
    native_kwargs.insert("model".to_owned(), json!("claude-sonnet-4-5"));
    native_kwargs.insert("openai_compatible".to_owned(), Value::Bool(false));
    assert_eq!(
        OrdinaryNoToolProfile::validate(&native_adhoc)
            .expect("native Anthropic ad-hoc profile")
            .model_provider(),
        OrdinaryModelProvider::NativeAnthropic
    );

    let mut native_application = ordinary_request(AgentExecutionKind::Application);
    native_application
        .payload
        .llm
        .get_mut("kwargs")
        .and_then(Value::as_object_mut)
        .expect("application runtime model")
        .insert("openai_compatible".to_owned(), Value::Bool(false));
    native_application
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .and_then(|version| version.get_mut("llm_settings"))
        .and_then(Value::as_object_mut)
        .expect("application model settings")
        .insert(
            "model_name".to_owned(),
            json!("anthropic/claude-sonnet-4-5"),
        );
    assert_eq!(
        OrdinaryNoToolProfile::validate(&native_application)
            .expect("native Anthropic application profile")
            .model_provider(),
        OrdinaryModelProvider::NativeAnthropic
    );

    native_adhoc
        .payload
        .llm
        .get_mut("kwargs")
        .and_then(Value::as_object_mut)
        .expect("model kwargs")
        .insert("openai_compatible".to_owned(), Value::Bool(true));
    assert_eq!(
        OrdinaryNoToolProfile::validate(&native_adhoc)
            .expect("Claude through OpenAI-compatible profile")
            .model_provider(),
        OrdinaryModelProvider::OpenAiChat
    );

    let mut unsupported_adaptive_none = ordinary_request(AgentExecutionKind::Adhoc);
    let settings = unsupported_adaptive_none
        .payload
        .llm
        .get_mut("kwargs")
        .and_then(Value::as_object_mut)
        .expect("adaptive model settings");
    settings.insert("model".to_owned(), json!("claude-sonnet-4-6"));
    settings.insert("openai_compatible".to_owned(), json!(false));
    settings.insert("reasoning_effort".to_owned(), json!("none"));
    assert_eq!(
        OrdinaryNoToolProfile::validate(&unsupported_adaptive_none)
            .expect_err("pinned SDK cannot construct adaptive effort none")
            .code(),
        NativeAgentAssemblyErrorCode::InvalidInput
    );
}

#[test]
fn malformed_model_and_session_bindings_are_not_treated_as_dependency_failures() {
    for mutation in 0..4 {
        let mut request = ordinary_request(AgentExecutionKind::Adhoc);
        match mutation {
            0 => request.payload.thread_id = None,
            1 => request.payload.conversation_id = Some("bad\nidentity".to_owned()),
            2 => {
                request
                    .payload
                    .llm
                    .get_mut("kwargs")
                    .and_then(Value::as_object_mut)
                    .expect("model kwargs")
                    .insert("model_project_id".to_owned(), json!(0));
            }
            3 => {
                let kwargs = request
                    .payload
                    .llm
                    .get_mut("kwargs")
                    .and_then(Value::as_object_mut)
                    .expect("model kwargs");
                kwargs.insert("reasoning_effort".to_owned(), json!("high"));
                kwargs.insert("temperature".to_owned(), json!(0.7));
            }
            _ => unreachable!("bounded mutation corpus"),
        }
        let error =
            OrdinaryNoToolProfile::validate(&request).expect_err("malformed ordinary profile");
        assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);
        assert!(!error.retryable());
    }
}

#[test]
fn credential_redemption_is_unreachable_until_the_profile_is_admitted() {
    let request = ordinary_request(AgentExecutionKind::Application);
    let admitted = AuthorizedNativeAssembly::new(
        &request,
        test_runtime_context_authority(),
        AuthorizedNativeCommandBinding::fixture(),
    )
    .admit_llm_agent(&empty_tool_policy())
    .expect("admitted assembly");
    assert_eq!(admitted.request().kind, AgentExecutionKind::Application);
    assert_eq!(admitted.profile().model_project_id(), 17);

    let mut unsupported = ordinary_request(AgentExecutionKind::Application);
    unsupported.payload.tools.push(json!({"type": "github"}));
    assert!(
        AuthorizedNativeAssembly::new(
            &unsupported,
            test_runtime_context_authority(),
            AuthorizedNativeCommandBinding::fixture(),
        )
        .admit_llm_agent(&empty_tool_policy())
        .is_err()
    );
}

#[test]
fn regeneration_is_admitted_as_a_durable_session_rebuild() {
    let mut request = ordinary_request(AgentExecutionKind::Adhoc);
    request.payload.is_regenerate = true;
    OrdinaryNoToolProfile::validate_regeneration(&request).expect("regeneration profile");
    assert_eq!(
        OrdinaryNoToolProfile::validate(&request)
            .expect_err("fresh admission must not absorb regeneration")
            .code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );

    let admitted = AuthorizedNativeAssembly::new(
        &request,
        test_runtime_context_authority(),
        AuthorizedNativeCommandBinding::fixture(),
    )
    .admit_llm_agent(&empty_tool_policy())
    .expect("admitted regeneration");
    assert!(admitted.is_resume());

    let mut mixed = request;
    mixed.payload.should_continue = true;
    let Err(error) = AuthorizedNativeAssembly::new(
        &mixed,
        test_runtime_context_authority(),
        AuthorizedNativeCommandBinding::fixture(),
    )
    .admit_llm_agent(&empty_tool_policy()) else {
        panic!("regeneration cannot also resume an interrupt");
    };
    assert_eq!(
        error.code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

/// The authored step limit lives on the version AND on the input, and this
/// pins both halves of that arrangement.
///
/// Main writes `meta.step_limit` into every saved version
/// (`services/elitea-main/internal/api/v2/applications/handler.go`) and derives
/// `steps_limit` on the execution input from the same number
/// (`internal/application/agentexecution/start.go::currentApplicationStepsLimit`).
/// The Python worker still reads the version key for its `LangGraph` recursion
/// limit, so neither side can drop it. Refusing the key here refused every
/// stored agent — measured in a browser against a live stack, where the turn
/// was admitted, streamed nothing, and stopped.
///
/// The effective limit is still `payload.steps_limit` alone: the version value
/// is admitted, not consulted.
#[test]
fn an_authored_step_limit_is_admitted_and_does_not_select_the_effective_one() {
    let mut request = ordinary_request(AgentExecutionKind::Application);
    insert_application_meta(&mut request, "step_limit", json!(17));
    request.payload.steps_limit = Some(64);

    let admitted = AuthorizedNativeAssembly::new(
        &request,
        test_runtime_context_authority(),
        AuthorizedNativeCommandBinding::fixture(),
    )
    .admit_llm_agent(&empty_tool_policy())
    .expect("an authored step limit must not refuse the profile");
    assert_eq!(admitted.profile().step_limit(), 64);

    let mut without_input_limit = ordinary_request(AgentExecutionKind::Application);
    insert_application_meta(&mut without_input_limit, "step_limit", json!(17));
    let defaulted = AuthorizedNativeAssembly::new(
        &without_input_limit,
        test_runtime_context_authority(),
        AuthorizedNativeCommandBinding::fixture(),
    )
    .admit_llm_agent(&empty_tool_policy())
    .expect("an authored step limit must not refuse the profile");
    assert_eq!(defaulted.profile().step_limit(), DEFAULT_AGENT_STEP_LIMIT);
}

/// A version step limit outside the bounds the input enforces is malformed
/// input, not an unimplemented capability — the distinction matters because
/// only the second is a "this runtime cannot do that yet" answer.
#[test]
fn a_malformed_version_step_limit_is_refused_as_invalid_input() {
    for value in [json!(0), json!(1_025), json!(-1), json!("many"), json!(1.5)] {
        let mut request = ordinary_request(AgentExecutionKind::Application);
        insert_application_meta(&mut request, "step_limit", value.clone());
        let Err(error) = AuthorizedNativeAssembly::new(
            &request,
            test_runtime_context_authority(),
            AuthorizedNativeCommandBinding::fixture(),
        )
        .admit_llm_agent(&empty_tool_policy()) else {
            panic!("an out-of-range step limit must not be admitted: {value}");
        };
        assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);
    }
}

/// An agent saved with no instructions must run.
///
/// The create form does not require the field and nothing fills it in, so this
/// is an ordinary thing to have in a project. Refusing it produced "The
/// execution input is invalid." on every turn — measured in a browser against a
/// live stack, on an agent created through the product's own form.
///
/// A PIPELINE is the opposite case: its instructions carry the graph YAML, and
/// an empty one has nothing to compile.
#[test]
fn a_direct_agent_may_have_no_instructions_but_a_pipeline_may_not() {
    let mut agent = ordinary_request(AgentExecutionKind::Application);
    set_application_instructions(&mut agent, "");
    AuthorizedNativeAssembly::new(
        &agent,
        test_runtime_context_authority(),
        AuthorizedNativeCommandBinding::fixture(),
    )
    .admit_llm_agent(&empty_tool_policy())
    .expect("an agent with no system prompt is still an agent");

    let mut pipeline = ordinary_request(AgentExecutionKind::Application);
    set_application_agent_type(&mut pipeline, "pipeline");
    set_application_instructions(&mut pipeline, "");
    assert_eq!(
        OrdinaryNoToolProfile::validate_pipeline_shell(&pipeline, false)
            .expect_err("an empty pipeline graph has nothing to run")
            .code(),
        NativeAgentAssemblyErrorCode::InvalidInput
    );
}

fn application_version_mut(request: &mut AgentExecutionRequest) -> &mut Map<String, Value> {
    request
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version")
}

fn set_application_instructions(request: &mut AgentExecutionRequest, instructions: &str) {
    application_version_mut(request).insert("instructions".to_owned(), json!(instructions));
}

fn set_application_agent_type(request: &mut AgentExecutionRequest, agent_type: &str) {
    application_version_mut(request).insert("agent_type".to_owned(), json!(agent_type));
}

/// `meta.variables` arrives as an ARRAY, because that is what Main stores.
///
/// The create path folds variables into meta only when there are some, but the
/// update path writes the key on presence so that deleting the last variable is
/// distinguishable from never having had one. Every agent saved a second time
/// therefore carries `"variables": []` — measured on a live stack, where such an
/// agent answered "The execution input is invalid." on every turn.
#[test]
fn an_empty_variable_list_is_admitted_in_either_shape() {
    for empty in [json!([]), json!({}), Value::Null] {
        let mut request = ordinary_request(AgentExecutionKind::Application);
        insert_application_meta(&mut request, "variables", empty.clone());
        AuthorizedNativeAssembly::new(
            &request,
            test_runtime_context_authority(),
            AuthorizedNativeCommandBinding::fixture(),
        )
        .admit_llm_agent(&empty_tool_policy())
        .unwrap_or_else(|error| {
            panic!("an empty variable list must be admitted: {empty} ({error:?})")
        });
    }
}

/// A list that actually names variables is still refused — and as an
/// unsupported CAPABILITY, not as malformed input, because substitution is
/// genuinely not implemented here.
#[test]
fn a_populated_variable_list_is_still_an_unsupported_capability() {
    for populated in [
        json!([{"name": "audience", "value": "ops"}]),
        json!({"audience": "ops"}),
    ] {
        let mut request = ordinary_request(AgentExecutionKind::Application);
        insert_application_meta(&mut request, "variables", populated.clone());
        let Err(error) = AuthorizedNativeAssembly::new(
            &request,
            test_runtime_context_authority(),
            AuthorizedNativeCommandBinding::fixture(),
        )
        .admit_llm_agent(&empty_tool_policy()) else {
            panic!("variable substitution is not implemented: {populated}");
        };
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
    }
}
