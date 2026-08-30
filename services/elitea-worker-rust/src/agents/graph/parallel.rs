#![allow(dead_code)] // Composed by the next full YAML graph compiler slice.

use std::collections::BTreeMap;
use std::io::{self, Write};
use std::sync::Arc;

use adk_rust::futures::{StreamExt, stream::FuturesUnordered};
use adk_rust::graph::checkpoint::Checkpointer;
use adk_rust::graph::{
    CompiledGraph, ExecutionConfig, GraphError, Node, NodeContext, NodeOutput, State,
};
use async_trait::async_trait;
use ring::digest;
use serde_json::{Value, json};

use super::yaml::{ParallelBranchDefinition, ParallelNodeDefinition};

const MAX_BRANCH_INPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_BRANCH_RESULT_BYTES: usize = 1024 * 1024;
const MAX_JOINED_RESULT_BYTES: usize = 8 * 1024 * 1024;
const BRANCH_INPUT_DIGEST_DOMAIN: &[u8] = b"elitea.graph.parallel.branch-input.v1\0";

/// Stable activation of one parallel node visit.
///
/// The ADK step is restored unchanged while the node remains pending and moves
/// forward before a later loop visit. The child checkpoint factory adds its
/// opaque execution/generation/definition scope before deriving a child thread.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ParallelActivation {
    pub(crate) root_thread_id: String,
    pub(crate) node_id: String,
    pub(crate) step: u64,
    pub(crate) config_digest: [u8; 32],
}

impl ParallelActivation {
    fn from_context(
        definition: &ParallelNodeDefinition,
        context: &NodeContext,
    ) -> Result<Self, GraphError> {
        if context.config.thread_id.is_empty() || context.config.thread_id.len() > 512 {
            return Err(parallel_error(
                "graph.parallel.invalid_invocation",
                "the root thread is malformed",
            ));
        }
        let step = u64::try_from(context.step).map_err(|_| {
            parallel_error(
                "graph.parallel.resource_exhausted",
                "the activation step exceeds its durable range",
            )
        })?;
        Ok(Self {
            root_thread_id: context.config.thread_id.clone(),
            node_id: definition.id().to_owned(),
            step,
            config_digest: definition.config_digest(),
        })
    }
}

/// A child-thread checkpointer minted from the current opaque graph authority.
///
/// The thread ID is safe routing metadata. The checkpointer remains the sole
/// state authority and is bound to that exact descendant thread.
pub(crate) struct ParallelChildCheckpoint {
    pub(crate) thread_id: String,
    pub(crate) checkpointer: Arc<dyn Checkpointer>,
}

#[async_trait]
pub(crate) trait ParallelChildCheckpointerFactory: Send + Sync {
    async fn for_branch(
        &self,
        activation: &ParallelActivation,
        branch: &ParallelBranchDefinition,
        ordinal: usize,
        input_digest: &[u8; 32],
    ) -> Result<ParallelChildCheckpoint, GraphError>;
}

/// Compiler seam for one independently checkpointed branch graph.
///
/// Production implementations are created by the YAML compiler from admitted
/// node definitions. V1 must reject branch plans that can pause for HITL,
/// sensitive-tool confirmation or MCP authorization: ADK's inner interrupt can
/// be checkpointed before the parent publishes its interrupt, and that crash
/// gap needs a separate durable interrupt ledger.
pub(crate) trait ParallelBranchGraphFactory: Send + Sync {
    fn validate_branch(&self, branch: &ParallelBranchDefinition) -> Result<(), GraphError>;

    fn compile_branch(
        &self,
        branch: &ParallelBranchDefinition,
        checkpointer: Arc<dyn Checkpointer>,
    ) -> Result<CompiledGraph, GraphError>;

    fn project_input(
        &self,
        branch: &ParallelBranchDefinition,
        parent: &State,
    ) -> Result<State, GraphError>;

    fn project_result(
        &self,
        branch: &ParallelBranchDefinition,
        child: &State,
    ) -> Result<Value, GraphError>;
}

#[async_trait]
pub(crate) trait ParallelBranchRuntime: Send + Sync {
    fn validate(&self, definition: &ParallelNodeDefinition) -> Result<(), GraphError>;

    async fn invoke(
        &self,
        activation: &ParallelActivation,
        branch: &ParallelBranchDefinition,
        ordinal: usize,
        context: &NodeContext,
    ) -> Result<Value, GraphError>;
}

/// ADK-native branch runner with one terminal checkpoint lineage per branch.
pub(crate) struct AdkParallelBranchRuntime {
    checkpoints: Arc<dyn ParallelChildCheckpointerFactory>,
    graphs: Arc<dyn ParallelBranchGraphFactory>,
}

impl AdkParallelBranchRuntime {
    pub(crate) fn new(
        checkpoints: Arc<dyn ParallelChildCheckpointerFactory>,
        graphs: Arc<dyn ParallelBranchGraphFactory>,
    ) -> Self {
        Self {
            checkpoints,
            graphs,
        }
    }
}

#[async_trait]
impl ParallelBranchRuntime for AdkParallelBranchRuntime {
    fn validate(&self, definition: &ParallelNodeDefinition) -> Result<(), GraphError> {
        for branch in definition.branches() {
            self.graphs.validate_branch(branch)?;
        }
        Ok(())
    }

    async fn invoke(
        &self,
        activation: &ParallelActivation,
        branch: &ParallelBranchDefinition,
        ordinal: usize,
        context: &NodeContext,
    ) -> Result<Value, GraphError> {
        let input = self.graphs.project_input(branch, &context.state)?;
        let input_digest = projected_input_digest(&input)?;
        let child = self
            .checkpoints
            .for_branch(activation, branch, ordinal, &input_digest)
            .await?;
        let graph = self
            .graphs
            .compile_branch(branch, Arc::clone(&child.checkpointer))?;
        let mut config = ExecutionConfig::new(&child.thread_id)
            .with_recursion_limit(context.config.recursion_limit);
        if let Some(parent) = &context.config.parent_context {
            config = config.with_parent_context(Arc::clone(parent));
        }
        let outcome = graph.invoke_detailed(input, config).await?;
        if outcome.goto_parent.is_some() {
            return Err(parallel_error(
                "graph.parallel.unsupported_parent_route",
                "a parallel branch cannot route the parent graph directly",
            ));
        }
        let result = self.graphs.project_result(branch, &outcome.state)?;
        ensure_bounded_json(&result, MAX_BRANCH_RESULT_BYTES, "branch result")?;
        Ok(result)
    }
}

/// ADK custom node implementing bounded, deterministic `wait: all`.
///
/// Every branch is a small independently checkpointed ADK graph. ADK writes its
/// empty-frontier terminal checkpoint before `invoke_detailed` returns. If the
/// parent process then dies, replaying the same activation loads completed
/// branches without invoking their nodes again. External effects still need a
/// stable effect identity because a process can die after an effect but before
/// the branch graph reaches its checkpoint.
pub(crate) struct DurableParallelNode {
    definition: ParallelNodeDefinition,
    runtime: Arc<dyn ParallelBranchRuntime>,
}

impl DurableParallelNode {
    pub(crate) fn new(
        definition: ParallelNodeDefinition,
        runtime: Arc<dyn ParallelBranchRuntime>,
    ) -> Self {
        Self {
            definition,
            runtime,
        }
    }

    async fn execute_inner(&self, context: &NodeContext) -> Result<NodeOutput, GraphError> {
        let activation = ParallelActivation::from_context(&self.definition, context)?;
        let max_concurrency = usize::try_from(self.definition.max_concurrency()).map_err(|_| {
            GraphError::NodeExecutionFailed {
                node: self.definition.id().to_owned(),
                message: "graph.parallel.invalid_configuration: max_concurrency does not fit this platform"
                    .to_owned(),
            }
        })?;
        let mut pending = self.definition.branches().iter().cloned().enumerate();
        let mut inflight = FuturesUnordered::new();
        for _ in 0..max_concurrency {
            if let Some((ordinal, branch)) = pending.next() {
                inflight.push(self.invoke_branch(activation.clone(), ordinal, branch, context));
            }
        }

        let mut ordered = Vec::with_capacity(self.definition.branches().len());
        let mut admission_open = true;
        while let Some(outcome) = inflight.next().await {
            if outcome.2.is_err() {
                admission_open = false;
            }
            ordered.push(outcome);
            if admission_open && let Some((ordinal, branch)) = pending.next() {
                inflight.push(self.invoke_branch(activation.clone(), ordinal, branch, context));
            }
        }

        ordered.sort_by_key(|(ordinal, _, _)| *ordinal);
        if let Some((_, branch, error)) = ordered
            .iter()
            .find(|(_, _, result)| result.is_err())
            .and_then(|(ordinal, branch, result)| {
                result.as_ref().err().map(|error| (*ordinal, branch, error))
            })
        {
            return Err(GraphError::NodeExecutionFailed {
                node: self.definition.id().to_owned(),
                message: format!(
                    "graph.parallel.branch_failed: branch '{}' failed after all admitted branches drained ({})",
                    branch.id(),
                    graph_error_code(error),
                ),
            });
        }

        let joined = Value::Array(
            ordered
                .into_iter()
                .map(|(_, branch, result)| {
                    result.map(|result| {
                        json!({
                            "branch_id": branch.id(),
                            "node": branch.node(),
                            "result": result,
                        })
                    })
                })
                .collect::<Result<Vec<_>, _>>()?,
        );
        ensure_bounded_json(&joined, MAX_JOINED_RESULT_BYTES, "joined result")?;
        Ok(NodeOutput::new().with_update(self.definition.output_key(), joined))
    }

    async fn invoke_branch(
        &self,
        activation: ParallelActivation,
        ordinal: usize,
        branch: ParallelBranchDefinition,
        context: &NodeContext,
    ) -> (usize, ParallelBranchDefinition, Result<Value, GraphError>) {
        let result = self
            .runtime
            .invoke(&activation, &branch, ordinal, context)
            .await;
        (ordinal, branch, result)
    }
}

#[async_trait]
impl Node for DurableParallelNode {
    fn name(&self) -> &str {
        self.definition.id()
    }

    async fn execute(&self, context: &NodeContext) -> Result<NodeOutput, GraphError> {
        self.execute_inner(context).await
    }

    fn validate(&self) -> Result<(), GraphError> {
        self.definition.validate().map_err(|error| {
            parallel_error(error.code(), "the parallel node configuration is invalid")
        })?;
        self.runtime.validate(&self.definition)
    }
}

fn ensure_bounded_json(
    value: &Value,
    maximum: usize,
    kind: &'static str,
) -> Result<(), GraphError> {
    let mut writer = CappedJsonWriter::new(maximum);
    if serde_json::to_writer(&mut writer, value).is_err() {
        return Err(parallel_error(
            "graph.parallel.resource_exhausted",
            match kind {
                "branch result" => "a parallel branch result exceeds its resource bound",
                _ => "the parallel joined result exceeds its resource bound",
            },
        ));
    }
    Ok(())
}

pub(super) fn projected_input_digest(input: &State) -> Result<[u8; 32], GraphError> {
    let ordered = input
        .iter()
        .map(|(key, value)| (key.as_str(), value))
        .collect::<BTreeMap<_, _>>();
    let mut writer = CappedDigestWriter::new(MAX_BRANCH_INPUT_BYTES);
    if serde_json::to_writer(&mut writer, &ordered).is_err() {
        return Err(parallel_error(
            "graph.parallel.input_resource_exhausted",
            "a projected parallel branch input exceeds its resource bound",
        ));
    }
    Ok(writer.finish())
}

struct CappedDigestWriter {
    context: digest::Context,
    written: usize,
    maximum: usize,
}

impl CappedDigestWriter {
    fn new(maximum: usize) -> Self {
        let mut context = digest::Context::new(&digest::SHA256);
        context.update(BRANCH_INPUT_DIGEST_DOMAIN);
        Self {
            context,
            written: 0,
            maximum,
        }
    }

    fn finish(self) -> [u8; 32] {
        let mut value = [0_u8; 32];
        value.copy_from_slice(self.context.finish().as_ref());
        value
    }
}

impl Write for CappedDigestWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.maximum.saturating_sub(self.written) {
            return Err(io::Error::other(
                "parallel branch input JSON exceeds its resource bound",
            ));
        }
        self.context.update(bytes);
        self.written += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct CappedJsonWriter {
    written: usize,
    maximum: usize,
}

impl CappedJsonWriter {
    const fn new(maximum: usize) -> Self {
        Self {
            written: 0,
            maximum,
        }
    }
}

impl Write for CappedJsonWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.maximum.saturating_sub(self.written) {
            return Err(io::Error::other("parallel JSON exceeds its resource bound"));
        }
        self.written += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn graph_error_code(error: &GraphError) -> &'static str {
    match error {
        GraphError::InvalidGraph(_) => "graph.invalid",
        GraphError::NodeNotFound(_) => "graph.node_not_found",
        GraphError::EdgeTargetNotFound(_) => "graph.edge_target_not_found",
        GraphError::NoEntryPoint => "graph.no_entry_point",
        GraphError::RecursionLimitExceeded(_) => "graph.recursion_limit",
        GraphError::Interrupted(_) => "graph.interrupted",
        GraphError::NodeExecutionFailed { .. } => "graph.node_execution_failed",
        GraphError::NodeTimedOut { .. } => "graph.node_timed_out",
        GraphError::FanInTimedOut { .. } => "graph.fan_in_timed_out",
        GraphError::SerializationError(_) => "graph.serialization",
        GraphError::CheckpointError(_) => "graph.checkpoint",
        GraphError::UndeclaredChannel { .. } => "graph.undeclared_channel",
        GraphError::SubgraphChannelMismatch { .. } => "graph.subgraph_channel_mismatch",
        GraphError::UnknownRouteTarget(_) => "graph.unknown_route_target",
        GraphError::IoError(_) => "graph.io",
        GraphError::JsonError(_) => "graph.json",
        GraphError::Other(_) => "graph.other",
    }
}

fn parallel_error(code: &str, message: &str) -> GraphError {
    GraphError::NodeExecutionFailed {
        node: "parallel".to_owned(),
        message: format!("{code}: {message}"),
    }
}
