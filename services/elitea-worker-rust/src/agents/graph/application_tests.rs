use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use adk_rust::graph::{Checkpointer, ExecutionConfig, MemoryCheckpointer, Node, NodeContext};
use adk_rust::runner::Runner;
use adk_rust::session::{CreateRequest, InMemorySessionService, SessionService};
use adk_rust::{Content, Part, SessionId, Tool, ToolContext, UserId};
use async_trait::async_trait;
use serde_json::{Value, json};

use super::EliteaGraphAgent;
use super::application::{
    ApplicationExecutionError, ApplicationNode, ApplicationNodeDefinition,
    PipelineApplicationResolver, PipelineApplicationSelection,
};
use super::compiler::{PipelineDefinition, PipelineNodeRuntimes};
use crate::agents::runtime::NativeAgentInvocation;

#[derive(Default)]
struct InvocationCapture {
    arguments: Value,
    function_call_id: String,
    calls: usize,
}

struct FixtureApplicationTool {
    response: Value,
    capture: Arc<Mutex<InvocationCapture>>,
}

#[async_trait]
impl Tool for FixtureApplicationTool {
    fn name(&self) -> &'static str {
        "application_41_7"
    }

    fn description(&self) -> &'static str {
        "saved Application fixture"
    }

    async fn execute(
        &self,
        context: Arc<dyn ToolContext>,
        arguments: Value,
    ) -> adk_rust::Result<Value> {
        let mut capture = self.capture.lock().expect("capture lock");
        capture.arguments = arguments;
        capture.function_call_id = context.function_call_id().to_owned();
        capture.calls += 1;
        Ok(self.response.clone())
    }
}

struct FixtureApplicationResolver {
    alias: String,
    tool: Arc<dyn Tool>,
}

impl PipelineApplicationResolver for FixtureApplicationResolver {
    fn resolve(
        &self,
        selection: &PipelineApplicationSelection,
    ) -> Result<Arc<dyn Tool>, ApplicationExecutionError> {
        if selection.alias() == self.alias {
            Ok(Arc::clone(&self.tool))
        } else {
            Err(ApplicationExecutionError::Unavailable)
        }
    }
}

fn fixture_resolver(
    response: Value,
) -> (
    Arc<dyn PipelineApplicationResolver>,
    Arc<Mutex<InvocationCapture>>,
) {
    let capture = Arc::new(Mutex::new(InvocationCapture::default()));
    let tool: Arc<dyn Tool> = Arc::new(FixtureApplicationTool {
        response,
        capture: Arc::clone(&capture),
    });
    (
        Arc::new(FixtureApplicationResolver {
            alias: "Research Agent".to_owned(),
            tool,
        }),
        capture,
    )
}

const AGENT_NODE: &str = r#"
id: delegate
type: agent
tool: Research Agent
input_mapping:
  task: {type: fstring, value: "Investigate {topic}"}
input: [topic]
output: [answer, messages]
transition: END
"#;

#[tokio::test]
async fn agent_node_maps_one_task_and_projects_child_response() {
    let definition = ApplicationNodeDefinition::from_yaml(AGENT_NODE).expect("Agent node");
    assert_eq!(definition.id(), "delegate");
    assert_eq!(definition.selection().alias(), "Research Agent");
    assert_eq!(definition.input_keys(), ["topic"]);
    assert_eq!(definition.output_keys(), ["answer", "messages"]);
    assert_eq!(definition.transition(), Some("END"));
    assert!(definition.config_digest().iter().any(|byte| *byte != 0));

    let (resolver, capture) = fixture_resolver(json!({"response":"child result"}));
    let node = ApplicationNode::new(
        definition,
        BTreeMap::from([
            ("answer".to_owned(), "str".to_owned()),
            ("messages".to_owned(), "list".to_owned()),
        ]),
        resolver,
    );
    let output = node
        .execute(&NodeContext::new(
            HashMap::from([("topic".to_owned(), json!("payment failure"))]),
            ExecutionConfig::new("agent-node-thread"),
            0,
        ))
        .await
        .expect("Agent node execution");
    assert_eq!(output.updates.get("answer"), Some(&json!("child result")));
    assert_eq!(
        output.updates.get("messages"),
        Some(&json!([{"role":"assistant","content":"child result"}]))
    );
    let capture = capture.lock().expect("capture lock");
    assert_eq!(capture.calls, 1);
    assert_eq!(
        capture.arguments,
        json!({"task":"Investigate payment failure"})
    );
    assert_eq!(capture.function_call_id, "pipeline:delegate:0");
}

#[test]
fn agent_node_rejects_ambiguous_or_undeclared_contracts() {
    for yaml in [
        AGENT_NODE.replace("type: agent", "type: application"),
        AGENT_NODE.replace("tool: Research Agent", "tool: ''"),
        AGENT_NODE.replace(
            "task: {type: fstring, value: \"Investigate {topic}\"}",
            "prompt: {type: fixed, value: hi}",
        ),
        AGENT_NODE.replace(
            "task: {type: fstring, value: \"Investigate {topic}\"}",
            "task: {type: expression, value: topic}",
        ),
        AGENT_NODE.replace("output: [answer, messages]", "output: [answer, answer]"),
        AGENT_NODE.replace("transition: END", "transition: 'bad target'"),
        format!("{AGENT_NODE}\nvariables: {{}}"),
    ] {
        assert!(ApplicationNodeDefinition::from_yaml(&yaml).is_err());
    }

    let undeclared = PipelineDefinition::from_yaml(&format!(
        "state:\n  answer: str\nentry_point: delegate\nnodes:\n{}",
        indent_yaml(&AGENT_NODE.replace("input: [topic]", "input: [missing]"), 2)
    ));
    assert!(undeclared.is_err());
}

#[tokio::test]
async fn compiler_runs_saved_agent_through_the_common_runner() {
    let definition = PipelineDefinition::from_yaml(
        r#"
state:
  topic: {type: str, value: payment failure}
  answer: str
  messages: list
entry_point: delegate
nodes:
  - id: delegate
    type: agent
    tool: Research Agent
    input_mapping:
      task: {type: fstring, value: "Investigate {topic}"}
    input: [topic]
    output: [answer, messages]
    transition: END
"#,
    )
    .expect("pipeline with Agent node");
    assert!(definition.has_application_nodes());
    assert!(!definition.has_llm_nodes());
    assert_eq!(
        definition
            .application_selections()
            .map(PipelineApplicationSelection::alias)
            .collect::<Vec<_>>(),
        ["Research Agent"]
    );
    assert_eq!(
        definition.runtime_toolkit_aliases(),
        ["Research Agent".to_owned()].into_iter().collect()
    );
    assert!(
        definition
            .compile("pipeline-root", Arc::new(MemoryCheckpointer::new()), None,)
            .is_err()
    );

    let (resolver, capture) = fixture_resolver(json!({"response":"verified child answer"}));
    let checkpointer = Arc::new(MemoryCheckpointer::new());
    let graph = definition
        .compile_with_runtime(
            "pipeline-root",
            checkpointer.clone(),
            None,
            &PipelineNodeRuntimes::new(None, None, Some(resolver)),
        )
        .expect("compiled Agent graph");
    let sessions = Arc::new(InMemorySessionService::new());
    sessions
        .create(CreateRequest {
            app_name: "elitea".to_owned(),
            user_id: "user-1".to_owned(),
            session_id: Some("agent-pipeline-thread".to_owned()),
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
    let mut invocation = NativeAgentInvocation::new(
        runner,
        UserId::new("user-1").expect("fixture user"),
        SessionId::new("agent-pipeline-thread").expect("fixture session"),
        Content::new("user").with_text("delegate"),
    )
    .start()
    .expect("Agent pipeline invocation");
    let mut final_text = None;
    while let Some(event) = invocation.next_event().await.expect("pipeline event") {
        final_text = event.content().map(|content| {
            content
                .parts
                .iter()
                .filter_map(Part::text)
                .collect::<Vec<_>>()
                .join("")
        });
    }
    assert_eq!(final_text.as_deref(), Some("verified child answer"));
    assert_eq!(capture.lock().expect("capture lock").calls, 1);
    let checkpoint = checkpointer
        .load("agent-pipeline-thread")
        .await
        .expect("checkpoint load")
        .expect("Agent graph checkpoint");
    assert_eq!(
        checkpoint.state.get("answer"),
        Some(&json!("verified child answer"))
    );
}

#[tokio::test]
async fn agent_node_rejects_wrong_child_result_without_partial_state() {
    let definition = ApplicationNodeDefinition::from_yaml(AGENT_NODE).expect("Agent node");
    for response in [
        json!("plain response"),
        json!({"response": null}),
        json!({"response":"answer","extra":true}),
    ] {
        let (resolver, _) = fixture_resolver(response);
        let result = ApplicationNode::new(definition.clone(), BTreeMap::new(), resolver)
            .execute(&NodeContext::new(
                HashMap::from([("topic".to_owned(), json!("case"))]),
                ExecutionConfig::new("bad-agent-result"),
                0,
            ))
            .await;
        assert!(result.is_err());
    }
}

fn indent_yaml(value: &str, count: usize) -> String {
    let prefix = " ".repeat(count);
    value
        .lines()
        .map(|line| format!("{prefix}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}
