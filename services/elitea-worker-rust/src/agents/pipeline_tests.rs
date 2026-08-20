use std::sync::Arc;

use adk_rust::graph::{Checkpointer, MemoryCheckpointer};
use adk_rust::session::{InMemorySessionService, SessionService};
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};

use super::assembly_tests::ordinary_request;
use super::events::pipeline_hitl_event_binding;
use super::pipeline::{PipelineExecutionProfile, PipelineNativeAgentAssembler};
use super::request::AgentExecutionKind;
use super::runtime::{
    AuthorizedNativeAssembly, NativeAgentAssembler, NativeAgentAssemblyErrorCode,
    NativeAgentCompletionSelector,
};
use super::session::{AuthorizedNativeCommandBinding, OrdinaryNativeAgentPlan};
use crate::protocol::control::test_runtime_context_authority;
use crate::protocol::elitea::runtime::v1::NodeEventV1;
use crate::protocol::node_event::encode_current_node_event_json;

const PIPELINE: &str = r"
state:
  answer: string
entry_point: review
nodes:
  - id: review
    type: hitl
    user_message:
      type: fixed
      value: Review the draft.
    routes:
      approve: END
      reject: END
";

fn pipeline_request() -> super::request::AgentExecutionRequest {
    let mut request = ordinary_request(AgentExecutionKind::Application);
    let version = request
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture");
    version.insert("agent_type".to_owned(), json!("pipeline"));
    version.insert("instructions".to_owned(), json!(PIPELINE));
    request
}

fn authorized(request: &super::request::AgentExecutionRequest) -> AuthorizedNativeAssembly<'_> {
    AuthorizedNativeAssembly::new(
        request,
        test_runtime_context_authority(),
        AuthorizedNativeCommandBinding::fixture(),
    )
}

fn admission_error(
    result: Result<
        super::runtime::AdmittedPipelineNativeAssembly<'_>,
        super::runtime::NativeAgentAssemblyError,
    >,
) -> super::runtime::NativeAgentAssemblyError {
    match result {
        Ok(_) => panic!("invalid pipeline admission succeeded"),
        Err(error) => error,
    }
}

fn timestamp(second: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 20, 12, 0, second)
        .single()
        .expect("fixture timestamp")
}

fn current(event: &NodeEventV1) -> Value {
    serde_json::from_slice(
        &encode_current_node_event_json(event).expect("valid projected browser event"),
    )
    .expect("projected event JSON")
}

fn private_pipeline_session_id(request: &super::request::AgentExecutionRequest) -> String {
    let profile = PipelineExecutionProfile::validate(request, false).expect("pipeline profile");
    OrdinaryNativeAgentPlan::from_authorized_pipeline(
        request,
        profile.shell(),
        &AuthorizedNativeCommandBinding::fixture(),
        false,
    )
    .expect("pipeline plan")
    .session_id()
    .to_owned()
}

fn resume_request(interrupt_id: &str) -> super::request::AgentExecutionRequest {
    let mut request = pipeline_request();
    request.payload.should_continue = true;
    request.payload.hitl_resume = true;
    request.payload.hitl_action = Some("approve".to_owned());
    request.payload.hitl_value = Some(String::new());
    request.payload.hitl_decisions = vec![json!({
        "interrupt_id": interrupt_id,
        "tool_call_id": "",
        "action": "approve",
        "value": ""
    })];
    request.payload.user_input = super::request::UserInput::Text(
        "this transport marker must not become resumed graph input".to_owned(),
    );
    request
}

#[test]
fn authorized_pipeline_admission_is_distinct_from_direct_agent_admission() {
    let pipeline = pipeline_request();
    let admitted = authorized(&pipeline)
        .admit_pipeline()
        .expect("stored pipeline admission");
    assert!(!admitted.is_resume());
    assert_eq!(admitted.profile().definition().entry_point(), "review");
    assert_eq!(admitted.profile().definition().node_count(), 1);

    let direct = ordinary_request(AgentExecutionKind::Application);
    let error = admission_error(authorized(&direct).admit_pipeline());
    assert_eq!(
        error.code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

#[test]
fn pipeline_hitl_resume_uses_the_graph_decision_contract_not_tool_confirmation() {
    let mut pipeline = pipeline_request();
    pipeline.payload.should_continue = true;
    pipeline.payload.hitl_resume = true;
    pipeline.payload.hitl_action = Some("approve".to_owned());
    pipeline.payload.hitl_value = Some(String::new());
    pipeline.payload.hitl_decisions = vec![json!({
        "interrupt_id": "hitl_g1:checkpoint-bound",
        "tool_call_id": "",
        "action": "approve",
        "value": ""
    })];
    let admitted = authorized(&pipeline)
        .admit_pipeline()
        .expect("pipeline HITL admission");
    assert!(admitted.is_resume());

    pipeline.payload.hitl_decisions[0]["tool_call_id"] = json!("tool-call-1");
    let error = admission_error(authorized(&pipeline).admit_pipeline());
    assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);
}

#[test]
fn pipeline_tools_and_unimplemented_nodes_fail_before_runtime_construction() {
    let mut with_tools = pipeline_request();
    with_tools
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture")
        .insert("tools".to_owned(), json!([{"type": "github"}]));
    let error = admission_error(authorized(&with_tools).admit_pipeline());
    assert_eq!(
        error.code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );

    let mut llm_node = pipeline_request();
    llm_node
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture")
        .insert(
            "instructions".to_owned(),
            json!("entry_point: draft\nnodes:\n  - id: draft\n    type: llm\n"),
        );
    let error = admission_error(authorized(&llm_node).admit_pipeline());
    assert_eq!(
        error.code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

#[tokio::test]
async fn admitted_pipeline_uses_common_runner_and_resumes_exact_private_checkpoint() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let pipeline_assembler =
        PipelineNativeAgentAssembler::with_state(Arc::clone(&sessions), checkpointer.clone());
    let request = pipeline_request();
    let private_thread = private_pipeline_session_id(&request);
    assert_ne!(private_thread, "thread-1");

    let mut fresh_invocation = pipeline_assembler
        .assemble(authorized(&request))
        .await
        .expect("fresh pipeline assembly");
    assert_eq!(
        fresh_invocation
            .project_start(timestamp(0))
            .expect("start")
            .len(),
        1
    );
    let (mut run, mut projector, completion) = fresh_invocation.start().expect("pipeline start");
    let interrupt = run
        .next_event()
        .await
        .expect("pipeline event")
        .expect("HITL interrupt");
    let binding = pipeline_hitl_event_binding(&interrupt, "elitea-agent", &private_thread)
        .expect("private checkpoint binding");
    let interrupt_id = binding.interrupt_id().to_owned();
    let projected = projector
        .project(&interrupt)
        .expect("public interrupt projection")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(projected.len(), 1);
    assert_eq!(projected[0]["response_metadata"]["thread_id"], "thread-1");
    assert_eq!(
        projected[0]["response_metadata"]["hitl_interrupt"]["interrupt_id"],
        interrupt_id
    );
    assert!(!projected[0].to_string().contains(&private_thread));
    assert!(projector.is_paused());
    assert!(run.next_event().await.expect("paused EOS").is_none());
    drop(completion);

    let resume = resume_request(&interrupt_id);
    let mut resumed_invocation = pipeline_assembler
        .assemble(authorized(&resume))
        .await
        .expect("checkpoint-bound resume assembly");
    resumed_invocation
        .project_start(timestamp(1))
        .expect("resume browser start");
    let (mut run, mut projector, completion) = resumed_invocation.start().expect("resume start");
    let completed = run
        .next_event()
        .await
        .expect("completion event")
        .expect("pipeline completion marker");
    let projected_completion = projector
        .project(&completed)
        .expect("internal completion projection");
    assert!(
        projected_completion.is_empty(),
        "unexpected completion event {} projected {} browser events",
        completed.id,
        projected_completion.len()
    );
    assert!(run.next_event().await.expect("completed EOS").is_none());
    let browser_completion = completion.select().await.expect("completion selection");
    let final_events = projector
        .finish_after_eos(browser_completion, timestamp(2))
        .expect("terminal browser events")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(final_events.len(), 3);
    assert_eq!(final_events[0]["type"], "pipeline_finish");
    assert_eq!(final_events[0]["content"], "Pipeline completed.");
    assert!(
        final_events
            .iter()
            .all(|event| !event.to_string().contains(&private_thread))
    );

    let checkpoint = checkpointer
        .load(&private_thread)
        .await
        .expect("checkpoint read")
        .expect("terminal checkpoint");
    assert!(
        !serde_json::to_string(&checkpoint.state)
            .expect("checkpoint JSON")
            .contains("pipeline-resume")
    );
    let replay = pipeline_assembler.assemble(authorized(&resume)).await;
    let Err(replay) = replay else {
        panic!("completed interrupt replay was admitted");
    };
    assert_eq!(replay.code(), NativeAgentAssemblyErrorCode::InvalidInput);
}
