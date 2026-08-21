use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use adk_rust::graph::{Checkpointer, MemoryCheckpointer};
use adk_rust::session::{GetRequest, InMemorySessionService, SessionService};
use adk_rust::tool::{BasicToolset, SimpleToolContext};
use adk_rust::{Tool, ToolContext, Toolset};
use async_trait::async_trait;
use bytes::Bytes;
use chrono::{TimeZone, Utc};
use http::{Request, Response, StatusCode, Version};
use http_body_util::Full;
use serde_json::{Value, json};
use tonic::body::Body;

use super::assembly_tests::ordinary_request;
use super::events::{
    pipeline_application_event_binding, pipeline_hitl_event_binding, pipeline_tool_event_binding,
};
use super::pipeline::{PipelineExecutionProfile, PipelineNativeAgentAssembler, StrictNodeToolset};
use super::request::AgentExecutionKind;
use super::runtime::{
    AssembledNativeAgentInvocation, AuthorizedNativeAssembly, NativeAgentAssembler,
    NativeAgentAssemblyErrorCode, NativeAgentCompletionSelector,
};
use super::session::{
    AuthorizedNativeCommandBinding, OrdinaryNativeAgentPlan, PipelineAgentCompletion,
};
use crate::protocol::control::test_runtime_context_authority;
use crate::protocol::elitea::runtime::v1::NodeEventV1;
use crate::protocol::node_event::encode_current_node_event_json;
use crate::toolkits::{
    McpConnector, McpMaterializationError, RemoteMcpConfig, ToolAdmissionPolicy,
};
use crate::transport::model_facade::ModelFacade;
use crate::transport::model_gateway::{
    CapturedModelRequests, TestModelGatewayOutcome, test_model_gateway_client,
    test_model_gateway_config, test_model_gateway_response,
};
use crate::transport::platform_client::PlatformClient;
use crate::transport::runtime_context::{
    RuntimeContextClient, RuntimeContextConfig, RuntimeContextRpc, RuntimeContextTransportError,
};

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

const PRINTER_PIPELINE: &str = r#"
state:
  answer:
    type: str
    value: Draft ready
  messages: list
entry_point: show
nodes:
  - id: show
    type: printer
    input_mapping:
      printer: {type: variable, value: answer}
    final_message: Continue when ready.
    transition: capture
  - id: capture
    type: state_modifier
    template: "{{ input }}"
    input: [input]
    output: [answer]
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

fn printer_pipeline_request(
    input: &str,
    should_continue: bool,
) -> super::request::AgentExecutionRequest {
    let mut request = pipeline_request();
    request.payload.user_input = super::request::UserInput::Text(input.to_owned());
    request.payload.should_continue = should_continue;
    request.payload.hitl_resume = false;
    let version = request
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture");
    version.insert("instructions".to_owned(), json!(PRINTER_PIPELINE));
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

fn mcp_pipeline_request(
    toolkit_alias: &str,
    selected_tools: &[&str],
    node_tool: &str,
) -> super::request::AgentExecutionRequest {
    let mut request = pipeline_request();
    let definition = format!(
        "state:\n  records: dict\n  messages: list\nentry_point: direct\nnodes:\n  - id: direct\n    type: mcp\n    toolkit_name: {toolkit_alias:?}\n    tool: {node_tool:?}\n    input_mapping:\n      release: {{type: fixed, value: '1.2'}}\n    output: [records, messages]\n    structured_output: true\n    transition: END\n"
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
            "id": 92,
            "type": "mcp",
            "toolkit_name": "release intelligence",
            "settings": {
                "url": "https://mcp.example.invalid/v1/mcp",
                "headers": null,
                "client_id": null,
                "client_secret": null,
                "scopes": null,
                "timeout": 30,
                "selected_tools": selected_tools,
                "enable_caching": true,
                "cache_ttl": 300,
                "ssl_verify": true
            }
        }]),
    );
    request
}

fn llm_mcp_pipeline_request(
    toolkit_alias: &str,
    selected_tools: &[&str],
    node_tools: &[&str],
) -> super::request::AgentExecutionRequest {
    let mut request = mcp_pipeline_request(toolkit_alias, selected_tools, "lookup_release");
    let tool_names = node_tools
        .iter()
        .map(|name| format!("{name:?}"))
        .collect::<Vec<_>>()
        .join(", ");
    let definition = format!(
        "state:\n  answer: str\n  messages: list\nentry_point: answer\nnodes:\n  - id: answer\n    type: llm\n    output: [answer, messages]\n    tool_names:\n      {toolkit_alias}: [{tool_names}]\n    transition: END\n"
    );
    request
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture")
        .insert("instructions".to_owned(), json!(definition));
    request
}

fn agent_pipeline_request(
    alias: &str,
    child_agent_type: &str,
) -> super::request::AgentExecutionRequest {
    let mut request = pipeline_request();
    let definition = format!(
        "state:\n  answer: str\n  messages: list\nentry_point: delegate\nnodes:\n  - id: delegate\n    type: agent\n    tool: {alias:?}\n    input_mapping:\n      task: {{type: fixed, value: 'Summarize the release'}}\n    output: [answer, messages]\n    transition: END\n"
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
            "id": 44,
            "type": "application",
            "name": "release-agent",
            "description": "Summarizes one release.",
            "author_id": 11,
            "settings": {"application_id": 3, "application_version_id": 4},
            "meta": {},
            "created_at": "2026-08-21T10:00:00Z",
            "toolkit_name": "release-agent",
            "author": null,
            "agent_type": child_agent_type,
            "online": null,
            "icon_meta": null,
            "variables": [],
            "is_pinned": false,
            "indexes_count": null
        }]),
    );
    request
}

struct PipelineRuntimeContextFixture {
    responses: Mutex<VecDeque<Response<Body>>>,
    calls: Arc<AtomicUsize>,
    paths: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl RuntimeContextRpc for PipelineRuntimeContextFixture {
    async fn post(
        &self,
        request: Request<Body>,
    ) -> Result<Response<Body>, RuntimeContextTransportError> {
        self.calls.fetch_add(1, Ordering::AcqRel);
        self.paths
            .lock()
            .map_err(|_| RuntimeContextTransportError::Unavailable)?
            .push(request.uri().path().to_owned());
        self.responses
            .lock()
            .map_err(|_| RuntimeContextTransportError::Unavailable)?
            .pop_front()
            .ok_or(RuntimeContextTransportError::Unavailable)
    }
}

fn runtime_response(value: &Value) -> Response<Body> {
    let raw = value.to_string();
    Response::builder()
        .status(StatusCode::OK)
        .version(Version::HTTP_2)
        .header("content-type", "application/json")
        .header("cache-control", "private, no-cache, no-store")
        .header("pragma", "no-cache")
        .header("content-length", raw.len())
        .body(Body::new(Full::new(Bytes::from(raw))))
        .expect("runtime-context fixture response")
}

type PipelineChildRuntime = (
    Arc<PlatformClient>,
    Arc<ModelFacade>,
    Arc<AtomicUsize>,
    Arc<Mutex<Vec<String>>>,
);

fn pipeline_child_runtime() -> PipelineChildRuntime {
    pipeline_runtime(
        &json!({
            "agent_type": "pipeline",
            "instructions": "state:\n  input: str\n  messages: list\n  answer: str\nentry_point: answer\nnodes:\n  - id: answer\n    type: state_modifier\n    template: 'Child: {{ input }}'\n    input: [input]\n    output: [answer]\n    transition: END\n",
            "meta": {},
            "variables": [],
            "tools": [],
            "llm_settings": null
        }),
        Vec::new(),
    )
}

fn direct_agent_pipeline_runtime() -> PipelineChildRuntime {
    pipeline_runtime(
        &json!({
            "agent_type": "agent",
            "instructions": "Return the delegated release summary.",
            "meta": {},
            "variables": [],
            "tools": [],
            "llm_settings": {
                "model_name": "child-model",
                "model_project_id": 23,
                "max_tokens": 2048,
                "reasoning_effort": null,
                "temperature": 0.2,
                "openai_compatible": true
            }
        }),
        vec![TestModelGatewayOutcome::Response(pipeline_text_response(
            "direct child summary",
        ))],
    )
}

fn sensitive_direct_agent_pipeline_runtime() -> PipelineChildRuntime {
    pipeline_runtime_cycles(
        &json!({
            "agent_type": "agent",
            "instructions": "Read the release evidence and summarize it.",
            "meta": {},
            "variables": [],
            "tools": [{
                "id": 92,
                "type": "mcp",
                "toolkit_name": "release intelligence",
                "settings": {
                    "url": "https://mcp.example.invalid/v1/mcp",
                    "headers": null,
                    "client_id": null,
                    "client_secret": null,
                    "scopes": null,
                    "timeout": 30,
                    "selected_tools": ["lookup_release"],
                    "enable_caching": true,
                    "cache_ttl": 300,
                    "ssl_verify": true
                }
            }],
            "llm_settings": {
                "model_name": "child-model",
                "model_project_id": 23,
                "max_tokens": 2048,
                "reasoning_effort": null,
                "temperature": 0.2,
                "openai_compatible": true
            }
        }),
        vec![
            TestModelGatewayOutcome::Response(pipeline_mcp_tool_call_response()),
            TestModelGatewayOutcome::Response(pipeline_text_response("child resumed summary")),
        ],
        2,
    )
}

fn pipeline_runtime(
    version_details: &Value,
    outcomes: Vec<TestModelGatewayOutcome>,
) -> PipelineChildRuntime {
    pipeline_runtime_cycles(version_details, outcomes, 1)
}

fn pipeline_runtime_cycles(
    version_details: &Value,
    outcomes: Vec<TestModelGatewayOutcome>,
    cycles: usize,
) -> PipelineChildRuntime {
    let calls = Arc::new(AtomicUsize::new(0));
    let paths = Arc::new(Mutex::new(Vec::new()));
    let responses = (0..cycles)
        .flat_map(|_| {
            [
                runtime_response(&json!({
                    "schema_version": "elitea.runtime.elitea-client-token.v1",
                    "project_id": 17,
                    "token": "ephemeral-pipeline-token"
                })),
                runtime_response(&json!({
                    "schema_version": "elitea.runtime.application-version.v1",
                    "project_id": 17,
                    "application_id": 3,
                    "version_id": 4,
                    "version_details": version_details
                })),
            ]
        })
        .collect::<VecDeque<_>>();
    pipeline_runtime_from_responses(responses, outcomes, calls, paths)
}

fn pipeline_runtime_from_responses(
    responses: VecDeque<Response<Body>>,
    outcomes: Vec<TestModelGatewayOutcome>,
    calls: Arc<AtomicUsize>,
    paths: Arc<Mutex<Vec<String>>>,
) -> PipelineChildRuntime {
    let runtime = RuntimeContextClient::with_rpc(
        PipelineRuntimeContextFixture {
            responses: Mutex::new(responses),
            calls: Arc::clone(&calls),
            paths: Arc::clone(&paths),
        },
        RuntimeContextConfig {
            origin: "https://content.internal".to_owned(),
            deadline: Duration::from_secs(1),
            max_response_bytes: 32 * 1_024,
            max_application_response_bytes: 1_024 * 1_024,
        },
    )
    .expect("pipeline runtime-context fixture");
    let (gateway, _) = test_model_gateway_client(outcomes, test_model_gateway_config())
        .expect("unused pipeline model gateway");
    (
        Arc::new(PlatformClient::new(Arc::new(runtime))),
        Arc::new(ModelFacade::from_gateway(gateway)),
        calls,
        paths,
    )
}

fn recursive_sensitive_pipeline_runtime() -> PipelineChildRuntime {
    let calls = Arc::new(AtomicUsize::new(0));
    let paths = Arc::new(Mutex::new(Vec::new()));
    let responses = (0..3)
        .flat_map(|_| {
            [
                runtime_response(&json!({
                    "schema_version": "elitea.runtime.elitea-client-token.v1",
                    "project_id": 17,
                    "token": "ephemeral-pipeline-token"
                })),
                application_runtime_response(
                    3,
                    4,
                    &json!({
                        "agent_type": "agent",
                        "instructions": "Delegate the two release checks in parallel.",
                        "meta": {},
                        "variables": [],
                        "tools": [saved_application_tool(32, 42, "name-resolver")],
                        "llm_settings": {
                            "model_name": "orchestrator-model",
                            "model_project_id": 23,
                            "max_tokens": 2048,
                            "reasoning_effort": null,
                            "temperature": 0.2,
                            "openai_compatible": true
                        }
                    }),
                ),
                application_runtime_response(
                    32,
                    42,
                    &json!({
                        "agent_type": "agent",
                        "instructions": "Read release evidence and return one result.",
                        "meta": {},
                        "variables": [],
                        "tools": [{
                            "id": 92,
                            "type": "mcp",
                            "toolkit_name": "release intelligence",
                            "settings": {
                                "url": "https://mcp.example.invalid/v1/mcp",
                                "headers": null,
                                "client_id": null,
                                "client_secret": null,
                                "scopes": null,
                                "timeout": 30,
                                "selected_tools": ["lookup_release"],
                                "enable_caching": true,
                                "cache_ttl": 300,
                                "ssl_verify": true
                            }
                        }],
                        "llm_settings": {
                            "model_name": "resolver-model",
                            "model_project_id": 24,
                            "max_tokens": 2048,
                            "reasoning_effort": null,
                            "temperature": 0.2,
                            "openai_compatible": true
                        }
                    }),
                ),
            ]
        })
        .collect::<VecDeque<_>>();
    let outcomes = vec![
        model_response_for(
            "orchestrator-model",
            pipeline_parallel_saved_agent_call_response(),
        ),
        model_response_for("resolver-model", pipeline_mcp_tool_call_response()),
        model_response_for("resolver-model", pipeline_mcp_tool_call_response()),
        model_response_for(
            "resolver-model",
            pipeline_text_response("first resolved leaf"),
        ),
        model_response_for(
            "resolver-model",
            pipeline_text_response("second resolved leaf"),
        ),
        model_response_for(
            "orchestrator-model",
            pipeline_text_response("parallel orchestrator summary"),
        ),
    ];
    pipeline_runtime_from_responses(responses, outcomes, calls, paths)
}

fn application_runtime_response(
    application_id: u64,
    version_id: u64,
    version_details: &Value,
) -> Response<Body> {
    runtime_response(&json!({
        "schema_version": "elitea.runtime.application-version.v1",
        "project_id": 17,
        "application_id": application_id,
        "version_id": version_id,
        "version_details": version_details
    }))
}

async fn collect_pipeline_pause(
    mut invocation: AssembledNativeAgentInvocation<PipelineAgentCompletion>,
) -> (Vec<Value>, Option<adk_rust::Event>) {
    invocation
        .project_start(timestamp(0))
        .expect("pipeline pause browser start");
    let (mut run, mut projector, _completion) = invocation.start().expect("pipeline pause start");
    let mut browser_interrupts = Vec::new();
    let mut graph_interrupt = None;
    while let Some(event) = run.next_event().await.expect("pipeline pause event") {
        if event
            .provider_metadata
            .contains_key(adk_rust::graph::interrupt::INTERRUPT_METADATA_KEY)
        {
            graph_interrupt = Some(event.clone());
        }
        browser_interrupts.extend(
            projector
                .project(&event)
                .expect("pipeline pause projection")
                .into_iter()
                .map(|event| current(&event))
                .filter(|event| event["type"] == "agent_hitl_interrupt"),
        );
    }
    assert!(projector.is_paused());
    (browser_interrupts, graph_interrupt)
}

async fn collect_pipeline_completion(
    mut invocation: AssembledNativeAgentInvocation<PipelineAgentCompletion>,
) -> Vec<Value> {
    invocation
        .project_start(timestamp(1))
        .expect("pipeline resume browser start");
    let (mut run, mut projector, completion) = invocation.start().expect("pipeline resume start");
    while let Some(event) = run.next_event().await.expect("pipeline resume event") {
        let _ = projector
            .project(&event)
            .expect("pipeline resume projection");
    }
    let completed = completion
        .select()
        .await
        .expect("pipeline resume completion");
    projector
        .finish_after_eos(completed, timestamp(2))
        .expect("pipeline resumed browser completion")
        .into_iter()
        .map(|event| current(&event))
        .collect()
}

fn pipeline_application_resume_request(
    interrupt_ids: Vec<String>,
    action: &str,
    value: &str,
    digest: [u8; 32],
) -> super::request::AgentExecutionRequest {
    let single = interrupt_ids.len() == 1;
    let mut resume = agent_pipeline_request("release-agent", "agent");
    resume.binding.request_content_digest = digest;
    resume.payload.should_continue = true;
    resume.payload.hitl_resume = true;
    resume.payload.hitl_action = single.then(|| action.to_owned());
    resume.payload.hitl_value = single.then(|| value.to_owned());
    resume.payload.hitl_decisions = interrupt_ids
        .into_iter()
        .map(|interrupt_id| {
            json!({
                "interrupt_id": interrupt_id,
                "tool_call_id": "call_mcp",
                "action": action,
                "value": value,
            })
        })
        .collect();
    resume
}

fn saved_application_tool(application_id: u64, version_id: u64, alias: &str) -> Value {
    json!({
        "id": 45,
        "type": "application",
        "name": alias,
        "description": "Resolve one release name.",
        "author_id": 11,
        "settings": {
            "application_id": application_id,
            "application_version_id": version_id
        },
        "meta": {},
        "created_at": "2026-08-21T10:00:00Z",
        "toolkit_name": alias,
        "author": null,
        "agent_type": "agent",
        "online": null,
        "icon_meta": null,
        "variables": [],
        "is_pinned": false,
        "indexes_count": null
    })
}

fn model_response_for(model: &'static str, response: Response<Body>) -> TestModelGatewayOutcome {
    TestModelGatewayOutcome::ResponseForModel { model, response }
}

fn pipeline_parallel_saved_agent_call_response() -> Response<Body> {
    let raw = concat!(
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_first\",\"type\":\"function\",\"function\":{\"name\":\"elitea_agent_32_v_42\",\"arguments\":\"{\\\"task\\\":\\\"Resolve first release\\\"}\"}},{\"index\":1,\"id\":\"call_last\",\"type\":\"function\",\"function\":{\"name\":\"elitea_agent_32_v_42\",\"arguments\":\"{\\\"task\\\":\\\"Resolve second release\\\"}\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n",
        "data: [DONE]\n\n",
    );
    test_model_gateway_response(Body::new(Full::<Bytes>::from(raw)))
}

fn pipeline_mcp_tool_call_response() -> Response<Body> {
    let raw = concat!(
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_mcp\",\"type\":\"function\",\"function\":{\"name\":\"lookup_release\",\"arguments\":\"{\\\"release\\\":\\\"1.2\\\"}\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n",
        "data: [DONE]\n\n",
    );
    test_model_gateway_response(Body::new(Full::<Bytes>::from(raw)))
}

fn sensitive_pipeline_mcp_policy() -> Arc<ToolAdmissionPolicy> {
    Arc::new(runtime_tool_policy(&json!({
        "toolkit_security": {
            "sensitive_tools": {"mcp": ["lookup_release"]},
            "sensitive_action_company_name": "Example Org"
        }
    })))
}

fn pipeline_text_response(text: &str) -> Response<Body> {
    let raw = format!(
        "data: {{\"choices\":[{{\"delta\":{{\"role\":\"assistant\",\"content\":{text:?}}},\"finish_reason\":null}}]}}\n\ndata: {{\"choices\":[{{\"delta\":{{}},\"finish_reason\":\"stop\"}}]}}\n\ndata: {{\"choices\":[],\"usage\":{{\"prompt_tokens\":3,\"completion_tokens\":2}}}}\n\ndata: [DONE]\n\n"
    );
    test_model_gateway_response(Body::new(Full::<Bytes>::from(raw)))
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
fn pipeline_resume_admits_distinct_node_and_tool_decision_envelopes_before_checkpoint_join() {
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
    let admitted = authorized(&pipeline)
        .admit_pipeline()
        .expect("Toolkit-call decision envelope admission");
    assert!(admitted.is_resume());
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
fn llm_tool_scope_is_exact_sensitive_tools_bind_and_blocked_authority_fails_closed() {
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
    ] {
        let error = admission_error(authorized(&allowed).admit_pipeline_with_policy(&policy));
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
    }

    let sensitive = runtime_tool_policy(&json!({
        "toolkit_security": {
            "sensitive_tools": {"gitlab_org": ["list_branches_in_repo"]}
        }
    }));
    authorized(&allowed)
        .admit_pipeline_with_policy(&sensitive)
        .expect("sensitive LLM tool binds to native confirmation");
}

#[test]
fn toolkit_node_scope_is_exact_and_sensitive_read_is_bound_for_graph_confirmation() {
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
    ] {
        let error = admission_error(authorized(&allowed).admit_pipeline_with_policy(&policy));
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
    }
    let sensitive = runtime_tool_policy(&json!({
        "toolkit_security": {"sensitive_tools": {"gitlab_org": ["get_issues"]}}
    }));
    authorized(&allowed)
        .admit_pipeline_with_policy(&sensitive)
        .expect("sensitive direct read is admitted for checkpointed confirmation");
}

#[test]
fn mcp_node_scope_is_exact_and_sensitive_read_uses_the_graph_confirmation() {
    let allowed = mcp_pipeline_request(
        "release intelligence",
        &["lookup_release"],
        "lookup_release",
    );
    let empty_policy = runtime_tool_policy(&json!({}));
    authorized(&allowed)
        .admit_pipeline_with_policy(&empty_policy)
        .expect("exact frozen direct MCP scope");

    for invalid in [
        mcp_pipeline_request("other MCP", &["lookup_release"], "lookup_release"),
        mcp_pipeline_request(
            "release intelligence",
            &["other_release_tool"],
            "lookup_release",
        ),
    ] {
        let error = admission_error(authorized(&invalid).admit_pipeline_with_policy(&empty_policy));
        assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);
    }

    for policy in [
        runtime_tool_policy(&json!({
            "toolkit_security": {"blocked_toolkits": ["mcp"]}
        })),
        runtime_tool_policy(&json!({
            "toolkit_security": {"blocked_tools": {"mcp": ["lookup_release"]}}
        })),
    ] {
        let error = admission_error(authorized(&allowed).admit_pipeline_with_policy(&policy));
        assert_eq!(
            error.code(),
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        );
    }
    let sensitive = runtime_tool_policy(&json!({
        "toolkit_security": {"sensitive_tools": {"mcp": ["lookup_release"]}}
    }));
    authorized(&allowed)
        .admit_pipeline_with_policy(&sensitive)
        .expect("sensitive MCP read is admitted for checkpointed confirmation");

    let configured_as_mcp =
        toolkit_pipeline_request("release_repository", &["get_issues"], "get_issues");
    let mut configured_as_mcp = configured_as_mcp;
    let instructions = configured_as_mcp
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("pipeline version")
        .get("instructions")
        .and_then(Value::as_str)
        .expect("pipeline instructions")
        .replace("type: toolkit", "type: mcp");
    configured_as_mcp
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("pipeline version")
        .insert("instructions".to_owned(), json!(instructions));
    let error =
        admission_error(authorized(&configured_as_mcp).admit_pipeline_with_policy(&empty_policy));
    assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);
}

#[test]
fn agent_node_scope_requires_one_exact_allowed_saved_application_or_pipeline() {
    let allowed = agent_pipeline_request("release-agent", "agent");
    let empty_policy = runtime_tool_policy(&json!({}));
    let admitted = authorized(&allowed)
        .admit_pipeline_with_policy(&empty_policy)
        .expect("exact frozen Agent participant");
    assert!(admitted.profile().definition().has_application_nodes());

    let child_pipeline = agent_pipeline_request("release-agent", "pipeline");
    authorized(&child_pipeline)
        .admit_pipeline_with_policy(&empty_policy)
        .expect("saved pipeline is a valid Agent-node participant kind");

    for invalid in [
        agent_pipeline_request("other-agent", "agent"),
        agent_pipeline_request("release-agent", "openai"),
    ] {
        let error = admission_error(authorized(&invalid).admit_pipeline_with_policy(&empty_policy));
        assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);
    }

    let mut duplicate_identity = agent_pipeline_request("release-agent", "agent");
    let version = duplicate_identity
        .payload
        .application
        .get_mut("version_details")
        .and_then(Value::as_object_mut)
        .expect("application version fixture");
    let instructions = version
        .get("instructions")
        .and_then(Value::as_str)
        .expect("Agent pipeline YAML")
        .replace("transition: END", "transition: delegate_again");
    version.insert(
        "instructions".to_owned(),
        json!(format!(
            "{instructions}  - id: delegate_again\n    type: agent\n    tool: release-agent-copy\n    input_mapping:\n      task: {{type: fixed, value: 'Summarize again'}}\n    output: [answer, messages]\n    transition: END\n"
        )),
    );
    let tools = version
        .get_mut("tools")
        .and_then(Value::as_array_mut)
        .expect("saved participant list");
    let mut duplicate = tools[0].clone();
    duplicate["id"] = json!(45);
    duplicate["name"] = json!("release-agent-copy");
    duplicate["toolkit_name"] = json!("release-agent-copy");
    tools.push(duplicate);
    let error =
        admission_error(authorized(&duplicate_identity).admit_pipeline_with_policy(&empty_policy));
    assert_eq!(error.code(), NativeAgentAssemblyErrorCode::InvalidInput);

    let blocked = runtime_tool_policy(&json!({
        "toolkit_security": {"blocked_toolkits": ["application"]}
    }));
    let error = admission_error(authorized(&allowed).admit_pipeline_with_policy(&blocked));
    assert_eq!(
        error.code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

#[tokio::test]
async fn direct_saved_agent_node_streams_one_exact_pipeline_hierarchy() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let (platform, model_facade, calls, paths) = direct_agent_pipeline_runtime();
    let assembler = PipelineNativeAgentAssembler::with_state(
        Arc::clone(&sessions),
        Arc::clone(&checkpointer) as Arc<dyn Checkpointer>,
    )
    .with_runtime_clients(platform, model_facade);
    let request = agent_pipeline_request("release-agent", "agent");
    let mut invocation = assembler
        .assemble(authorized(&request))
        .await
        .expect("authorized direct-agent participant");
    invocation
        .project_start(timestamp(0))
        .expect("browser start");
    let (mut run, mut projector, completion) = invocation.start().expect("pipeline start");
    let mut browser = Vec::new();
    while let Some(event) = run.next_event().await.expect("pipeline Agent event") {
        let projected = projector
            .project(&event)
            .expect("pipeline Agent projection");
        browser.extend(projected.into_iter().map(|event| current(&event)));
    }
    let selected = completion
        .select()
        .await
        .expect("pipeline Agent result selection");
    browser.extend(
        projector
            .finish_after_eos(selected, timestamp(1))
            .expect("pipeline Agent browser completion")
            .into_iter()
            .map(|event| current(&event)),
    );

    let nested = browser
        .iter()
        .filter(|event| {
            event["response_metadata"]["parent_agent_path"]
                .as_array()
                .is_some_and(|path| !path.is_empty())
        })
        .collect::<Vec<_>>();
    assert!(!nested.is_empty(), "missing nested hierarchy: {browser:?}");
    for event in nested {
        let path = event["response_metadata"]["parent_agent_path"]
            .as_array()
            .expect("nested Agent path");
        assert_eq!(path.len(), 1);
        assert_eq!(path[0]["name"], "release-agent");
        assert_eq!(path[0]["sibling_ordinal"], 1);
        assert!(
            path[0]["call_id"]
                .as_str()
                .is_some_and(|call_id| call_id.starts_with("pipeline:delegate:"))
        );
    }
    assert!(
        browser
            .iter()
            .any(|event| event["content"] == "direct child summary")
    );
    assert_eq!(calls.load(Ordering::Acquire), 2);
    assert_eq!(
        paths.lock().expect("runtime paths").as_slice(),
        [
            "/executions/execution%2Fone/generations/2/runtime-context/elitea-client-token",
            "/executions/execution%2Fone/generations/2/runtime-context/applications/3/versions/4"
        ]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn direct_saved_agent_node_resumes_exact_descendant_confirmation_from_graph_checkpoint() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let (platform, model_facade, context_calls, _paths) = sensitive_direct_agent_pipeline_runtime();
    let connections = Arc::new(AtomicUsize::new(0));
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let connector = Arc::new(PipelineMcpConnector {
        connections: Arc::clone(&connections),
        tool_calls: Arc::clone(&tool_calls),
        read_only: true,
    });
    let assembler = PipelineNativeAgentAssembler::with_state(
        Arc::clone(&sessions),
        Arc::clone(&checkpointer) as Arc<dyn Checkpointer>,
    )
    .with_runtime_clients(platform, model_facade)
    .with_mcp_connector(connector)
    .with_tool_policy(sensitive_pipeline_mcp_policy());
    let request = agent_pipeline_request("release-agent", "agent");
    let private_thread = private_pipeline_session_id(&request);
    let invocation = assembler
        .assemble(authorized(&request))
        .await
        .expect("authorized sensitive direct-agent participant");
    let (browser_interrupts, graph_interrupt) = collect_pipeline_pause(invocation).await;
    assert_eq!(browser_interrupts.len(), 1);
    let public = &browser_interrupts[0];
    assert_eq!(
        public["response_metadata"]["parent_agent_path"],
        json!([{
            "name": "release-agent",
            "call_id": "pipeline:delegate:0",
            "sibling_ordinal": 1,
        }])
    );
    let interrupt_id = public["response_metadata"]["hitl_interrupts"][0]["interrupt_id"]
        .as_str()
        .expect("descendant interrupt identity")
        .to_owned();
    let graph_interrupt = graph_interrupt.expect("internal graph checkpoint event");
    let binding =
        pipeline_application_event_binding(&graph_interrupt, "elitea-agent", &private_thread)
            .expect("pipeline Application checkpoint binding");
    assert_eq!(binding.node_name(), "delegate");
    assert_eq!(binding.application_call_id(), "pipeline:delegate:0");
    assert_eq!(binding.interrupt_ids(), [interrupt_id.as_str()]);
    assert_eq!(tool_calls.load(Ordering::Acquire), 0);

    let resume = pipeline_application_resume_request(vec![interrupt_id], "approve", "", [8; 32]);
    let invocation = assembler
        .assemble(authorized(&resume))
        .await
        .expect("checkpoint-bound descendant resume");
    let browser = collect_pipeline_completion(invocation).await;
    assert!(
        browser
            .iter()
            .any(|event| event["content"] == "child resumed summary")
    );
    assert_eq!(tool_calls.load(Ordering::Acquire), 1);
    assert_eq!(connections.load(Ordering::Acquire), 2);
    assert_eq!(context_calls.load(Ordering::Acquire), 4);
}

#[tokio::test(flavor = "current_thread")]
async fn pipeline_agent_node_resumes_parallel_nested_confirmations_without_identity_collisions() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let (platform, model_facade, context_calls, _paths) = recursive_sensitive_pipeline_runtime();
    let connections = Arc::new(AtomicUsize::new(0));
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let assembler = PipelineNativeAgentAssembler::with_state(
        Arc::clone(&sessions),
        Arc::clone(&checkpointer) as Arc<dyn Checkpointer>,
    )
    .with_runtime_clients(platform, model_facade)
    .with_mcp_connector(Arc::new(PipelineMcpConnector {
        connections: Arc::clone(&connections),
        tool_calls: Arc::clone(&tool_calls),
        read_only: true,
    }))
    .with_tool_policy(sensitive_pipeline_mcp_policy());
    let request = agent_pipeline_request("release-agent", "agent");
    let invocation = assembler
        .assemble(authorized(&request))
        .await
        .expect("recursive pipeline Agent participant");
    let (interrupts, graph_interrupt) = collect_pipeline_pause(invocation).await;
    assert!(graph_interrupt.is_some());
    assert_eq!(interrupts.len(), 2);
    let paths = interrupts
        .iter()
        .map(|event| event["response_metadata"]["parent_agent_path"].clone())
        .collect::<HashSet<_>>();
    assert_eq!(
        paths,
        HashSet::from([
            json!([
                {"name": "release-agent", "call_id": "pipeline:delegate:0", "sibling_ordinal": 1},
                {"name": "name-resolver", "call_id": "call_first", "sibling_ordinal": 1},
            ]),
            json!([
                {"name": "release-agent", "call_id": "pipeline:delegate:0", "sibling_ordinal": 1},
                {"name": "name-resolver", "call_id": "call_last", "sibling_ordinal": 2},
            ]),
        ])
    );
    let mut interrupt_ids = interrupts
        .iter()
        .map(|event| {
            event["response_metadata"]["hitl_interrupts"][0]["interrupt_id"]
                .as_str()
                .expect("parallel descendant interrupt identity")
                .to_owned()
        })
        .collect::<Vec<_>>();
    interrupt_ids.sort_unstable();
    assert_ne!(interrupt_ids[0], interrupt_ids[1]);
    assert_eq!(tool_calls.load(Ordering::Acquire), 0);

    let partial =
        pipeline_application_resume_request(vec![interrupt_ids[0].clone()], "approve", "", [5; 32]);
    let partial = assembler.assemble(authorized(&partial)).await;
    let Err(partial) = partial else {
        panic!("partial parallel descendant decision set resumed the graph");
    };
    assert_eq!(partial.code(), NativeAgentAssemblyErrorCode::InvalidInput);
    assert_eq!(tool_calls.load(Ordering::Acquire), 0);

    let resume = pipeline_application_resume_request(interrupt_ids, "approve", "", [7; 32]);
    let invocation = assembler
        .assemble(authorized(&resume))
        .await
        .expect("parallel descendant checkpoint resume");
    let browser = collect_pipeline_completion(invocation).await;
    assert!(
        browser
            .iter()
            .any(|event| event["content"] == "parallel orchestrator summary")
    );
    assert_eq!(tool_calls.load(Ordering::Acquire), 2);
    assert_eq!(connections.load(Ordering::Acquire), 3);
    assert_eq!(context_calls.load(Ordering::Acquire), 9);
}

#[tokio::test(flavor = "current_thread")]
async fn pipeline_agent_node_block_preserves_same_call_structured_result_without_dispatch() {
    let sessions = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let (platform, model_facade, _context_calls, _paths) =
        sensitive_direct_agent_pipeline_runtime();
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let assembler = PipelineNativeAgentAssembler::with_state(
        sessions.clone(),
        Arc::clone(&checkpointer) as Arc<dyn Checkpointer>,
    )
    .with_runtime_clients(platform, model_facade)
    .with_mcp_connector(Arc::new(PipelineMcpConnector {
        connections: Arc::new(AtomicUsize::new(0)),
        tool_calls: Arc::clone(&tool_calls),
        read_only: true,
    }))
    .with_tool_policy(sensitive_pipeline_mcp_policy());
    let request = agent_pipeline_request("release-agent", "agent");
    let profile = PipelineExecutionProfile::validate(&request, false).expect("pipeline profile");
    let plan = OrdinaryNativeAgentPlan::from_authorized_pipeline(
        &request,
        profile.shell(),
        &AuthorizedNativeCommandBinding::fixture(),
        false,
        false,
    )
    .expect("pipeline identity plan");
    let invocation = assembler
        .assemble(authorized(&request))
        .await
        .expect("blocking pipeline Agent participant");
    let (interrupts, _) = collect_pipeline_pause(invocation).await;
    let interrupt_id = interrupts[0]["response_metadata"]["hitl_interrupts"][0]["interrupt_id"]
        .as_str()
        .expect("blocked descendant interrupt identity")
        .to_owned();
    let resume = pipeline_application_resume_request(
        vec![interrupt_id],
        "block_with_comment",
        "keep customer data private",
        [6; 32],
    );
    let invocation = assembler
        .assemble(authorized(&resume))
        .await
        .expect("blocked descendant checkpoint resume");
    let _browser = collect_pipeline_completion(invocation).await;
    assert_eq!(tool_calls.load(Ordering::Acquire), 0);

    let stored = sessions
        .get(GetRequest {
            app_name: "elitea-agent-v1".to_owned(),
            user_id: plan.user_id().to_owned(),
            session_id: plan.session_id().to_owned(),
            num_recent_events: None,
            after: None,
        })
        .await
        .expect("blocked pipeline session");
    let blocked = stored
        .events()
        .all()
        .into_iter()
        .find_map(|event| {
            (event.actions.tool_confirmation_decision
                == Some(adk_rust::ToolConfirmationDecision::Deny))
            .then(|| {
                event
                    .tool_results()
                    .into_iter()
                    .find(|result| {
                        result.call_id == Some("call_mcp") && result.name == "lookup_release"
                    })
                    .map(|result| result.response.clone())
            })
            .flatten()
        })
        .expect("same-call structured blocked result");
    assert_eq!(blocked["type"], "sensitive_tool_blocked");
    assert_eq!(blocked["blocked_tool_name"], "lookup_release");
    assert_eq!(blocked["denial_reason"], "keep customer data private");
}

#[tokio::test]
async fn saved_pipeline_participant_loads_exact_version_and_runs_as_child_subgraph() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let (platform, model_facade, calls, paths) = pipeline_child_runtime();
    let assembler = PipelineNativeAgentAssembler::with_state(
        Arc::clone(&sessions),
        Arc::clone(&checkpointer) as Arc<dyn Checkpointer>,
    )
    .with_runtime_clients(platform, model_facade);
    let request = agent_pipeline_request("release-agent", "pipeline");
    let private_thread = private_pipeline_session_id(&request);
    let mut invocation = assembler
        .assemble(authorized(&request))
        .await
        .expect("authorized saved-pipeline participant");
    invocation
        .project_start(timestamp(0))
        .expect("browser start");
    let (mut run, mut projector, completion) = invocation.start().expect("pipeline start");
    while let Some(event) = run.next_event().await.expect("pipeline event") {
        let _ = projector
            .project(&event)
            .expect("pipeline event projection");
    }
    let selected = completion
        .select()
        .await
        .expect("pipeline result selection");
    let browser = projector
        .finish_after_eos(selected, timestamp(1))
        .expect("pipeline browser completion");
    assert!(
        browser
            .into_iter()
            .map(|event| current(&event))
            .any(|event| { event["content"] == "Child: Summarize the release" })
    );
    assert_eq!(calls.load(Ordering::Acquire), 2);
    assert_eq!(
        paths.lock().expect("runtime paths").as_slice(),
        [
            "/executions/execution%2Fone/generations/2/runtime-context/elitea-client-token",
            "/executions/execution%2Fone/generations/2/runtime-context/applications/3/versions/4"
        ]
    );
    assert!(
        checkpointer
            .load(&format!("{private_thread}/delegate"))
            .await
            .expect("child checkpoint lookup")
            .is_some()
    );
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

struct PipelineMcpConnector {
    connections: Arc<AtomicUsize>,
    tool_calls: Arc<AtomicUsize>,
    read_only: bool,
}

#[async_trait]
impl McpConnector for PipelineMcpConnector {
    async fn connect(
        &self,
        config: &RemoteMcpConfig,
    ) -> Result<Arc<dyn Toolset>, McpMaterializationError> {
        self.connections.fetch_add(1, Ordering::AcqRel);
        assert_eq!(config.endpoint(), "https://mcp.example.invalid/v1/mcp");
        Ok(Arc::new(BasicToolset::new(
            "fixture_mcp",
            vec![Arc::new(PipelineMcpTool {
                calls: Arc::clone(&self.tool_calls),
                read_only: self.read_only,
            })],
        )))
    }
}

struct PipelineMcpTool {
    calls: Arc<AtomicUsize>,
    read_only: bool,
}

#[async_trait]
impl Tool for PipelineMcpTool {
    fn name(&self) -> &'static str {
        "lookup_release"
    }

    fn description(&self) -> &'static str {
        "Read release evidence for one release identifier."
    }

    fn parameters_schema(&self) -> Option<Value> {
        Some(json!({
            "type": "object",
            "properties": {"release": {"type": "string"}},
            "required": ["release"],
            "additionalProperties": false
        }))
    }

    fn is_read_only(&self) -> bool {
        self.read_only
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        _context: Arc<dyn ToolContext>,
        arguments: Value,
    ) -> adk_rust::Result<Value> {
        self.calls.fetch_add(1, Ordering::AcqRel);
        Ok(json!({
            "records": {"release": arguments["release"], "risk": "low"},
            "messages": [{"role": "assistant", "content": "MCP read complete"}]
        }))
    }
}

#[tokio::test]
async fn llm_node_block_actions_replay_same_call_as_structured_tool_result() {
    run_llm_node_block("reject", None, "denied by user").await;
    run_llm_node_block(
        "block_with_comment",
        Some("release is under legal hold"),
        "release is under legal hold",
    )
    .await;
}

async fn run_llm_node_block(action: &str, comment: Option<&str>, expected_reason: &str) {
    let (assembler, captured, tool_calls) = sensitive_llm_node_assembler();
    let mut request = llm_mcp_pipeline_request(
        "release intelligence",
        &["lookup_release"],
        &["lookup_release"],
    );
    let profile = PipelineExecutionProfile::validate(&request, false).expect("pipeline profile");
    let plan = OrdinaryNativeAgentPlan::from_authorized_pipeline(
        &request,
        profile.shell(),
        &AuthorizedNativeCommandBinding::fixture(),
        false,
        false,
    )
    .expect("pipeline identity plan");

    let invocation = assembler
        .assemble(authorized(&request))
        .await
        .expect("sensitive LLM-node invocation");
    let (interrupts, graph_interrupt) = collect_pipeline_pause(invocation).await;
    assert_eq!(interrupts.len(), 1);
    let interrupt_id = interrupts[0]["response_metadata"]["hitl_interrupts"][0]["interrupt_id"]
        .as_str()
        .expect("LLM-node interrupt identity")
        .to_owned();
    let graph_interrupt = graph_interrupt.expect("private graph interruption");
    let binding = pipeline_tool_event_binding(&graph_interrupt, "elitea-agent", plan.session_id())
        .expect("LLM-node confirmation binding");
    assert_eq!(binding.tool_call_id(), "call_mcp");
    assert!(binding.llm_replay().is_some());
    assert_eq!(tool_calls.load(Ordering::Acquire), 0);

    request.binding.request_content_digest = [9; 32];
    request.payload.should_continue = true;
    request.payload.hitl_resume = true;
    request.payload.hitl_action = Some(action.to_owned());
    request.payload.hitl_value = Some(comment.unwrap_or_default().to_owned());
    request.payload.hitl_decisions = vec![json!({
        "interrupt_id": interrupt_id,
        "tool_call_id": "call_mcp",
        "action": action,
        "value": comment.unwrap_or_default(),
    })];
    let invocation = assembler
        .assemble(authorized(&request))
        .await
        .expect("same-call LLM-node continuation");
    let browser = collect_pipeline_completion(invocation).await;
    assert!(
        browser
            .iter()
            .any(|event| event["content"] == "continued after block")
    );
    assert_eq!(tool_calls.load(Ordering::Acquire), 0);

    assert_llm_blocked_continuation(&captured, expected_reason);
}

fn sensitive_llm_node_assembler() -> (
    PipelineNativeAgentAssembler,
    CapturedModelRequests,
    Arc<AtomicUsize>,
) {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let token_response = || {
        runtime_response(&json!({
            "schema_version": "elitea.runtime.elitea-client-token.v1",
            "project_id": 17,
            "token": "ephemeral-pipeline-token"
        }))
    };
    let runtime = RuntimeContextClient::with_rpc(
        PipelineRuntimeContextFixture {
            responses: Mutex::new(VecDeque::from([token_response(), token_response()])),
            calls: Arc::new(AtomicUsize::new(0)),
            paths: Arc::new(Mutex::new(Vec::new())),
        },
        RuntimeContextConfig {
            origin: "https://content.internal".to_owned(),
            deadline: Duration::from_secs(1),
            max_response_bytes: 32 * 1_024,
            max_application_response_bytes: 1_024 * 1_024,
        },
    )
    .expect("pipeline runtime-context fixture");
    let (gateway, captured) = test_model_gateway_client(
        vec![
            TestModelGatewayOutcome::Response(pipeline_mcp_tool_call_response()),
            TestModelGatewayOutcome::Response(pipeline_text_response("continued after block")),
        ],
        test_model_gateway_config(),
    )
    .expect("pipeline model gateway fixture");
    let platform = Arc::new(PlatformClient::new(Arc::new(runtime)));
    let model_facade = Arc::new(ModelFacade::from_gateway(gateway));
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let assembler = PipelineNativeAgentAssembler::with_state(
        Arc::clone(&sessions),
        Arc::clone(&checkpointer) as Arc<dyn Checkpointer>,
    )
    .with_runtime_clients(platform, model_facade)
    .with_mcp_connector(Arc::new(PipelineMcpConnector {
        connections: Arc::new(AtomicUsize::new(0)),
        tool_calls: Arc::clone(&tool_calls),
        read_only: true,
    }))
    .with_tool_policy(sensitive_pipeline_mcp_policy());
    (assembler, captured, tool_calls)
}

fn assert_llm_blocked_continuation(captured: &CapturedModelRequests, expected_reason: &str) {
    let captured = captured.lock().expect("captured model requests");
    assert_eq!(
        captured.len(),
        2,
        "resume must not replan before tool replay"
    );
    let continuation: Value =
        serde_json::from_slice(&captured[1].body).expect("continuation request JSON");
    let tool_message = continuation["messages"]
        .as_array()
        .expect("continuation messages")
        .iter()
        .find(|message| message["role"] == "tool" && message["tool_call_id"] == "call_mcp")
        .expect("same-call tool response delivered to model");
    let blocked: Value = serde_json::from_str(
        tool_message["content"]
            .as_str()
            .expect("structured tool response JSON"),
    )
    .expect("structured blocked result");
    assert_eq!(blocked["type"], "sensitive_tool_blocked");
    assert_eq!(blocked["blocked_tool_name"], "lookup_release");
    assert_eq!(blocked["denial_reason"], expected_reason);
}

#[tokio::test]
async fn mcp_node_discovers_and_executes_one_read_without_a_model_turn() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let connections = Arc::new(AtomicUsize::new(0));
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let connector = Arc::new(PipelineMcpConnector {
        connections: Arc::clone(&connections),
        tool_calls: Arc::clone(&tool_calls),
        read_only: true,
    });
    let assembler = PipelineNativeAgentAssembler::with_state(
        Arc::clone(&sessions),
        Arc::clone(&checkpointer) as Arc<dyn Checkpointer>,
    )
    .with_mcp_connector(connector);
    let request = mcp_pipeline_request(
        "release intelligence",
        &["lookup_release"],
        "lookup_release",
    );
    let private_thread = private_pipeline_session_id(&request);
    let mut invocation = assembler
        .assemble(authorized(&request))
        .await
        .expect("authorized direct MCP pipeline");
    invocation
        .project_start(timestamp(0))
        .expect("browser start");
    let (mut run, mut projector, completion) = invocation.start().expect("MCP pipeline start");
    while let Some(event) = run.next_event().await.expect("MCP pipeline event") {
        let _ = projector.project(&event).expect("MCP event projection");
    }
    let selected = completion.select().await.expect("MCP result selection");
    let browser = projector
        .finish_after_eos(selected, timestamp(1))
        .expect("MCP browser completion");
    assert_eq!(connections.load(Ordering::Acquire), 1);
    assert_eq!(tool_calls.load(Ordering::Acquire), 1);
    let browser_content = browser
        .into_iter()
        .map(|event| current(&event)["content"].clone())
        .collect::<Vec<_>>();
    assert!(
        browser_content
            .iter()
            .any(|content| content == "{\"release\":\"1.2\",\"risk\":\"low\"}"),
        "unexpected MCP completion: {browser_content:?}"
    );
    let checkpoint = checkpointer
        .load(&private_thread)
        .await
        .expect("checkpoint read")
        .expect("terminal MCP checkpoint");
    assert_eq!(
        checkpoint.state.get("records"),
        Some(&json!({"release": "1.2", "risk": "low"}))
    );
    assert_eq!(
        checkpoint.state.get("messages"),
        Some(&json!([
            {"role": "user", "content": "current"},
            {"role": "assistant", "content": "MCP read complete"}
        ]))
    );
}

#[tokio::test]
async fn mcp_node_rejects_server_declared_effect_before_tool_execution() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let tool_calls = Arc::new(AtomicUsize::new(0));
    let connector = Arc::new(PipelineMcpConnector {
        connections: Arc::new(AtomicUsize::new(0)),
        tool_calls: Arc::clone(&tool_calls),
        read_only: false,
    });
    let assembler =
        PipelineNativeAgentAssembler::with_state(sessions, Arc::new(MemoryCheckpointer::new()))
            .with_mcp_connector(connector);
    let request = mcp_pipeline_request(
        "release intelligence",
        &["lookup_release"],
        "lookup_release",
    );
    let result = assembler.assemble(authorized(&request)).await;
    let Err(error) = result else {
        panic!("effectful direct MCP node was assembled");
    };
    assert_eq!(
        error.code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
    assert_eq!(tool_calls.load(Ordering::Acquire), 0);
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

async fn assert_fresh_printer_pause(
    assembler: &PipelineNativeAgentAssembler,
    fresh: &super::request::AgentExecutionRequest,
) {
    let mut invocation = assembler
        .assemble(authorized(fresh))
        .await
        .expect("fresh Printer assembly");
    invocation
        .project_start(timestamp(0))
        .expect("Printer browser start");
    let (mut run, mut projector, completion) = invocation.start().expect("Printer start");
    let interrupt = run
        .next_event()
        .await
        .expect("Printer event")
        .expect("Printer checkpoint event");
    assert!(
        projector
            .project(&interrupt)
            .expect("Printer projection")
            .is_empty()
    );
    assert!(!projector.is_paused());
    assert!(run.next_event().await.expect("Printer EOS").is_none());
    let selected = completion
        .select()
        .await
        .expect("Printer fallback selection");
    let output = projector
        .finish_after_eos(selected, timestamp(1))
        .expect("Printer public result")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(
        output
            .iter()
            .map(|event| event["type"].as_str())
            .collect::<Vec<_>>(),
        [Some("agent_response"), Some("full_message")]
    );
    assert!(
        output
            .iter()
            .all(|event| { event["content"] == "Draft ready\n\n-----\n*Continue when ready.*" })
    );
    assert_eq!(output[1]["response_metadata"]["should_continue"], false);
    assert_eq!(output[1]["response_metadata"]["hitl_resume"], false);
}

#[tokio::test]
async fn printer_uses_the_common_runner_as_a_nonterminal_result_then_resumes_from_user_text() {
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let assembler =
        PipelineNativeAgentAssembler::with_state(Arc::clone(&sessions), checkpointer.clone());
    let fresh = printer_pipeline_request("start", false);
    let private_thread = private_pipeline_session_id(&fresh);
    assert_fresh_printer_pause(&assembler, &fresh).await;

    let resume = printer_pipeline_request("continue now", true);
    let mut invocation = assembler
        .assemble(authorized(&resume))
        .await
        .expect("checkpoint-bound Printer continuation");
    invocation
        .project_start(timestamp(2))
        .expect("Printer resume browser start");
    let (mut run, mut projector, completion) = invocation.start().expect("Printer resume start");
    let completed = run
        .next_event()
        .await
        .expect("Printer completion event")
        .expect("Printer completion marker");
    let progress = projector
        .project(&completed)
        .expect("Printer completion projection")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(progress.len(), 4);
    assert_eq!(progress[1]["content"], "continue now");
    assert!(
        run.next_event()
            .await
            .expect("Printer completed EOS")
            .is_none()
    );
    let selected = completion
        .select()
        .await
        .expect("Printer completion selection");
    let output = projector
        .finish_after_eos(selected, timestamp(3))
        .expect("Printer terminal result")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(output[0]["type"], "pipeline_finish");
    assert_eq!(output[0]["content"], "continue now");
    assert_eq!(output[2]["response_metadata"]["should_continue"], true);
    assert_eq!(output[2]["response_metadata"]["hitl_resume"], false);

    let checkpoint = checkpointer
        .load(&private_thread)
        .await
        .expect("Printer checkpoint read")
        .expect("Printer terminal checkpoint");
    assert_eq!(
        checkpoint.state.get("messages"),
        Some(&json!([
            {"role": "user", "content": "start"},
            {"role": "user", "content": "continue now"}
        ]))
    );
    let replay = assembler.assemble(authorized(&resume)).await;
    let Err(replay) = replay else {
        panic!("completed Printer continuation was replayed");
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
