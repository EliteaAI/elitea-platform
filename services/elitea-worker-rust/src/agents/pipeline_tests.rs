use serde_json::{Value, json};

use super::assembly_tests::ordinary_request;
use super::request::AgentExecutionKind;
use super::runtime::{AuthorizedNativeAssembly, NativeAgentAssemblyErrorCode};
use super::session::AuthorizedNativeCommandBinding;
use crate::protocol::control::test_runtime_context_authority;

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
