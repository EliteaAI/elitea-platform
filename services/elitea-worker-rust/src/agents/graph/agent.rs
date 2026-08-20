//! Elitea identity adapter for ADK-Rust `GraphAgent` events.
//!
//! ADK-Rust 2.0.0's graph interrupt bridge emits an otherwise correct event
//! with a placeholder invocation ID and no author. The runner does not rewrite
//! those fields. This narrow wrapper binds every graph event back to the exact
//! invocation and root agent that own it before the browser projector sees it.

#![allow(dead_code)] // Construction opens with the stored-pipeline compiler.

use std::sync::Arc;

use adk_rust::futures::StreamExt as _;
use adk_rust::graph::GraphAgent;
use adk_rust::{Agent, Content, Event, EventStream, InvocationContext};
use async_trait::async_trait;

pub(crate) const PIPELINE_COMPLETED_METADATA_KEY: &str = "elitea.pipeline.completed";
pub(crate) const PIPELINE_COMPLETED_METADATA_VALUE: &str = "v1";
pub(crate) const PIPELINE_COMPLETED_CONTENT: &str = "Pipeline completed.";

/// Emit one bounded terminal marker without serializing private graph state.
pub(crate) fn pipeline_completed_event() -> Event {
    pipeline_result_event(PIPELINE_COMPLETED_CONTENT)
}

/// Emit one bounded terminal result selected from public pipeline state.
pub(crate) fn pipeline_result_event(content: &str) -> Event {
    let mut event = Event::new("graph_invocation_pending");
    event.set_content(Content::new("assistant").with_text(content));
    event.provider_metadata.insert(
        PIPELINE_COMPLETED_METADATA_KEY.to_owned(),
        PIPELINE_COMPLETED_METADATA_VALUE.to_owned(),
    );
    event
}

pub(crate) struct EliteaGraphAgent {
    name: String,
    description: String,
    graph: GraphAgent,
    sub_agents: Vec<Arc<dyn Agent>>,
}

impl EliteaGraphAgent {
    #[must_use]
    pub(crate) fn new(graph: GraphAgent) -> Self {
        Self {
            name: graph.name().to_owned(),
            description: graph.description().to_owned(),
            graph,
            sub_agents: Vec::new(),
        }
    }
}

#[async_trait]
impl Agent for EliteaGraphAgent {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn sub_agents(&self) -> &[Arc<dyn Agent>] {
        &self.sub_agents
    }

    fn supports_agent_transfer(&self) -> bool {
        false
    }

    async fn run(&self, context: Arc<dyn InvocationContext>) -> adk_rust::Result<EventStream> {
        let invocation_id = context.invocation_id().to_owned();
        let author = self.name.clone();
        let events = self.graph.run(context).await?;
        Ok(Box::pin(events.map(move |result| {
            result.map(|mut event| {
                event.invocation_id.clone_from(&invocation_id);
                event.author.clone_from(&author);
                event
            })
        })))
    }
}
