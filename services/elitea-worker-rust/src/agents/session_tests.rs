use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use adk_rust::model::MockLlm;
use adk_rust::session::{GetRequest, InMemorySessionService, SessionService};
use adk_rust::tool::BasicToolset;
use adk_rust::{
    Content, FinishReason, Llm, LlmRequest, LlmResponse, LlmResponseStream, Part, Tool,
    ToolConfirmationDecision, ToolContext, Toolset,
};
use async_trait::async_trait;
use chrono::Utc;
use serde_json::{Value, json};

use super::assembly::OrdinaryNoToolProfile;
use super::assembly_tests::{current_text_history, ordinary_request};
use super::direct_hitl::DirectHitlDecision;
use super::events::AgentEventProjectionErrorCode;
use super::request::{AgentExecutionKind, UserInput};
use super::runtime::{NativeAgentCompletionSelector, NativeAgentRuntimeErrorCode};
use super::sensitive_tools::SensitiveToolCatalog;
use super::session::{
    AuthorizedNativeCommandBinding, BoundOrdinaryAgentModel, NativeSessionBackend,
    OrdinaryNativeAgentPlan, assemble_ordinary_native, assemble_ordinary_native_with_sessions,
    assemble_read_only_direct_hitl_resume_with_sessions,
};
use crate::protocol::control::test_session_authority_for;
use crate::protocol::node_event::encode_current_node_event_json;
use crate::toolkits::ToolAdmissionPolicy;

struct FixtureBoundModel {
    model: Arc<dyn Llm>,
    completed: String,
}

impl BoundOrdinaryAgentModel for FixtureBoundModel {
    fn adk_model(&self) -> Arc<dyn Llm> {
        self.model.clone()
    }

    fn take_completed_text(self) -> Result<String, super::runtime::NativeAgentAssemblyError> {
        Ok(self.completed)
    }
}

fn bound_model(response: &str) -> FixtureBoundModel {
    FixtureBoundModel {
        model: Arc::new(
            MockLlm::new("fixture-model").with_response(LlmResponse::new(
                Content::new("assistant").with_text(response),
            )),
        ),
        completed: response.to_owned(),
    }
}

struct SequencedLlm {
    responses: Mutex<VecDeque<LlmResponse>>,
    calls: Arc<AtomicUsize>,
}

struct CapturingFinalLlm {
    requests: Arc<Mutex<Vec<LlmRequest>>>,
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl Llm for CapturingFinalLlm {
    fn name(&self) -> &'static str {
        "fixture-model"
    }

    async fn generate_content(
        &self,
        request: LlmRequest,
        _stream: bool,
    ) -> adk_rust::Result<LlmResponseStream> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.requests
            .lock()
            .map_err(|_| adk_rust::AdkError::agent("fixture request lock failed"))?
            .push(request);
        Ok(Box::pin(adk_rust::futures::stream::once(async {
            Ok(LlmResponse::new(
                Content::new("model").with_text("The resumed answer is 42."),
            ))
        })))
    }
}

#[async_trait]
impl Llm for SequencedLlm {
    fn name(&self) -> &'static str {
        "fixture-model"
    }

    async fn generate_content(
        &self,
        _request: LlmRequest,
        _stream: bool,
    ) -> adk_rust::Result<LlmResponseStream> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let response = self
            .responses
            .lock()
            .map_err(|_| adk_rust::AdkError::agent("fixture model lock failed"))?
            .pop_front()
            .ok_or_else(|| adk_rust::AdkError::agent("fixture model response missing"))?;
        Ok(Box::pin(adk_rust::futures::stream::once(async move {
            Ok(response)
        })))
    }
}

struct CountingTool {
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl Tool for CountingTool {
    fn name(&self) -> &'static str {
        "double"
    }

    fn description(&self) -> &'static str {
        "Double one integer."
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        _context: Arc<dyn ToolContext>,
        arguments: Value,
    ) -> adk_rust::Result<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let value = arguments
            .get("value")
            .and_then(Value::as_i64)
            .ok_or_else(|| adk_rust::AdkError::agent("fixture value missing"))?;
        Ok(json!({"value": value * 2}))
    }
}

fn tool_call_response() -> LlmResponse {
    tool_call_response_with(json!({"value": 21}))
}

fn tool_call_response_with(args: Value) -> LlmResponse {
    LlmResponse {
        content: Some(Content {
            role: "model".to_owned(),
            parts: vec![Part::FunctionCall {
                name: "double".to_owned(),
                args,
                id: Some("call-1".to_owned()),
                thought_signature: None,
            }],
        }),
        finish_reason: Some(FinishReason::Stop),
        turn_complete: true,
        ..LlmResponse::default()
    }
}

fn sensitive_catalog() -> SensitiveToolCatalog {
    let runtime = json!({
        "toolkit_security": {
            "sensitive_tools": {"fixture": ["double"]},
            "sensitive_action_company_name": "Example Org",
            "sensitive_action_message_template":
                "{company_name} must approve {action_name}."
        }
    });
    let policy = ToolAdmissionPolicy::from_runtime_config(
        runtime.as_object().expect("runtime configuration object"),
    )
    .expect("runtime policy");
    SensitiveToolCatalog::fixture(
        "double",
        policy
            .sensitive_tool("fixture", "Fixture Tools", "double")
            .expect("sensitive double policy"),
        true,
    )
    .expect("sensitive catalog")
}

#[tokio::test]
async fn invocation_local_session_runs_one_real_adk_turn_and_projects_the_exact_completion() {
    let request = ordinary_request(AgentExecutionKind::Application);
    let profile = OrdinaryNoToolProfile::validate(&request).expect("ordinary profile");
    let plan = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("native plan");
    let mut assembled = assemble_ordinary_native(
        bound_model("native response"),
        plan,
        Vec::new(),
        SensitiveToolCatalog::default(),
    )
    .await
    .expect("native assembly");
    let start = assembled
        .project_start(Utc::now())
        .expect("projected start");
    assert_eq!(start.len(), 1);

    let (mut native, mut projector, completion) = assembled.start().expect("native start");
    let mut projected = 0_usize;
    while let Some(event) = native.next_event().await.expect("native event") {
        projected += projector.project(&event).expect("projected event").len();
    }
    assert!(projected >= 3);
    let completion = completion.select().await.expect("selected completion");
    let finish = projector
        .finish_after_eos(completion, Utc::now())
        .expect("projected completion");
    let mut event_types = Vec::new();
    for event in finish {
        let value: serde_json::Value = serde_json::from_slice(
            &encode_current_node_event_json(&event).expect("canonical browser event"),
        )
        .expect("browser event JSON");
        event_types.push(value["type"].as_str().unwrap_or_default().to_owned());
        if value["type"] == "full_message" {
            assert_eq!(value["content"], "native response");
            assert_eq!(value["stream_id"], "conversation-1");
            assert_eq!(value["message_id"], "message-1");
            assert_eq!(value["response_metadata"]["project_id"], 17);
            assert_eq!(value["response_metadata"]["chat_project_id"], 9);
        }
    }
    assert_eq!(
        event_types,
        ["pipeline_finish", "agent_response", "full_message"]
    );
    assert_eq!(
        native
            .next_event()
            .await
            .expect_err("one-use stream")
            .code(),
        NativeAgentRuntimeErrorCode::InvalidState
    );
}

#[tokio::test]
async fn injected_session_restores_existing_history_without_reseeding_the_frozen_snapshot() {
    let mut request = ordinary_request(AgentExecutionKind::Application);
    request.payload.chat_history = current_text_history();
    let profile = OrdinaryNoToolProfile::validate(&request).expect("ordinary profile");
    let first_plan = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("first native plan");
    let user_id = first_plan.user_id().to_owned();
    let session_id = first_plan.session_id().to_owned();
    let sessions = Arc::new(InMemorySessionService::new());
    let first_sessions: Arc<dyn SessionService> = sessions.clone();
    let first = assemble_ordinary_native_with_sessions(
        bound_model("first response"),
        first_plan,
        Vec::new(),
        SensitiveToolCatalog::default(),
        first_sessions,
    )
    .await
    .expect("first assembly");
    drop(first);

    let second_plan = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("second native plan");
    let second_sessions: Arc<dyn SessionService> = sessions.clone();
    let second = assemble_ordinary_native_with_sessions(
        bound_model("second response"),
        second_plan,
        Vec::new(),
        SensitiveToolCatalog::default(),
        second_sessions,
    )
    .await
    .expect("restored assembly");
    drop(second);

    let restored = sessions
        .get(GetRequest {
            app_name: "elitea-agent-v1".to_owned(),
            user_id,
            session_id,
            num_recent_events: None,
            after: None,
        })
        .await
        .expect("restored injected session");
    assert_eq!(restored.events().len(), 2);
    let first_id = restored
        .events()
        .at(0)
        .expect("first history event")
        .id
        .clone();
    let second_id = restored
        .events()
        .at(1)
        .expect("second history event")
        .id
        .clone();
    assert!(first_id.starts_with("fh-"));
    assert!(second_id.starts_with("fh-"));
    assert_ne!(first_id, second_id);
}

#[tokio::test]
async fn session_backend_rejects_a_claim_from_another_execution_before_storage() {
    let request = ordinary_request(AgentExecutionKind::Application);
    let profile = OrdinaryNoToolProfile::validate(&request).expect("ordinary profile");
    let plan = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("native plan");
    let result = NativeSessionBackend::invocation_local()
        .open(
            test_session_authority_for("execution/two", 3),
            Arc::new(crate::state::TestStateWriterLease::current()),
            &plan,
        )
        .await;
    let Err(error) = result else {
        panic!("cross-execution session grant was accepted");
    };
    assert_eq!(
        error.code(),
        super::runtime::NativeAgentAssemblyErrorCode::AuthorizationFailed
    );
}

#[tokio::test]
async fn direct_llm_agent_executes_a_bound_toolset_before_the_final_model_turn() {
    let request = ordinary_request(AgentExecutionKind::Adhoc);
    let profile = OrdinaryNoToolProfile::validate(&request).expect("agent profile");
    let plan = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("native plan");
    let model_calls = Arc::new(AtomicUsize::new(0));
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let model = FixtureBoundModel {
        model: Arc::new(SequencedLlm {
            responses: Mutex::new(VecDeque::from([
                tool_call_response(),
                LlmResponse::new(Content::new("model").with_text("The answer is 42.")),
            ])),
            calls: Arc::clone(&model_calls),
        }),
        completed: "The answer is 42.".to_owned(),
    };
    let tool: Arc<dyn Tool> = Arc::new(CountingTool {
        calls: Arc::clone(&tool_calls),
    });
    let toolset: Arc<dyn Toolset> = Arc::new(BasicToolset::new("fixture-tools", vec![tool]));
    let assembled =
        assemble_ordinary_native(model, plan, vec![toolset], SensitiveToolCatalog::default())
            .await
            .expect("native assembly");
    let (mut native, _projector, completion) = assembled.start().expect("native start");

    let mut saw_call = false;
    let mut saw_result = false;
    while let Some(event) = native.next_event().await.expect("native event") {
        saw_call |= !event.tool_calls().is_empty();
        saw_result |= !event.tool_results().is_empty();
    }

    assert!(saw_call);
    assert!(saw_result);
    assert_eq!(model_calls.load(Ordering::SeqCst), 2);
    assert_eq!(tool_calls.load(Ordering::SeqCst), 1);
    let completion = completion.select().await.expect("selected completion");
    let _ = completion;
}

#[tokio::test]
async fn sensitive_direct_tool_pauses_before_execution_and_projects_masked_call_identity() {
    let request = ordinary_request(AgentExecutionKind::Adhoc);
    let profile = OrdinaryNoToolProfile::validate(&request).expect("agent profile");
    let plan = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("native plan");
    let model_calls = Arc::new(AtomicUsize::new(0));
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let model = FixtureBoundModel {
        model: Arc::new(SequencedLlm {
            responses: Mutex::new(VecDeque::from([tool_call_response_with(json!({
                "value": 21,
                "api_token": "must-not-be-published"
            }))])),
            calls: Arc::clone(&model_calls),
        }),
        completed: "must not be selected".to_owned(),
    };
    let tool: Arc<dyn Tool> = Arc::new(CountingTool {
        calls: Arc::clone(&tool_calls),
    });
    let toolset: Arc<dyn Toolset> = Arc::new(BasicToolset::new("fixture-tools", vec![tool]));
    let user_id = plan.user_id().to_owned();
    let session_id = plan.session_id().to_owned();
    let sessions = Arc::new(InMemorySessionService::new());
    let injected_sessions: Arc<dyn SessionService> = sessions.clone();
    let mut assembled = assemble_ordinary_native_with_sessions(
        model,
        plan,
        vec![toolset],
        sensitive_catalog(),
        injected_sessions,
    )
    .await
    .expect("native assembly");
    assembled
        .project_start(Utc::now())
        .expect("projected start");
    let (mut native, mut projector, _completion) = assembled.start().expect("native start");

    let mut interrupt = None;
    let mut durable_confirmation_seen = false;
    let mut public_events = Vec::new();
    while let Some(event) = native.next_event().await.expect("native event") {
        let confirmation = event.actions.tool_confirmation.as_ref();
        if confirmation.is_some() {
            assert_confirmation_persisted(&sessions, &user_id, &session_id, &event).await;
            durable_confirmation_seen = true;
        }
        let summary = format!(
            "author={} interrupted={} complete={} calls={} confirmation={} confirmation_id={}",
            event.author,
            event.llm_response.interrupted,
            event.llm_response.turn_complete,
            event.tool_calls().len(),
            confirmation.map_or("none", |value| value.tool_name.as_str()),
            confirmation
                .and_then(|value| value.function_call_id.as_deref())
                .unwrap_or("none"),
        );
        for projected in projector
            .project(&event)
            .unwrap_or_else(|error| panic!("projected event failed ({summary}): {error}"))
        {
            let value: Value = serde_json::from_slice(
                &encode_current_node_event_json(&projected).expect("canonical browser event"),
            )
            .expect("browser event JSON");
            if value["type"] == "agent_hitl_interrupt" {
                interrupt = Some(value.clone());
            }
            public_events.push(value);
        }
    }

    assert_sensitive_interrupt_projection(
        &interrupt.expect("sensitive-tool interrupt"),
        &public_events,
    );
    resolve_persisted_sensitive_decision(&sessions, &user_id, &session_id, &public_events).await;
    assert!(projector.is_paused());
    assert!(durable_confirmation_seen);
    assert_eq!(model_calls.load(Ordering::SeqCst), 1);
    assert_eq!(tool_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn persisted_read_only_sensitive_call_replays_through_native_adk_without_model_replanning() {
    let fixture = pause_read_only_sensitive_call().await;
    let profile = OrdinaryNoToolProfile::validate(&fixture.request).expect("agent profile");
    let decision =
        DirectHitlDecision::from_payload(&approved_resume_payload(&fixture.interrupt_id))
            .expect("approved decision");

    let second_plan = OrdinaryNativeAgentPlan::from_authorized(
        &fixture.request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("resume native plan");
    let provider_calls = Arc::new(AtomicUsize::new(0));
    let captured = Arc::new(Mutex::new(Vec::new()));
    let second_model = FixtureBoundModel {
        model: Arc::new(CapturingFinalLlm {
            requests: Arc::clone(&captured),
            calls: Arc::clone(&provider_calls),
        }),
        completed: "The resumed answer is 42.".to_owned(),
    };
    let second_tool: Arc<dyn Tool> = Arc::new(CountingTool {
        calls: Arc::clone(&fixture.tool_calls),
    });
    let second_toolset: Arc<dyn Toolset> =
        Arc::new(BasicToolset::new("fixture-tools", vec![second_tool]));
    let second_sessions: Arc<dyn SessionService> = fixture.sessions.clone();
    let resumed = assemble_read_only_direct_hitl_resume_with_sessions(
        second_model,
        second_plan,
        vec![second_toolset],
        sensitive_catalog(),
        decision,
        second_sessions,
    )
    .await
    .expect("read-only replay assembly");
    let (mut resumed_run, _projector, completion) = resumed.start().expect("resumed native run");
    let mut saw_approved_result = false;
    while let Some(event) = resumed_run.next_event().await.expect("resumed event") {
        saw_approved_result |= event.actions.tool_confirmation_decision
            == Some(ToolConfirmationDecision::Approve)
            && !event.tool_results().is_empty();
    }

    assert!(saw_approved_result);
    assert_eq!(fixture.tool_calls.load(Ordering::SeqCst), 1);
    assert_eq!(provider_calls.load(Ordering::SeqCst), 1);
    {
        let requests = captured.lock().expect("captured provider requests");
        assert_eq!(requests.len(), 1);
        assert_replay_provider_transcript(&requests[0]);
    }
    completion.select().await.expect("resumed completion");

    let advanced = fixture
        .sessions
        .get(GetRequest {
            app_name: "elitea-agent-v1".to_owned(),
            user_id: fixture.user_id,
            session_id: fixture.session_id,
            num_recent_events: None,
            after: None,
        })
        .await
        .expect("advanced resumed session");
    let replayed =
        DirectHitlDecision::from_payload(&approved_resume_payload(&fixture.interrupt_id))
            .expect("same bounded decision")
            .resolve(advanced.as_ref());
    let Err(replayed) = replayed else {
        panic!("completed decision was replayed again");
    };
    assert_eq!(
        replayed.code(),
        super::direct_hitl::DirectHitlErrorCode::StaleDecision
    );
}

struct PendingReadOnlyReplay {
    request: super::request::AgentExecutionRequest,
    sessions: Arc<InMemorySessionService>,
    user_id: String,
    session_id: String,
    interrupt_id: String,
    tool_calls: Arc<AtomicUsize>,
}

async fn pause_read_only_sensitive_call() -> PendingReadOnlyReplay {
    let request = ordinary_request(AgentExecutionKind::Adhoc);
    let profile = OrdinaryNoToolProfile::validate(&request).expect("agent profile");
    let plan = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("first native plan");
    let user_id = plan.user_id().to_owned();
    let session_id = plan.session_id().to_owned();
    let sessions = Arc::new(InMemorySessionService::new());
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let tool: Arc<dyn Tool> = Arc::new(CountingTool {
        calls: Arc::clone(&tool_calls),
    });
    let toolset: Arc<dyn Toolset> = Arc::new(BasicToolset::new("fixture-tools", vec![tool]));
    let model = FixtureBoundModel {
        model: Arc::new(SequencedLlm {
            responses: Mutex::new(VecDeque::from([tool_call_response()])),
            calls: Arc::new(AtomicUsize::new(0)),
        }),
        completed: "not completed".to_owned(),
    };
    let injected: Arc<dyn SessionService> = sessions.clone();
    let first = assemble_ordinary_native_with_sessions(
        model,
        plan,
        vec![toolset],
        sensitive_catalog(),
        injected,
    )
    .await
    .expect("initial sensitive assembly");
    let (mut run, _projector, _completion) = first.start().expect("initial native run");
    while run
        .next_event()
        .await
        .expect("initial sensitive event")
        .is_some()
    {}
    assert_eq!(tool_calls.load(Ordering::SeqCst), 0);
    let interrupt_id = persisted_interrupt_id(&sessions, &user_id, &session_id).await;
    PendingReadOnlyReplay {
        request,
        sessions,
        user_id,
        session_id,
        interrupt_id,
        tool_calls,
    }
}

async fn persisted_interrupt_id(
    sessions: &InMemorySessionService,
    user_id: &str,
    session_id: &str,
) -> String {
    let stored = sessions
        .get(GetRequest {
            app_name: "elitea-agent-v1".to_owned(),
            user_id: user_id.to_owned(),
            session_id: session_id.to_owned(),
            num_recent_events: None,
            after: None,
        })
        .await
        .expect("persisted pending session");
    let confirmation = stored
        .events()
        .all()
        .into_iter()
        .find(|event| event.actions.tool_confirmation.is_some())
        .expect("persisted confirmation");
    let pending = confirmation
        .actions
        .tool_confirmation
        .as_ref()
        .expect("confirmation request");
    super::direct_hitl::sensitive_call_identity(
        &confirmation.invocation_id,
        pending
            .function_call_id
            .as_deref()
            .expect("function call identity"),
        &pending.tool_name,
        &pending.args,
    )
    .expect("public interrupt identity")
    .0
}

fn approved_resume_payload(interrupt_id: &str) -> super::request::AgentExecutionPayload {
    let mut resume = ordinary_request(AgentExecutionKind::Adhoc);
    resume.payload.should_continue = true;
    resume.payload.hitl_resume = true;
    resume.payload.hitl_action = Some("approve".to_owned());
    resume.payload.hitl_value = Some(String::new());
    resume.payload.hitl_decisions = vec![json!({
        "interrupt_id": interrupt_id,
        "tool_call_id": "call-1",
        "action": "approve",
        "value": "",
    })];
    resume.payload
}

fn assert_replay_provider_transcript(request: &LlmRequest) {
    let approval_messages = request
        .contents
        .iter()
        .flat_map(|content| &content.parts)
        .filter(|part| {
            matches!(
                part,
                Part::Text { text }
                    if text == "The pending tool call was approved. Continue the original request."
            )
        })
        .count();
    let replayed_calls = request
        .contents
        .iter()
        .flat_map(|content| &content.parts)
        .filter(|part| {
            matches!(
                part,
                Part::FunctionCall { name, id: Some(id), args, .. }
                    if name == "double" && id == "call-1" && args == &json!({"value": 21})
            )
        })
        .count();
    let results = request
        .contents
        .iter()
        .flat_map(|content| &content.parts)
        .filter(|part| {
            matches!(
                part,
                Part::FunctionResponse { function_response, id: Some(id), .. }
                    if function_response.name == "double"
                        && id == "call-1"
                        && function_response.response == json!({"value": 42})
            )
        })
        .count();
    assert_eq!(approval_messages, 1);
    assert_eq!(replayed_calls, 2);
    assert_eq!(results, 1);
}

async fn resolve_persisted_sensitive_decision(
    sessions: &InMemorySessionService,
    user_id: &str,
    session_id: &str,
    public_events: &[Value],
) {
    let interrupt_id = public_events
        .iter()
        .find(|event| event["type"] == "agent_hitl_interrupt")
        .and_then(|event| event["response_metadata"]["hitl_interrupts"][0]["interrupt_id"].as_str())
        .expect("public interrupt identity");
    let mut resume = ordinary_request(AgentExecutionKind::Adhoc);
    resume.payload.should_continue = true;
    resume.payload.hitl_resume = true;
    resume.payload.hitl_action = Some("approve".to_owned());
    resume.payload.hitl_value = Some(String::new());
    resume.payload.hitl_decisions = vec![json!({
        "interrupt_id": interrupt_id,
        "tool_call_id": "call-1",
        "action": "approve",
        "value": "",
    })];
    let stored = sessions
        .get(GetRequest {
            app_name: "elitea-agent-v1".to_owned(),
            user_id: user_id.to_owned(),
            session_id: session_id.to_owned(),
            num_recent_events: None,
            after: None,
        })
        .await
        .expect("persisted pending session");
    let resolved = DirectHitlDecision::from_payload(&resume.payload)
        .expect("authorized continuation shape")
        .resolve(stored.as_ref())
        .expect("exact persisted call");
    assert_eq!(resolved.call_id(), "call-1");
    assert_eq!(resolved.arguments()["api_token"], "must-not-be-published");
}

async fn assert_confirmation_persisted(
    sessions: &InMemorySessionService,
    user_id: &str,
    session_id: &str,
    event: &adk_rust::Event,
) {
    let stored = sessions
        .get(GetRequest {
            app_name: "elitea-agent-v1".to_owned(),
            user_id: user_id.to_owned(),
            session_id: session_id.to_owned(),
            num_recent_events: None,
            after: None,
        })
        .await
        .expect("confirmation event persisted before Runner yield");
    let stored_events = stored.events().all();
    assert_eq!(
        stored_events.last().map(|stored| stored.id.as_str()),
        Some(event.id.as_str())
    );
    assert!(stored_events.iter().any(|stored| {
        stored
            .tool_calls()
            .iter()
            .any(|call| call.call_id == Some("call-1"))
    }));
}

fn assert_sensitive_interrupt_projection(interrupt: &Value, public_events: &[Value]) {
    let pending = &interrupt["response_metadata"]["hitl_interrupts"][0];
    assert_eq!(pending["guardrail_type"], "sensitive_tool");
    assert_eq!(pending["tool_call_id"], "call-1");
    assert_eq!(pending["toolkit_type"], "fixture");
    assert_eq!(pending["toolkit_name"], "Fixture Tools");
    assert_eq!(pending["tool_args"]["value"], 21);
    assert_eq!(pending["tool_args"]["api_token"], "***");
    assert!(pending.get("tool_args_raw").is_none());
    let encoded_public_events = serde_json::to_string(public_events).expect("public event JSON");
    assert!(!encoded_public_events.contains("must-not-be-published"));
    let tool_start = public_events
        .iter()
        .find(|event| event["type"] == "agent_tool_start")
        .expect("sensitive tool start");
    assert_eq!(
        tool_start["response_metadata"]["tool_inputs"]["api_token"],
        "***"
    );
    assert!(
        pending["interrupt_id"]
            .as_str()
            .is_some_and(|value| value.starts_with("hitl_e1:"))
    );
    assert!(
        pending["call_digest"]
            .as_str()
            .is_some_and(|value| value.starts_with("sha256:"))
    );
}

#[test]
fn pseudonymous_session_identity_is_stable_per_thread_and_separated_between_threads() {
    let request = ordinary_request(AgentExecutionKind::Adhoc);
    let profile = OrdinaryNoToolProfile::validate(&request).expect("ordinary profile");
    let first = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("first plan");
    let same = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("same plan");
    assert_eq!(first.session_id(), same.session_id());
    assert!(!first.session_id().contains("tenant-1"));
    assert!(!first.session_id().contains("user:42"));

    let mut other_request = ordinary_request(AgentExecutionKind::Adhoc);
    other_request.payload.thread_id = Some("thread-2".to_owned());
    let other_profile =
        OrdinaryNoToolProfile::validate(&other_request).expect("other ordinary profile");
    let other = OrdinaryNativeAgentPlan::from_authorized(
        &other_request,
        &other_profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("other plan");
    assert_ne!(first.session_id(), other.session_id());
}

#[test]
fn session_definition_lineage_is_request_independent_and_application_version_scoped() {
    let mut first_request = ordinary_request(AgentExecutionKind::Application);
    let first_profile =
        OrdinaryNoToolProfile::validate(&first_request).expect("first application profile");
    let first = OrdinaryNativeAgentPlan::from_authorized(
        &first_request,
        &first_profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("first application plan");

    first_request.binding.request_content_digest = [9; 32];
    first_request.payload.user_input = UserInput::Text("continued input".to_owned());
    first_request.payload.chat_history = current_text_history();
    let continued_profile =
        OrdinaryNoToolProfile::validate(&first_request).expect("continued application profile");
    let continued = OrdinaryNativeAgentPlan::from_authorized(
        &first_request,
        &continued_profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("continued application plan");
    assert_eq!(first.definition_digest(), continued.definition_digest());

    first_request
        .payload
        .application
        .insert("version_id".to_owned(), json!(23));
    let changed_profile =
        OrdinaryNoToolProfile::validate(&first_request).expect("changed application profile");
    let changed = OrdinaryNativeAgentPlan::from_authorized(
        &first_request,
        &changed_profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("changed application plan");
    assert_ne!(first.definition_digest(), changed.definition_digest());

    let mut adhoc_request = ordinary_request(AgentExecutionKind::Adhoc);
    let adhoc_profile =
        OrdinaryNoToolProfile::validate(&adhoc_request).expect("first ad-hoc profile");
    let adhoc = OrdinaryNativeAgentPlan::from_authorized(
        &adhoc_request,
        &adhoc_profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("first ad-hoc plan");
    adhoc_request.binding.request_content_digest = [7; 32];
    adhoc_request.payload.user_input = UserInput::Text("next ad-hoc turn".to_owned());
    adhoc_request.payload.llm["kwargs"]["model"] = json!("another-model");
    let next_adhoc_profile =
        OrdinaryNoToolProfile::validate(&adhoc_request).expect("next ad-hoc profile");
    let next_adhoc = OrdinaryNativeAgentPlan::from_authorized(
        &adhoc_request,
        &next_adhoc_profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("next ad-hoc plan");
    assert_eq!(adhoc.definition_digest(), next_adhoc.definition_digest());
    assert_ne!(first.definition_digest(), adhoc.definition_digest());
}

#[test]
fn invalid_completed_content_never_becomes_a_browser_terminal() {
    let Err(error) =
        super::events::CompletedAgentBrowserOutput::ordinary(String::new(), "thread-1".to_owned())
    else {
        panic!("empty model result was accepted");
    };
    assert_eq!(error.code(), AgentEventProjectionErrorCode::InvalidOutput);
}
