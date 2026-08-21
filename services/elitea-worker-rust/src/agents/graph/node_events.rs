//! Invocation-local event bridge for native pipeline LLM nodes.
//!
//! `GraphAgent` owns checkpointed state and emits the selected terminal result,
//! while an `LlmAgent` node owns the model/tool loop. ADK intentionally does not
//! retain those inner events in the graph checkpoint. This bounded side channel
//! forwards them to the outer Runner stream without putting browser progress or
//! provider request payloads in graph state.

use std::sync::Arc;

use adk_rust::futures::StreamExt as _;
use adk_rust::{
    AdkError, Agent, ErrorCategory, ErrorComponent, Event, EventStream, InvocationContext,
};
use async_trait::async_trait;
use tokio::sync::{Mutex, mpsc};

use super::yaml::valid_graph_id;

const PIPELINE_NODE_EVENT_CHANNEL_CAPACITY: usize = 64;
const ADK_LLM_REQUEST_METADATA_KEY: &str = "gcp.vertex.agent.llm_request";
const ADK_LLM_RESPONSE_METADATA_KEY: &str = "gcp.vertex.agent.llm_response";

/// Stable private marker consumed by the Elitea browser event projector.
pub(crate) const PIPELINE_NODE_METADATA_KEY: &str = "elitea.pipeline.node_name";

struct PipelineNodeEventSignal {
    node_name: String,
    event: Box<Event>,
}

#[derive(Clone)]
pub(crate) struct PipelineNodeEventSender {
    inner: mpsc::Sender<PipelineNodeEventSignal>,
}

#[derive(Clone)]
pub(crate) struct PipelineNodeEventReceiver {
    inner: Arc<Mutex<Option<mpsc::Receiver<PipelineNodeEventSignal>>>>,
}

#[must_use]
pub(crate) fn pipeline_node_event_channel() -> (PipelineNodeEventSender, PipelineNodeEventReceiver)
{
    let (sender, receiver) = mpsc::channel(PIPELINE_NODE_EVENT_CHANNEL_CAPACITY);
    (
        PipelineNodeEventSender { inner: sender },
        PipelineNodeEventReceiver {
            inner: Arc::new(Mutex::new(Some(receiver))),
        },
    )
}

impl PipelineNodeEventSender {
    /// Forward one ordinary model/tool event. Confirmations stay owned by the
    /// graph interrupt, and incremental tool-progress events remain closed
    /// until the public projection has a bounded schema for them.
    pub(crate) async fn send(&self, node_name: &str, mut event: Event) -> adk_rust::Result<()> {
        if !valid_graph_id(node_name)
            || event.actions.tool_confirmation.is_some()
            || event.tool_progress_stream().is_some()
            || event
                .provider_metadata
                .contains_key(PIPELINE_NODE_METADATA_KEY)
        {
            return Err(pipeline_node_event_channel_error());
        }
        event.llm_request = None;
        event.provider_metadata.remove(ADK_LLM_REQUEST_METADATA_KEY);
        event
            .provider_metadata
            .remove(ADK_LLM_RESPONSE_METADATA_KEY);
        self.inner
            .send(PipelineNodeEventSignal {
                node_name: node_name.to_owned(),
                event: Box::new(event),
            })
            .await
            .map_err(|_| pipeline_node_event_channel_error())
    }
}

pub(crate) struct PipelineNodeEventStreamingAgent {
    inner: Arc<dyn Agent>,
    events: PipelineNodeEventReceiver,
}

impl PipelineNodeEventStreamingAgent {
    #[must_use]
    pub(crate) fn new(inner: Arc<dyn Agent>, events: PipelineNodeEventReceiver) -> Self {
        Self { inner, events }
    }
}

#[async_trait]
impl Agent for PipelineNodeEventStreamingAgent {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn description(&self) -> &str {
        self.inner.description()
    }

    fn sub_agents(&self) -> &[Arc<dyn Agent>] {
        self.inner.sub_agents()
    }

    async fn run(&self, ctx: Arc<dyn InvocationContext>) -> adk_rust::Result<EventStream> {
        let mut node_events = self
            .events
            .inner
            .lock()
            .await
            .take()
            .ok_or_else(pipeline_node_event_channel_error)?;
        let root_invocation_id = ctx.invocation_id().to_owned();
        let root_author = ctx.agent_name().to_owned();
        let root_branch = ctx.branch().to_owned();
        let mut root_events = self.inner.run(ctx).await?;
        let stream = async_stream::stream! {
            loop {
                tokio::select! {
                    biased;
                    signal = node_events.recv() => {
                        if let Some(signal) = signal {
                            match pipeline_node_signal_event(
                                signal,
                                &root_invocation_id,
                                &root_author,
                                &root_branch,
                            ) {
                                Ok(event) => yield Ok(event),
                                Err(error) => {
                                    yield Err(error);
                                    return;
                                }
                            }
                        }
                    }
                    event = root_events.next() => {
                        if let Some(event) = event {
                            while let Ok(signal) = node_events.try_recv() {
                                match pipeline_node_signal_event(
                                    signal,
                                    &root_invocation_id,
                                    &root_author,
                                    &root_branch,
                                ) {
                                    Ok(event) => yield Ok(event),
                                    Err(error) => {
                                        yield Err(error);
                                        return;
                                    }
                                }
                            }
                            yield event;
                        } else {
                            while let Ok(signal) = node_events.try_recv() {
                                match pipeline_node_signal_event(
                                    signal,
                                    &root_invocation_id,
                                    &root_author,
                                    &root_branch,
                                ) {
                                    Ok(event) => yield Ok(event),
                                    Err(error) => {
                                        yield Err(error);
                                        return;
                                    }
                                }
                            }
                            return;
                        }
                    }
                }
            }
        };
        Ok(Box::pin(stream))
    }
}

fn pipeline_node_signal_event(
    signal: PipelineNodeEventSignal,
    root_invocation_id: &str,
    root_author: &str,
    root_branch: &str,
) -> adk_rust::Result<Event> {
    if !valid_graph_id(&signal.node_name) {
        return Err(pipeline_node_event_channel_error());
    }
    let mut event = *signal.event;
    if event
        .provider_metadata
        .insert(PIPELINE_NODE_METADATA_KEY.to_owned(), signal.node_name)
        .is_some()
    {
        return Err(pipeline_node_event_channel_error());
    }
    root_invocation_id.clone_into(&mut event.invocation_id);
    root_author.clone_into(&mut event.author);
    root_branch.clone_into(&mut event.branch);
    Ok(event)
}

fn pipeline_node_event_channel_error() -> AdkError {
    AdkError::new(
        ErrorComponent::Agent,
        ErrorCategory::Internal,
        "elitea_pipeline.node_event_channel_unavailable",
        "the pipeline node event channel is unavailable",
    )
}
