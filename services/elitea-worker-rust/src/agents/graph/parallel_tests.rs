use std::collections::HashMap;
use std::fmt::Write as _;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use adk_rust::graph::checkpoint::{Checkpointer, MemoryCheckpointer};
use adk_rust::graph::{
    CompiledGraph, ExecutionConfig, GraphError, Node, NodeContext, NodeOutput, START, State,
    StateGraph,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::{Mutex, Notify, Semaphore, mpsc};

use super::parallel::{
    AdkParallelBranchRuntime, DurableParallelNode, ParallelActivation, ParallelBranchGraphFactory,
    ParallelChildCheckpoint, ParallelChildCheckpointerFactory, projected_input_digest,
};
use super::{ParallelBranchDefinition, ParallelNodeDefinition};

type BehaviorFuture = Pin<Box<dyn Future<Output = Result<Value, GraphError>> + Send>>;
type Behavior = Arc<dyn Fn() -> BehaviorFuture + Send + Sync>;

#[derive(Default)]
struct MemoryChildCheckpoints {
    stores: Mutex<HashMap<String, Arc<MemoryCheckpointer>>>,
    issued_threads: Mutex<Vec<String>>,
}

#[async_trait]
impl ParallelChildCheckpointerFactory for MemoryChildCheckpoints {
    async fn for_branch(
        &self,
        activation: &ParallelActivation,
        branch: &ParallelBranchDefinition,
        ordinal: usize,
        input_digest: &[u8; 32],
    ) -> Result<ParallelChildCheckpoint, GraphError> {
        let thread_id = format!(
            "test:{}:{}:{}:{}:{ordinal}:{input_digest:?}",
            activation.root_thread_id,
            activation.node_id,
            activation.step,
            branch.id(),
        );
        let mut stores = self.stores.lock().await;
        let store = Arc::clone(
            stores
                .entry(thread_id.clone())
                .or_insert_with(|| Arc::new(MemoryCheckpointer::new())),
        );
        self.issued_threads.lock().await.push(thread_id.clone());
        let checkpointer: Arc<dyn Checkpointer> = store;
        Ok(ParallelChildCheckpoint {
            thread_id,
            checkpointer,
        })
    }
}

struct TestBranchGraphs {
    behaviors: HashMap<String, Behavior>,
    rejected_target: Option<String>,
}

impl ParallelBranchGraphFactory for TestBranchGraphs {
    fn validate_branch(&self, branch: &ParallelBranchDefinition) -> Result<(), GraphError> {
        if self.rejected_target.as_deref() == Some(branch.node()) {
            return Err(GraphError::InvalidGraph(
                "parallel branches cannot contain pausing nodes in v1".to_owned(),
            ));
        }
        if !self.behaviors.contains_key(branch.node()) {
            return Err(GraphError::NodeNotFound(branch.node().to_owned()));
        }
        Ok(())
    }

    fn compile_branch(
        &self,
        branch: &ParallelBranchDefinition,
        checkpointer: Arc<dyn Checkpointer>,
    ) -> Result<CompiledGraph, GraphError> {
        let behavior = Arc::clone(
            self.behaviors
                .get(branch.node())
                .ok_or_else(|| GraphError::NodeNotFound(branch.node().to_owned()))?,
        );
        StateGraph::with_channels(&["branch_input", "branch_result"])
            .add_node_fn("run", move |_| {
                let behavior = Arc::clone(&behavior);
                async move {
                    let value = behavior().await?;
                    Ok(NodeOutput::new().with_update("branch_result", value))
                }
            })
            .add_edge(START, "run")
            .add_edge("run", adk_rust::graph::END)
            .compile()
            .map(|graph| {
                graph
                    .with_checkpointer_arc(checkpointer)
                    .with_strict_channels()
            })
    }

    fn project_input(
        &self,
        _branch: &ParallelBranchDefinition,
        parent: &State,
    ) -> Result<State, GraphError> {
        Ok(HashMap::from([(
            "branch_input".to_owned(),
            parent.get("input").cloned().unwrap_or(Value::Null),
        )]))
    }

    fn project_result(
        &self,
        _branch: &ParallelBranchDefinition,
        child: &State,
    ) -> Result<Value, GraphError> {
        child.get("branch_result").cloned().ok_or_else(|| {
            GraphError::SerializationError("branch result projection is missing".to_owned())
        })
    }
}

fn definition(branches: &[(&str, &str)], max_concurrency: usize) -> ParallelNodeDefinition {
    let branches = branches.iter().fold(String::new(), |mut yaml, (id, node)| {
        write!(yaml, "  - id: {id}\n    node: {node}\n").expect("write YAML fixture");
        yaml
    });
    ParallelNodeDefinition::from_yaml(&format!(
        "id: gather\ntype: parallel\nbranches:\n{branches}max_concurrency: {max_concurrency}\nwait: all\nerror_policy: fail_after_drain\noutput: [gathered]\ntransition: END\n"
    ))
    .expect("valid parallel definition")
}

fn runtime(
    checkpoints: Arc<MemoryChildCheckpoints>,
    behaviors: HashMap<String, Behavior>,
) -> Arc<AdkParallelBranchRuntime> {
    let checkpoint_factory: Arc<dyn ParallelChildCheckpointerFactory> = checkpoints;
    let graph_factory: Arc<dyn ParallelBranchGraphFactory> = Arc::new(TestBranchGraphs {
        behaviors,
        rejected_target: None,
    });
    Arc::new(AdkParallelBranchRuntime::new(
        checkpoint_factory,
        graph_factory,
    ))
}

fn parent_graph(
    definition: ParallelNodeDefinition,
    runtime: Arc<AdkParallelBranchRuntime>,
) -> CompiledGraph {
    StateGraph::with_channels(&["input", "gathered"])
        .add_node(DurableParallelNode::new(definition, runtime))
        .add_edge(START, "gather")
        .add_edge("gather", adk_rust::graph::END)
        .compile()
        .expect("compile parent graph")
        .with_strict_channels()
}

fn constant(value: Value) -> Behavior {
    Arc::new(move || {
        let value = value.clone();
        Box::pin(async move { Ok(value) })
    })
}

#[test]
fn projected_input_digest_is_canonical_and_type_exact() {
    let mut nested_forward = serde_json::Map::new();
    nested_forward.insert("a".to_owned(), json!(1));
    nested_forward.insert("b".to_owned(), json!(2));
    let mut nested_reverse = serde_json::Map::new();
    nested_reverse.insert("b".to_owned(), json!(2));
    nested_reverse.insert("a".to_owned(), json!(1));

    let forward = HashMap::from([
        ("nested".to_owned(), Value::Object(nested_forward)),
        ("number".to_owned(), json!(1.0)),
    ]);
    let reverse = HashMap::from([
        ("number".to_owned(), json!(1.0)),
        ("nested".to_owned(), Value::Object(nested_reverse)),
    ]);
    let integer = HashMap::from([
        ("nested".to_owned(), json!({"a": 1, "b": 2})),
        ("number".to_owned(), json!(1)),
    ]);

    let digest = projected_input_digest(&forward).expect("digest canonical projected input");
    assert_eq!(
        digest,
        projected_input_digest(&reverse).expect("digest reordered projected input")
    );
    assert_ne!(
        digest,
        projected_input_digest(&integer).expect("digest integer projected input")
    );
    assert_eq!(
        digest,
        [
            56, 133, 28, 29, 234, 49, 17, 147, 54, 253, 80, 146, 101, 78, 38, 150, 197, 56, 159,
            224, 121, 75, 124, 245, 100, 59, 191, 160, 153, 46, 75, 143,
        ]
    );
}

#[test]
fn parallel_yaml_contract_is_strict_and_ui_shaped() {
    let definition = definition(&[("source_a", "fetch_a"), ("source_b", "fetch_b")], 2);

    assert_eq!(definition.id(), "gather");
    assert_eq!(definition.branches().len(), 2);
    assert_eq!(definition.max_concurrency(), 2);
    assert_eq!(definition.output_key(), "gathered");
    assert_eq!(definition.transition(), Some("END"));

    for unsupported in ["one", "many"] {
        let yaml = format!(
            "id: gather\ntype: parallel\nbranches:\n  - id: a\n    node: fetch_a\n  - id: b\n    node: fetch_b\nmax_concurrency: 2\nwait: {unsupported}\noutput: [gathered]\n"
        );
        assert!(ParallelNodeDefinition::from_yaml(&yaml).is_err());
    }
    for invalid in [
        "id: gather\ntype: parallel\nbranches: [{id: a, node: x}, {id: a, node: y}]\nmax_concurrency: 2\nwait: all\noutput: [gathered]\n",
        "id: gather\ntype: parallel\nbranches: [{id: a, node: x}, {id: b, node: y}]\nmax_concurrency: 3\nwait: all\noutput: [gathered]\n",
        "id: gather\ntype: parallel\nbranches: [{id: a, node: x}, {id: b, node: y}]\nmax_concurrency: 2\nwait: all\noutput: []\n",
        "id: gather\ntype: parallel\nbranches: [{id: a, node: x}, {id: b, node: y}]\nmax_concurrency: 2\nwait: all\noutput: [one, two]\n",
    ] {
        assert!(ParallelNodeDefinition::from_yaml(invalid).is_err());
    }

    let oversized_branches = (0..65).fold(String::new(), |mut yaml, index| {
        write!(yaml, "  - id: branch-{index}\n    node: node-{index}\n")
            .expect("write oversized YAML fixture");
        yaml
    });
    let oversized_yaml = format!(
        "id: gather\ntype: parallel\nbranches:\n{oversized_branches}max_concurrency: 2\nwait: all\noutput: [gathered]\n"
    );
    assert!(ParallelNodeDefinition::from_yaml(&oversized_yaml).is_err());
}

#[tokio::test]
async fn declared_order_is_stable_when_branches_finish_in_reverse_order() {
    let release_first = Arc::new(Notify::new());
    let first_release = Arc::clone(&release_first);
    let first: Behavior = Arc::new(move || {
        let first_release = Arc::clone(&first_release);
        Box::pin(async move {
            first_release.notified().await;
            Ok(json!({"value": "first"}))
        })
    });
    let second_release = Arc::clone(&release_first);
    let second: Behavior = Arc::new(move || {
        let second_release = Arc::clone(&second_release);
        Box::pin(async move {
            second_release.notify_one();
            Ok(json!({"value": "second"}))
        })
    });
    let graph = parent_graph(
        definition(&[("a", "first"), ("b", "second")], 2),
        runtime(
            Arc::new(MemoryChildCheckpoints::default()),
            HashMap::from([("first".to_owned(), first), ("second".to_owned(), second)]),
        ),
    );

    let result = graph
        .invoke(
            HashMap::from([("input".to_owned(), json!("same"))]),
            ExecutionConfig::new("root-order"),
        )
        .await
        .expect("parallel graph result");

    assert_eq!(
        result["gathered"],
        json!([
            {"branch_id": "a", "node": "first", "result": {"value": "first"}},
            {"branch_id": "b", "node": "second", "result": {"value": "second"}},
        ])
    );
}

#[tokio::test]
async fn multiple_failures_drain_and_select_the_first_declared_branch() {
    let runs = Arc::new(AtomicUsize::new(0));
    let failing = |node: &'static str| {
        let runs = Arc::clone(&runs);
        Arc::new(move || {
            let runs = Arc::clone(&runs);
            Box::pin(async move {
                runs.fetch_add(1, Ordering::SeqCst);
                Err(GraphError::NodeExecutionFailed {
                    node: node.to_owned(),
                    message: "fixture failure".to_owned(),
                })
            }) as BehaviorFuture
        }) as Behavior
    };
    let graph = parent_graph(
        definition(&[("a", "first"), ("b", "second")], 2),
        runtime(
            Arc::new(MemoryChildCheckpoints::default()),
            HashMap::from([
                ("first".to_owned(), failing("first")),
                ("second".to_owned(), failing("second")),
            ]),
        ),
    );

    let error = graph
        .invoke(State::new(), ExecutionConfig::new("root-errors"))
        .await
        .expect_err("parallel graph must report a branch failure");

    assert_eq!(runs.load(Ordering::SeqCst), 2);
    match error {
        GraphError::NodeExecutionFailed { message, .. } => {
            assert!(message.contains("branch 'a'"));
            assert!(!message.contains("branch 'b'"));
        }
        other => panic!("unexpected parallel failure: {other}"),
    }
}

#[tokio::test]
async fn failure_stops_later_admission_at_concurrency_one() {
    let later_runs = Arc::new(AtomicUsize::new(0));
    let later_counter = Arc::clone(&later_runs);
    let later: Behavior = Arc::new(move || {
        let later_counter = Arc::clone(&later_counter);
        Box::pin(async move {
            later_counter.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"unexpected": true}))
        })
    });
    let first: Behavior = Arc::new(|| {
        Box::pin(async {
            Err(GraphError::NodeExecutionFailed {
                node: "first".to_owned(),
                message: "fixture failure".to_owned(),
            })
        })
    });
    let graph = parent_graph(
        definition(&[("first", "first"), ("later", "later")], 1),
        runtime(
            Arc::new(MemoryChildCheckpoints::default()),
            HashMap::from([("first".to_owned(), first), ("later".to_owned(), later)]),
        ),
    );

    assert!(
        graph
            .invoke(State::new(), ExecutionConfig::new("root-stop-admission"))
            .await
            .is_err()
    );
    assert_eq!(later_runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn failure_drains_a_slow_inflight_sibling_without_admitting_pending_work() {
    let (entered_tx, mut entered_rx) = mpsc::channel(1);
    let release = Arc::new(Semaphore::new(0));
    let slow_release = Arc::clone(&release);
    let slow: Behavior = Arc::new(move || {
        let entered_tx = entered_tx.clone();
        let slow_release = Arc::clone(&slow_release);
        Box::pin(async move {
            entered_tx
                .send(())
                .await
                .map_err(|_| GraphError::Other("observer closed".to_owned()))?;
            slow_release
                .acquire()
                .await
                .map_err(|_| GraphError::Other("release closed".to_owned()))?
                .forget();
            Ok(json!({"drained": true}))
        })
    });
    let first: Behavior = Arc::new(|| {
        Box::pin(async {
            Err(GraphError::NodeExecutionFailed {
                node: "first".to_owned(),
                message: "fixture failure".to_owned(),
            })
        })
    });
    let pending_runs = Arc::new(AtomicUsize::new(0));
    let pending_counter = Arc::clone(&pending_runs);
    let pending: Behavior = Arc::new(move || {
        let pending_counter = Arc::clone(&pending_counter);
        Box::pin(async move {
            pending_counter.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"unexpected": true}))
        })
    });
    let graph = parent_graph(
        definition(
            &[("first", "first"), ("slow", "slow"), ("pending", "pending")],
            2,
        ),
        runtime(
            Arc::new(MemoryChildCheckpoints::default()),
            HashMap::from([
                ("first".to_owned(), first),
                ("slow".to_owned(), slow),
                ("pending".to_owned(), pending),
            ]),
        ),
    );
    let run = tokio::spawn(async move {
        graph
            .invoke(State::new(), ExecutionConfig::new("root-inflight-drain"))
            .await
    });

    tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
        .await
        .expect("slow sibling entry wait")
        .expect("slow sibling entry");
    assert!(!run.is_finished());
    release.add_permits(1);
    assert!(run.await.expect("parallel graph task").is_err());
    assert_eq!(pending_runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn retry_reuses_same_input_checkpoint_and_changed_input_mints_a_new_lineage() {
    let checkpoints = Arc::new(MemoryChildCheckpoints::default());
    let short_runs = Arc::new(AtomicUsize::new(0));
    let short_counter = Arc::clone(&short_runs);
    let short: Behavior = Arc::new(move || {
        let short_counter = Arc::clone(&short_counter);
        Box::pin(async move {
            short_counter.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"value": "short"}))
        })
    });
    let long_runs = Arc::new(AtomicUsize::new(0));
    let long_counter = Arc::clone(&long_runs);
    let long: Behavior = Arc::new(move || {
        let long_counter = Arc::clone(&long_counter);
        Box::pin(async move {
            if long_counter.fetch_add(1, Ordering::SeqCst) == 0 {
                Err(GraphError::NodeExecutionFailed {
                    node: "long".to_owned(),
                    message: "fixture failure".to_owned(),
                })
            } else {
                Ok(json!({"value": "long"}))
            }
        })
    });
    let behaviors = HashMap::from([("short".to_owned(), short), ("long".to_owned(), long)]);
    let definition = definition(&[("short", "short"), ("long", "long")], 2);

    let first = parent_graph(
        definition.clone(),
        runtime(Arc::clone(&checkpoints), behaviors.clone()),
    );
    assert!(
        first
            .invoke(
                HashMap::from([("input".to_owned(), json!("original"))]),
                ExecutionConfig::new("root-restart"),
            )
            .await
            .is_err()
    );

    let recreated = parent_graph(
        definition.clone(),
        runtime(Arc::clone(&checkpoints), behaviors.clone()),
    );
    let same_input = recreated
        .invoke(
            HashMap::from([("input".to_owned(), json!("original"))]),
            ExecutionConfig::new("root-restart"),
        )
        .await
        .expect("restart completes missing branch");

    assert_eq!(short_runs.load(Ordering::SeqCst), 1);
    assert_eq!(long_runs.load(Ordering::SeqCst), 2);
    assert_eq!(
        same_input["gathered"][0]["result"],
        json!({"value": "short"})
    );

    let changed = parent_graph(definition, runtime(checkpoints, behaviors))
        .invoke(
            HashMap::from([("input".to_owned(), json!("changed-after-restart"))]),
            ExecutionConfig::new("root-restart"),
        )
        .await
        .expect("changed input runs a distinct child lineage");
    assert_eq!(short_runs.load(Ordering::SeqCst), 2);
    assert_eq!(long_runs.load(Ordering::SeqCst), 3);
    assert_eq!(changed["gathered"].as_array().map(Vec::len), Some(2));
}

#[tokio::test]
async fn admission_bound_is_structural_and_all_started_branches_drain() {
    const WIDTH: usize = 4;
    const LIMIT: usize = 2;
    let (entered_tx, mut entered_rx) = mpsc::channel(WIDTH);
    let release = Arc::new(Semaphore::new(0));
    let mut behaviors = HashMap::new();
    let mut branches = Vec::new();
    for index in 0..WIDTH {
        let entered = entered_tx.clone();
        let permits = Arc::clone(&release);
        let behavior: Behavior = Arc::new(move || {
            let entered = entered.clone();
            let permits = Arc::clone(&permits);
            Box::pin(async move {
                entered
                    .send(index)
                    .await
                    .map_err(|_| GraphError::Other("observer closed".to_owned()))?;
                permits
                    .acquire()
                    .await
                    .map_err(|_| GraphError::Other("release closed".to_owned()))?
                    .forget();
                Ok(json!({"index": index}))
            })
        });
        let name = format!("node-{index}");
        behaviors.insert(name.clone(), behavior);
        branches.push((format!("branch-{index}"), name));
    }
    drop(entered_tx);
    let branch_refs = branches
        .iter()
        .map(|(branch, node)| (branch.as_str(), node.as_str()))
        .collect::<Vec<_>>();
    let graph = parent_graph(
        definition(&branch_refs, LIMIT),
        runtime(Arc::new(MemoryChildCheckpoints::default()), behaviors),
    );
    let run = tokio::spawn(async move {
        graph
            .invoke(State::new(), ExecutionConfig::new("root-bounded"))
            .await
    });

    for _ in 0..LIMIT {
        tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
            .await
            .expect("bounded entry wait")
            .expect("entry observer");
    }
    assert!(entered_rx.try_recv().is_err());
    release.add_permits(LIMIT);
    for _ in LIMIT..WIDTH {
        tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
            .await
            .expect("next bounded entry wait")
            .expect("entry observer");
    }
    release.add_permits(WIDTH - LIMIT);

    let result = run
        .await
        .expect("parallel graph task")
        .expect("parallel result");
    assert_eq!(result["gathered"].as_array().map(Vec::len), Some(WIDTH));
}

#[tokio::test]
async fn loop_visits_get_distinct_child_checkpoint_threads() {
    let checkpoints = Arc::new(MemoryChildCheckpoints::default());
    let runtime = runtime(
        Arc::clone(&checkpoints),
        HashMap::from([
            ("one".to_owned(), constant(json!({"value": 1}))),
            ("two".to_owned(), constant(json!({"value": 2}))),
        ]),
    );
    let node = DurableParallelNode::new(definition(&[("a", "one"), ("b", "two")], 2), runtime);

    node.execute(&NodeContext::new(
        State::new(),
        ExecutionConfig::new("root-loop"),
        3,
    ))
    .await
    .expect("first loop visit");
    node.execute(&NodeContext::new(
        State::new(),
        ExecutionConfig::new("root-loop"),
        7,
    ))
    .await
    .expect("second loop visit");

    let threads = checkpoints.issued_threads.lock().await;
    assert_eq!(threads.len(), 4);
    assert_ne!(threads[0], threads[2]);
    assert_ne!(threads[1], threads[3]);
}

#[test]
fn pausing_branch_is_rejected_before_the_parent_graph_runs() {
    let definition = definition(&[("a", "safe"), ("b", "pause")], 2);
    let checkpoint_factory: Arc<dyn ParallelChildCheckpointerFactory> =
        Arc::new(MemoryChildCheckpoints::default());
    let graph_factory: Arc<dyn ParallelBranchGraphFactory> = Arc::new(TestBranchGraphs {
        behaviors: HashMap::from([
            ("safe".to_owned(), constant(json!({"ok": true}))),
            ("pause".to_owned(), constant(json!({"unused": true}))),
        ]),
        rejected_target: Some("pause".to_owned()),
    });
    let runtime = Arc::new(AdkParallelBranchRuntime::new(
        checkpoint_factory,
        graph_factory,
    ));

    assert!(
        StateGraph::with_channels(&["gathered"])
            .add_node(DurableParallelNode::new(definition, runtime))
            .add_edge(START, "gather")
            .add_edge("gather", adk_rust::graph::END)
            .compile()
            .is_err()
    );
}
