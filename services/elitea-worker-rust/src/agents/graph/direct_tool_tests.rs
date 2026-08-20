use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use adk_rust::graph::{Checkpointer, ExecutionConfig, MemoryCheckpointer, Node, NodeContext};
use adk_rust::runner::Runner;
use adk_rust::session::{CreateRequest, InMemorySessionService, SessionService};
use adk_rust::{Content, Part, SessionId, Tool, ToolContext, UserId};
use async_trait::async_trait;
use serde_json::{Value, json};

use super::compiler::PipelineNodeRuntimes;
use super::direct_tool::{
    DirectToolExecutionError, DirectToolInputMapping, DirectToolNode, DirectToolNodeDefinition,
    DirectToolSelection, PipelineDirectToolResolver,
};
use super::{EliteaGraphAgent, compiler::PipelineDefinition};
use crate::agents::runtime::NativeAgentInvocation;

const TOOLKIT_NODE: &str = r#"
id: lookup
type: toolkit
toolkit_name: Customer Support
tool: search_records
input_mapping:
  query:
    type: fstring
    value: "ticket {ticket_id}"
  limit:
    type: fixed
    value: 5
  filters:
    type: variable
    value: filters
input: [ticket_id, filters]
output: [report, messages]
structured_output: true
transition: END
"#;

fn state_types() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("ticket_id".to_owned(), "int".to_owned()),
        ("filters".to_owned(), "dict".to_owned()),
        ("report".to_owned(), "dict".to_owned()),
        ("messages".to_owned(), "list".to_owned()),
    ])
}

#[test]
fn toolkit_node_admits_ui_yaml_typed_mapping_and_structured_output() {
    let node = DirectToolNodeDefinition::from_yaml(TOOLKIT_NODE).expect("Toolkit node");
    assert_eq!(node.id(), "lookup");
    assert_eq!(node.selection().alias(), "Customer Support");
    assert_eq!(node.selection().tool(), "search_records");
    assert_eq!(node.input_keys(), ["ticket_id", "filters"]);
    assert_eq!(node.output_keys(), ["report", "messages"]);
    assert!(node.structured_output());
    assert_eq!(node.transition(), Some("END"));
    assert!(matches!(
        node.input_mapping().get("limit"),
        Some(DirectToolInputMapping::Fixed(value)) if value == &json!(5)
    ));
    assert!(matches!(
        node.input_mapping().get("filters"),
        Some(DirectToolInputMapping::Variable(value)) if value == "filters"
    ));
    assert!(node.config_digest().iter().any(|byte| *byte != 0));

    let legacy = DirectToolNodeDefinition::from_yaml(
        "id: lookup\ntype: toolkit\ntoolkit_name: support\ntool: search\ntransition: END\n",
    )
    .expect("legacy default mapping");
    assert_eq!(legacy.input_keys(), ["messages"]);
    assert!(matches!(
        legacy.input_mapping().get("messages"),
        Some(DirectToolInputMapping::Variable(value)) if value == "messages"
    ));
}

#[test]
fn toolkit_node_rejects_ambiguous_or_unbounded_configuration() {
    for yaml in [
        TOOLKIT_NODE.replace("type: toolkit", "type: mcp"),
        TOOLKIT_NODE.replace("tool: search_records", "tool: ''"),
        TOOLKIT_NODE.replace("output: [report, messages]", "output: [report, report]"),
        TOOLKIT_NODE.replace("type: variable", "type: expression"),
        TOOLKIT_NODE.replace("output: [report, messages]", "output: [messages]"),
        TOOLKIT_NODE.replace("transition: END", "transition: 'bad/path'"),
    ] {
        assert!(DirectToolNodeDefinition::from_yaml(&yaml).is_err());
    }
}

#[derive(Default)]
struct InvocationCapture {
    calls: usize,
    arguments: Value,
    function_call_id: String,
    session_id: String,
}

struct FixtureTool {
    name: String,
    read_only: bool,
    response: Value,
    capture: Arc<Mutex<InvocationCapture>>,
}

#[async_trait]
impl Tool for FixtureTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &'static str {
        "direct Toolkit node fixture"
    }

    fn is_read_only(&self) -> bool {
        self.read_only
    }

    async fn execute(
        &self,
        context: Arc<dyn ToolContext>,
        arguments: Value,
    ) -> adk_rust::Result<Value> {
        let mut capture = self.capture.lock().expect("capture lock");
        capture.calls += 1;
        capture.arguments = arguments;
        capture.function_call_id = context.function_call_id().to_owned();
        capture.session_id = context.session_id().to_owned();
        Ok(self.response.clone())
    }
}

struct FixtureResolver {
    alias: String,
    tool: Arc<dyn Tool>,
}

impl PipelineDirectToolResolver for FixtureResolver {
    fn resolve(
        &self,
        selection: &DirectToolSelection,
    ) -> Result<Arc<dyn Tool>, DirectToolExecutionError> {
        if selection.alias() == self.alias && selection.tool() == self.tool.name() {
            Ok(Arc::clone(&self.tool))
        } else {
            Err(DirectToolExecutionError::Unavailable)
        }
    }
}

fn fixture_runtime(
    response: Value,
    read_only: bool,
) -> (
    Arc<dyn PipelineDirectToolResolver>,
    Arc<Mutex<InvocationCapture>>,
) {
    let capture = Arc::new(Mutex::new(InvocationCapture::default()));
    let tool: Arc<dyn Tool> = Arc::new(FixtureTool {
        name: "search_records".to_owned(),
        read_only,
        response,
        capture: Arc::clone(&capture),
    });
    (
        Arc::new(FixtureResolver {
            alias: "Customer Support".to_owned(),
            tool,
        }),
        capture,
    )
}

#[tokio::test]
async fn native_toolkit_node_executes_once_with_checkpoint_step_identity_and_projects_state() {
    let definition = DirectToolNodeDefinition::from_yaml(TOOLKIT_NODE).expect("Toolkit node");
    let (resolver, capture) = fixture_runtime(
        json!({
            "report": {"id": 7, "status": "open"},
            "messages": [{"role": "assistant", "content": "found"}]
        }),
        true,
    );
    let node = DirectToolNode::new(definition, state_types(), resolver);
    let state = HashMap::from([
        ("ticket_id".to_owned(), json!(42)),
        ("filters".to_owned(), json!({"active": true})),
    ]);
    let output = node
        .execute(&NodeContext::new(
            state,
            ExecutionConfig::new("pipeline-thread"),
            7,
        ))
        .await
        .expect("direct Toolkit node");
    assert_eq!(
        output.updates.get("report"),
        Some(&json!({"id": 7, "status": "open"}))
    );
    assert_eq!(
        output.updates.get("messages"),
        Some(&json!([{"role": "assistant", "content": "found"}]))
    );
    let capture = capture.lock().expect("capture lock");
    assert_eq!(capture.calls, 1);
    assert_eq!(
        capture.arguments,
        json!({"filters":{"active":true},"limit":5,"query":"ticket 42"})
    );
    assert_eq!(capture.function_call_id, "pipeline:lookup:7");
    assert_eq!(capture.session_id, "pipeline-thread");
}

#[tokio::test]
async fn direct_tool_output_modes_match_function_node_business_projection() {
    let no_outputs = DirectToolNodeDefinition::from_yaml(
        "id: lookup\ntype: toolkit\ntoolkit_name: Customer Support\ntool: search_records\n",
    )
    .expect("no-output node");
    let (resolver, _) = fixture_runtime(json!({"count": 2}), true);
    let output = DirectToolNode::new(no_outputs, state_types(), resolver)
        .execute(&NodeContext::new(
            HashMap::from([("messages".to_owned(), json!([]))]),
            ExecutionConfig::new("thread"),
            0,
        ))
        .await
        .expect("message projection");
    assert_eq!(
        output.updates.get("messages"),
        Some(&json!([{"role":"assistant","content":"{\"count\":2}"}]))
    );

    let first_output = DirectToolNodeDefinition::from_yaml(
        "id: lookup\ntype: toolkit\ntoolkit_name: Customer Support\ntool: search_records\noutput: [report]\ntransition: END\n",
    )
    .expect("first-output node");
    let (resolver, _) = fixture_runtime(json!({"count": 2}), true);
    let output = DirectToolNode::new(first_output, state_types(), resolver)
        .execute(&NodeContext::new(
            HashMap::from([("messages".to_owned(), json!([]))]),
            ExecutionConfig::new("thread"),
            0,
        ))
        .await
        .expect("data projection");
    assert_eq!(output.updates.get("report"), Some(&json!({"count": 2})));
}

#[tokio::test]
async fn effect_or_wrong_structured_shape_fails_without_checkpoint_corruption() {
    let definition = DirectToolNodeDefinition::from_yaml(TOOLKIT_NODE).expect("Toolkit node");
    let (effect_resolver, effect_capture) = fixture_runtime(json!({"report": {}}), false);
    let effect = DirectToolNode::new(definition.clone(), state_types(), effect_resolver)
        .execute(&NodeContext::new(
            HashMap::from([
                ("ticket_id".to_owned(), json!(42)),
                ("filters".to_owned(), json!({})),
            ]),
            ExecutionConfig::new("thread"),
            0,
        ))
        .await;
    assert!(effect.is_err());
    assert_eq!(effect_capture.lock().expect("capture lock").calls, 0);

    let (wrong_resolver, _) = fixture_runtime(json!({"report": []}), true);
    let wrong = DirectToolNode::new(definition, state_types(), wrong_resolver)
        .execute(&NodeContext::new(
            HashMap::from([
                ("ticket_id".to_owned(), json!(42)),
                ("filters".to_owned(), json!({})),
            ]),
            ExecutionConfig::new("thread"),
            0,
        ))
        .await;
    assert!(wrong.is_err());
}

#[tokio::test]
async fn compiled_toolkit_graph_checkpoints_result_without_model_turn() {
    let definition = PipelineDefinition::from_yaml(
        r#"
state:
  ticket_id:
    type: int
    value: 9
  filters:
    type: dict
    value: {active: true}
  report: dict
  messages: list
entry_point: lookup
nodes:
  - id: lookup
    type: toolkit
    toolkit_name: Customer Support
    tool: search_records
    input_mapping:
      query: {type: fstring, value: "ticket {ticket_id}"}
      filters: {type: variable, value: filters}
    input: [ticket_id, filters]
    output: [report, messages]
    structured_output: true
    transition: END
"#,
    )
    .expect("pipeline with Toolkit node");
    let (resolver, capture) = fixture_runtime(
        json!({
            "report": {"id": 9},
            "messages": [{"role":"assistant","content":"read complete"}]
        }),
        true,
    );
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let graph = definition
        .compile_with_runtime(
            "pipeline-root",
            checkpointer.clone(),
            None,
            &PipelineNodeRuntimes::new(None, Some(resolver)),
        )
        .expect("compiled Toolkit graph");
    let sessions = Arc::new(InMemorySessionService::new());
    sessions
        .create(CreateRequest {
            app_name: "elitea".to_owned(),
            user_id: "user-1".to_owned(),
            session_id: Some("toolkit-pipeline-thread".to_owned()),
            state: HashMap::new(),
        })
        .await
        .expect("pipeline session");
    let session_service: Arc<dyn SessionService> = sessions;
    let runner = Runner::builder()
        .app_name("elitea")
        .agent(Arc::new(EliteaGraphAgent::new(graph)))
        .session_service(session_service)
        .build()
        .expect("pipeline runner");
    let mut running = NativeAgentInvocation::new(
        runner,
        UserId::new("user-1").expect("fixture user"),
        SessionId::new("toolkit-pipeline-thread").expect("fixture session"),
        Content::new("user").with_text("lookup"),
    )
    .start()
    .expect("Toolkit pipeline invocation");
    let mut final_text = None;
    while let Some(event) = running.next_event().await.expect("pipeline event") {
        final_text = event.content().map(|content| {
            content
                .parts
                .iter()
                .filter_map(Part::text)
                .collect::<Vec<_>>()
                .join("")
        });
    }
    assert_eq!(final_text.as_deref(), Some("{\"id\":9}"));
    assert_eq!(capture.lock().expect("capture lock").calls, 1);
    let checkpoint = checkpointer
        .load("toolkit-pipeline-thread")
        .await
        .expect("checkpoint load")
        .expect("Toolkit graph checkpoint");
    assert_eq!(checkpoint.state.get("report"), Some(&json!({"id": 9})));
    assert_eq!(
        checkpoint.state.get("messages"),
        Some(&json!([
            {"role":"user","content":"lookup"},
            {"role":"assistant","content":"read complete"}
        ]))
    );
}
