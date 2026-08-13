use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use adk_rust::agent::LlmAgentBuilder;
use adk_rust::futures::StreamExt;
use adk_rust::graph::{
    DeferredNodeConfig, END, ExecutionConfig, MergeStrategy, NodeOutput, START, State, StateGraph,
};
use adk_rust::model::MockLlm;
use adk_rust::runner::Runner;
use adk_rust::session::{CreateRequest, InMemorySessionService, SessionService};
use adk_rust::tool::{BasicToolset, FunctionTool, SimpleToolContext};
use adk_rust::{
    Content, LlmResponse, ReadonlyContext, SessionId, Tool, ToolContext, Toolset, UserId,
};
use serde_json::json;
use tokio::sync::{Semaphore, mpsc};

#[tokio::test]
async fn native_model_agent_session_and_runner_execute_without_provider_credentials() {
    let model = Arc::new(
        MockLlm::new("elitea-fixture").with_response(LlmResponse::new(
            Content::new("assistant").with_text("native-adk"),
        )),
    );
    let agent = Arc::new(
        LlmAgentBuilder::new("elitea-agent")
            .model(model)
            .build()
            .expect("fixture agent"),
    );
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    sessions
        .create(CreateRequest {
            app_name: "elitea".to_owned(),
            user_id: "user-1".to_owned(),
            session_id: Some("session-1".to_owned()),
            state: HashMap::new(),
        })
        .await
        .expect("fixture session");
    let runner = Runner::builder()
        .app_name("elitea")
        .agent(agent)
        .session_service(Arc::clone(&sessions))
        .build()
        .expect("fixture runner");

    let mut events = runner
        .run(
            UserId::new("user-1").expect("fixture user"),
            SessionId::new("session-1").expect("fixture session ID"),
            Content::new("user").with_text("run"),
        )
        .await
        .expect("runner stream");
    let mut text = String::new();
    while let Some(event) = events.next().await {
        let event = event.expect("runner event");
        if let Some(content) = event.llm_response.content {
            for part in content.parts {
                if let Some(value) = part.text() {
                    text.push_str(value);
                }
            }
        }
    }

    assert_eq!(text, "native-adk");
}

#[tokio::test]
async fn native_function_tool_executes_through_a_basic_toolset() {
    let double: Arc<dyn Tool> = Arc::new(
        FunctionTool::new(
            "double",
            "Double an integer",
            |context, arguments| async move {
                let value = arguments["value"].as_i64().expect("fixture integer");
                Ok(json!({
                    "call_id": context.function_call_id(),
                    "value": value * 2,
                }))
            },
        )
        .with_read_only(true)
        .with_concurrency_safe(true),
    );
    let toolset = BasicToolset::new("elitea-fixture", vec![double]);
    let context = Arc::new(
        SimpleToolContext::new("elitea-test")
            .with_session_id("session-1")
            .with_function_call_id("call-1"),
    );
    let readonly: Arc<dyn ReadonlyContext> = context.clone();
    let tools = toolset.tools(readonly).await.expect("fixture tool catalog");

    assert_eq!(toolset.name(), "elitea-fixture");
    assert_eq!(tools.len(), 1);
    assert!(tools[0].is_read_only());
    assert!(tools[0].is_concurrency_safe());

    let invocation: Arc<dyn ToolContext> = context;
    let result = tools[0]
        .execute(invocation, json!({"value": 21}))
        .await
        .expect("fixture tool result");

    assert_eq!(result, json!({"call_id": "call-1", "value": 42}));
}

#[tokio::test]
async fn native_graph_fork_join_waits_for_unequal_branches_and_joins_once() {
    let graph = StateGraph::with_channels(&["short", "long", "join_runs", "saw_both"])
        .add_node_fn("long-start", |_| async {
            Ok(NodeOutput::new().with_update("long", json!("started")))
        })
        .add_node_fn("long-finish", |_| async {
            Ok(NodeOutput::new().with_update("long", json!("finished")))
        })
        .add_node_fn("short", |_| async {
            Ok(NodeOutput::new().with_update("short", json!("finished")))
        })
        .add_deferred_node_fn(
            "join",
            |context| async move {
                let join_runs = context
                    .get("join_runs")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0)
                    + 1;
                let saw_both = context.get("long") == Some(&json!("finished"))
                    && context.get("short") == Some(&json!("finished"));
                Ok(NodeOutput::new()
                    .with_update("join_runs", json!(join_runs))
                    .with_update("saw_both", json!(saw_both)))
            },
            DeferredNodeConfig {
                merge_strategy: MergeStrategy::Collect,
                fan_in_timeout: None,
                ..DeferredNodeConfig::default()
            },
        )
        .add_edge(START, "long-start")
        .add_edge(START, "short")
        .add_edge("long-start", "long-finish")
        .add_edge("long-finish", "join")
        .add_edge("short", "join")
        .add_edge("join", END)
        .compile()
        .expect("fixture graph")
        .with_max_concurrency(2);

    let result = graph
        .invoke(State::new(), ExecutionConfig::new("fork-join"))
        .await
        .expect("fixture graph result");

    assert_eq!(result.get("join_runs"), Some(&json!(1)));
    assert_eq!(result.get("saw_both"), Some(&json!(true)));
}

#[tokio::test]
async fn native_graph_frontier_never_exceeds_the_configured_bound() {
    const WIDTH: usize = 4;
    const LIMIT: usize = 2;

    let (entered_tx, mut entered_rx) = mpsc::channel(WIDTH);
    let release = Arc::new(Semaphore::new(0));
    let mut graph = StateGraph::with_channels(&["done"]);
    for index in 0..WIDTH {
        let node = format!("branch-{index}");
        let entered_tx = entered_tx.clone();
        let release = Arc::clone(&release);
        graph = graph.add_node_fn(&node, move |_| {
            let entered_tx = entered_tx.clone();
            let release = Arc::clone(&release);
            async move {
                entered_tx.send(index).await.expect("entry observer");
                release.acquire().await.expect("release permit").forget();
                Ok(NodeOutput::new().with_update("done", json!(true)))
            }
        });
        graph = graph.add_edge(START, &node).add_edge(&node, END);
    }
    drop(entered_tx);
    let graph = graph
        .compile()
        .expect("fixture graph")
        .with_max_concurrency(LIMIT);
    let run = tokio::spawn(async move {
        graph
            .invoke(State::new(), ExecutionConfig::new("bounded-frontier"))
            .await
    });

    for _ in 0..LIMIT {
        tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
            .await
            .expect("bounded entry wait")
            .expect("entry observer remains open");
    }
    assert!(entered_rx.try_recv().is_err());

    release.add_permits(LIMIT);
    for _ in LIMIT..WIDTH {
        tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
            .await
            .expect("next bounded entry wait")
            .expect("entry observer remains open");
    }
    release.add_permits(WIDTH - LIMIT);

    run.await
        .expect("graph task")
        .expect("bounded graph result");
}
