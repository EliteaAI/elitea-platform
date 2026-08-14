use serde_json::{Map, Value, json};

use super::assembly::{OrdinaryNoToolProfile, ReasoningEffort};
use super::request::{
    AgentExecutionKind, AgentExecutionPayload, AgentExecutionRequest, AgentInputBinding,
    NextInputSuggestionPolicy, UserInput,
};
use super::runtime::{AuthorizedNativeAssembly, NativeAgentAssemblyErrorCode};
use crate::protocol::control::test_runtime_context_authority;

fn object(value: Value) -> Map<String, Value> {
    let Value::Object(value) = value else {
        panic!("fixture object")
    };
    value
}

fn ordinary_request(kind: AgentExecutionKind) -> AgentExecutionRequest {
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
        },
    }
}

#[test]
fn application_and_adhoc_ordinary_profiles_normalize_current_main_model_contracts() {
    let application =
        OrdinaryNoToolProfile::validate(&ordinary_request(AgentExecutionKind::Application))
            .expect("ordinary application profile");
    assert_eq!(application.kind(), AgentExecutionKind::Application);
    assert_eq!(application.model_name(), "fixture-model");
    assert_eq!(application.model_project_id(), 17);
    assert_eq!(application.max_tokens(), 4096);
    assert_eq!(
        application.reasoning_effort(),
        Some(ReasoningEffort::Medium)
    );
    assert_eq!(application.temperature(), None);

    let adhoc = OrdinaryNoToolProfile::validate(&ordinary_request(AgentExecutionKind::Adhoc))
        .expect("ordinary ad-hoc profile");
    assert_eq!(adhoc.kind(), AgentExecutionKind::Adhoc);
    assert_eq!(adhoc.model_name(), "fixture-model");
    assert_eq!(adhoc.model_project_id(), 17);
    assert_eq!(adhoc.max_tokens(), 2048);
    assert_eq!(adhoc.reasoning_effort(), None);
    assert_eq!(adhoc.temperature(), Some(0.7));

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
fn every_unimplemented_effect_surface_is_rejected_before_redemption() {
    for mutation in 0..24 {
        let mut request = ordinary_request(AgentExecutionKind::Application);
        match mutation {
            0 => request.payload.tools.push(json!({"type": "github"})),
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
            14 => request.payload.steps_limit = Some(17),
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
                insert_application_meta(&mut request, "step_limit", json!(17));
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
            23 => request
                .payload
                .chat_history
                .push(json!({"role": "user", "content": "earlier"})),
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
fn pipeline_tools_and_unsupported_model_dialects_fail_closed() {
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
    assert!(OrdinaryNoToolProfile::validate(&configured_tool).is_err());

    let mut anthropic = ordinary_request(AgentExecutionKind::Adhoc);
    anthropic
        .payload
        .llm
        .get_mut("kwargs")
        .and_then(Value::as_object_mut)
        .expect("model kwargs")
        .insert("openai_compatible".to_owned(), Value::Bool(false));
    assert_eq!(
        OrdinaryNoToolProfile::validate(&anthropic)
            .expect_err("unreviewed provider dialect")
            .code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
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
    assert_eq!(profile.max_tokens(), 4_000);

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
    let admitted = AuthorizedNativeAssembly::new(&request, test_runtime_context_authority())
        .admit_ordinary_no_tool()
        .expect("admitted assembly");
    assert_eq!(admitted.request().kind, AgentExecutionKind::Application);
    assert_eq!(admitted.profile().model_project_id(), 17);

    let mut unsupported = ordinary_request(AgentExecutionKind::Application);
    unsupported.payload.tools.push(json!({"type": "github"}));
    assert!(
        AuthorizedNativeAssembly::new(&unsupported, test_runtime_context_authority())
            .admit_ordinary_no_tool()
            .is_err()
    );
}
