use std::sync::Arc;

use adk_rust::graph::{Checkpointer, MemoryCheckpointer};
use adk_rust::session::{InMemorySessionService, SessionService};
use adk_rust::tool::{BasicToolset, SimpleToolContext};
use adk_rust::{Tool, ToolContext, Toolset};
use async_trait::async_trait;
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};

use super::assembly_tests::ordinary_request;
use super::events::pipeline_hitl_event_binding;
use super::pipeline::{PipelineExecutionProfile, PipelineNativeAgentAssembler, StrictNodeToolset};
use super::request::AgentExecutionKind;
use super::runtime::{
    AuthorizedNativeAssembly, NativeAgentAssembler, NativeAgentAssemblyErrorCode,
    NativeAgentCompletionSelector,
};
use super::session::{AuthorizedNativeCommandBinding, OrdinaryNativeAgentPlan};
use crate::protocol::control::test_runtime_context_authority;
use crate::protocol::elitea::runtime::v1::NodeEventV1;
use crate::protocol::node_event::encode_current_node_event_json;
use crate::toolkits::ToolAdmissionPolicy;

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

const STATE_MODIFIER_PIPELINE: &str = r#"
state:
  input:
    type: str
  prefix:
    type: str
    value: Hello
  final_text:
    type: str
entry_point: transform
nodes:
  - id: transform
    type: state_modifier
    template: "{{ prefix }}, {{ input }}"
    input: [prefix, input]
    output: [final_text]
    transition: END
"#;

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

fn llm_pipeline_request(
    toolkit_alias: &str,
    configured_tools: &[&str],
    node_tools: &[&str],
) -> super::request::AgentExecutionRequest {
    let mut request = pipeline_request();
    let tool_names = node_tools
        .iter()
        .map(|name| format!("{name:?}"))
        .collect::<Vec<_>>()
        .join(", ");
    let definition = format!(
        "state:\n  answer: str\n  messages: list\nentry_point: answer\nnodes:\n  - id: answer\n    type: llm\n    output: [answer, messages]\n    tool_names:\n      {toolkit_alias}: [{tool_names}]\n    transition: END\n"
    );
    let version = request
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture");
    version.insert("instructions".to_owned(), json!(definition));
    version.insert(
        "tools".to_owned(),
        json!([{
            "id": 91,
            "type": "gitlab_org",
            "toolkit_name": "release_repository",
            "settings": {
                "gitlab_configuration": {
                    "url": "https://gitlab.example.invalid",
                    "private_token": "claim-materialized-token"
                },
                "repositories": "group/project",
                "branch": "main",
                "selected_tools": configured_tools
            }
        }]),
    );
    request
}

fn toolkit_pipeline_request(
    toolkit_alias: &str,
    configured_tools: &[&str],
    node_tool: &str,
) -> super::request::AgentExecutionRequest {
    let mut request = pipeline_request();
    let definition = format!(
        "state:\n  records: dict\n  messages: list\nentry_point: direct\nnodes:\n  - id: direct\n    type: toolkit\n    toolkit_name: {toolkit_alias:?}\n    tool: {node_tool:?}\n    input_mapping:\n      repository: {{type: fixed, value: group/project}}\n    output: [records, messages]\n    transition: END\n"
    );
    let version = request
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture");
    version.insert("instructions".to_owned(), json!(definition));
    version.insert(
        "tools".to_owned(),
        json!([{
            "id": 91,
            "type": "gitlab_org",
            "toolkit_name": "release_repository",
            "settings": {
                "gitlab_configuration": {
                    "url": "https://gitlab.example.invalid",
                    "private_token": "claim-materialized-token"
                },
                "repositories": "group/project",
                "branch": "main",
                "selected_tools": configured_tools
            }
        }]),
    );
    request
}

fn runtime_tool_policy(value: &Value) -> ToolAdmissionPolicy {
    let runtime = value.as_object().expect("runtime policy object");
    ToolAdmissionPolicy::from_runtime_config(runtime).expect("runtime tool policy")
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
fn malformed_pipeline_tools_fail_and_llm_yaml_is_admitted_without_authority() {
    let mut with_tools = pipeline_request();
    with_tools
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture")
        .insert("tools".to_owned(), json!([{"type": "github"}]));
    let error = admission_error(authorized(&with_tools).admit_pipeline());
    assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);

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
    let admitted = authorized(&llm_node)
        .admit_pipeline()
        .expect("authority-free LLM definition admission");
    assert_eq!(admitted.profile().definition().node_count(), 1);
}

#[test]
fn llm_tool_scope_is_exact_and_sensitive_or_blocked_authority_fails_closed() {
    let allowed = llm_pipeline_request(
        "release_repository",
        &["list_branches_in_repo"],
        &["list_branches_in_repo"],
    );
    let empty_policy = runtime_tool_policy(&json!({}));
    authorized(&allowed)
        .admit_pipeline_with_policy(&empty_policy)
        .expect("exact frozen LLM tool scope");

    let unknown_alias = llm_pipeline_request(
        "other_repository",
        &["list_branches_in_repo"],
        &["list_branches_in_repo"],
    );
    let error =
        admission_error(authorized(&unknown_alias).admit_pipeline_with_policy(&empty_policy));
    assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);

    let outside_selection = llm_pipeline_request(
        "release_repository",
        &["get_issues"],
        &["list_branches_in_repo"],
    );
    let error =
        admission_error(authorized(&outside_selection).admit_pipeline_with_policy(&empty_policy));
    assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);

    for policy in [
        runtime_tool_policy(&json!({
            "toolkit_security": {"blocked_toolkits": ["gitlab_org"]}
        })),
        runtime_tool_policy(&json!({
            "toolkit_security": {
                "blocked_tools": {"gitlab_org": ["list_branches_in_repo"]}
            }
        })),
        runtime_tool_policy(&json!({
            "toolkit_security": {
                "sensitive_tools": {"gitlab_org": ["list_branches_in_repo"]}
            }
        })),
    ] {
        let error = admission_error(authorized(&allowed).admit_pipeline_with_policy(&policy));
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
    }
}

#[test]
fn toolkit_node_scope_is_exact_and_sensitive_authority_fails_before_materialization() {
    let allowed = toolkit_pipeline_request("release_repository", &["get_issues"], "get_issues");
    let empty_policy = runtime_tool_policy(&json!({}));
    authorized(&allowed)
        .admit_pipeline_with_policy(&empty_policy)
        .expect("exact frozen direct Toolkit scope");

    for invalid in [
        toolkit_pipeline_request("other_repository", &["get_issues"], "get_issues"),
        toolkit_pipeline_request(
            "release_repository",
            &["list_branches_in_repo"],
            "get_issues",
        ),
    ] {
        let error = admission_error(authorized(&invalid).admit_pipeline_with_policy(&empty_policy));
        assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);
    }

    for policy in [
        runtime_tool_policy(&json!({
            "toolkit_security": {"blocked_toolkits": ["gitlab_org"]}
        })),
        runtime_tool_policy(&json!({
            "toolkit_security": {"blocked_tools": {"gitlab_org": ["get_issues"]}}
        })),
        runtime_tool_policy(&json!({
            "toolkit_security": {"sensitive_tools": {"gitlab_org": ["get_issues"]}}
        })),
    ] {
        let error = admission_error(authorized(&allowed).admit_pipeline_with_policy(&policy));
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
    }
}

#[tokio::test]
async fn toolkit_node_materializes_read_only_action_but_rejects_remote_effect() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let assembler = PipelineNativeAgentAssembler::with_state(
        Arc::clone(&sessions),
        Arc::new(MemoryCheckpointer::new()),
    );
    let read = toolkit_pipeline_request("release_repository", &["get_issues"], "get_issues");
    assembler
        .assemble(authorized(&read))
        .await
        .expect("read-only direct Toolkit assembly");

    let effect =
        toolkit_pipeline_request("release_repository", &["create_branch"], "create_branch");
    let result = assembler.assemble(authorized(&effect)).await;
    let Err(error) = result else {
        panic!("effectful direct Toolkit node was assembled");
    };
    assert_eq!(
        error.code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

struct NamedReadTool(&'static str);

#[async_trait]
impl Tool for NamedReadTool {
    fn name(&self) -> &str {
        self.0
    }

    fn description(&self) -> &'static str {
        "pipeline tool selection fixture"
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        _context: Arc<dyn ToolContext>,
        _arguments: Value,
    ) -> adk_rust::Result<Value> {
        Ok(json!({"ok": true}))
    }
}

#[tokio::test]
async fn node_toolset_exposes_only_exact_selected_names_in_declared_order() {
    let available: Arc<dyn Toolset> = Arc::new(BasicToolset::new(
        "release_repository",
        vec![
            Arc::new(NamedReadTool("get_issues")),
            Arc::new(NamedReadTool("list_branches_in_repo")),
            Arc::new(NamedReadTool("get_issue")),
        ],
    ));
    let context = Arc::new(SimpleToolContext::new("pipeline-toolset-test"));
    let selected = StrictNodeToolset::new(
        "release_repository",
        available,
        &["get_issue".to_owned(), "get_issues".to_owned()],
    );
    let tools = selected
        .tools(context.clone())
        .await
        .expect("exact selected toolset");
    assert_eq!(
        tools.iter().map(|tool| tool.name()).collect::<Vec<_>>(),
        ["get_issue", "get_issues"]
    );

    let missing = StrictNodeToolset::new(
        "release_repository",
        Arc::new(BasicToolset::new(
            "release_repository",
            vec![Arc::new(NamedReadTool("get_issues"))],
        )),
        &["not_available".to_owned()],
    );
    assert!(missing.tools(context).await.is_err());
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

#[tokio::test]
async fn state_modifier_result_survives_common_runner_projection_and_eos_completion() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let pipeline_assembler = PipelineNativeAgentAssembler::with_state(
        Arc::clone(&sessions),
        Arc::new(MemoryCheckpointer::new()),
    );
    let mut request = pipeline_request();
    request
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("pipeline version")
        .insert("instructions".to_owned(), json!(STATE_MODIFIER_PIPELINE));

    let mut invocation = pipeline_assembler
        .assemble(authorized(&request))
        .await
        .expect("state modifier pipeline assembly");
    invocation
        .project_start(timestamp(0))
        .expect("browser start");
    let (mut run, mut projector, completion) = invocation.start().expect("pipeline start");
    let result = run
        .next_event()
        .await
        .expect("pipeline result read")
        .expect("pipeline result event");
    let progress = projector
        .project(&result)
        .expect("pipeline result projection")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(progress.len(), 4);
    assert_eq!(progress[1]["content"], "Hello, current");
    assert!(run.next_event().await.expect("pipeline EOS").is_none());

    let selected = completion.select().await.expect("completion selection");
    let completed = projector
        .finish_after_eos(selected, timestamp(1))
        .expect("browser completion")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 3);
    assert!(
        completed
            .iter()
            .all(|event| event["content"] == "Hello, current")
    );
}
