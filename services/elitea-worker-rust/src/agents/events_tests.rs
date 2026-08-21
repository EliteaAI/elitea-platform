use adk_rust::graph::interrupt::{GraphInterruptPayload, INTERRUPT_METADATA_KEY};
use adk_rust::{Content, Event, FinishReason, Part};
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};

use super::events::{
    AgentEventProjectionContext, AgentEventProjectionErrorCode, AgentEventProjector,
    CompletedAgentBrowserOutput,
};
use super::graph::pipeline_result_event;
use crate::protocol::elitea::runtime::v1::NodeEventV1;
use crate::protocol::node_event::encode_current_node_event_json;

fn timestamp(second: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 14, 12, 0, second)
        .single()
        .expect("fixture timestamp")
}

fn current(event: &NodeEventV1) -> Value {
    serde_json::from_slice(
        &encode_current_node_event_json(event).expect("valid projected browser event"),
    )
    .expect("projected JSON")
}

fn projection_error(
    result: Result<
        super::events::ProjectedAgentEventBatch,
        super::events::AgentEventProjectionError,
    >,
) -> super::events::AgentEventProjectionError {
    match result {
        Ok(_) => panic!("expected event projection to fail"),
        Err(error) => error,
    }
}

fn event(id: &str, second: u32, partial: bool, complete: bool, parts: Vec<Part>) -> Event {
    let mut event = Event::with_id(id, "invocation-1");
    event.timestamp = timestamp(second);
    event.author = "root-agent".to_owned();
    event.llm_response.content = Some(Content {
        role: "model".to_owned(),
        parts,
    });
    event.llm_response.partial = partial;
    event.llm_response.turn_complete = complete;
    if complete || !partial {
        event.llm_response.finish_reason = Some(FinishReason::Stop);
    }
    event
}

fn terminal_event_without_content(id: &str, second: u32) -> Event {
    let mut event = Event::with_id(id, "invocation-1");
    event.timestamp = timestamp(second);
    event.author = "root-agent".to_owned();
    event.llm_response.partial = false;
    event.llm_response.turn_complete = true;
    event.llm_response.finish_reason = Some(FinishReason::Stop);
    event
}

fn pipeline_hitl_event(data: Value) -> Event {
    let payload = GraphInterruptPayload {
        kind: "dynamic".to_owned(),
        node: None,
        message: Some("Review the generated answer.".to_owned()),
        data: Some(data),
        thread_id: "thread-1".to_owned(),
        checkpoint_id: "checkpoint-7".to_owned(),
    };
    let mut event = Event::with_id("graph-interrupt", "invocation-1");
    event.timestamp = timestamp(1);
    event.author = "root-agent".to_owned();
    event.llm_response.content = Some(Content {
        role: "assistant".to_owned(),
        parts: vec![Part::Text {
            text: "Dynamic interrupt: Review the generated answer.".to_owned(),
        }],
    });
    event.provider_metadata.insert(
        INTERRUPT_METADATA_KEY.to_owned(),
        payload.to_metadata_value(),
    );
    event
}

fn pipeline_tool_hitl_event(data: Value) -> Event {
    let message = "Example Corp requires approval before reading customer records.";
    let payload = GraphInterruptPayload {
        kind: "dynamic".to_owned(),
        node: None,
        message: Some(message.to_owned()),
        data: Some(data),
        thread_id: "thread-1".to_owned(),
        checkpoint_id: "checkpoint-8".to_owned(),
    };
    let mut event = Event::with_id("graph-tool-interrupt", "invocation-1");
    event.timestamp = timestamp(1);
    event.author = "root-agent".to_owned();
    event.llm_response.content = Some(Content {
        role: "assistant".to_owned(),
        parts: vec![Part::Text {
            text: format!("Dynamic interrupt: {message}"),
        }],
    });
    event.provider_metadata.insert(
        INTERRUPT_METADATA_KEY.to_owned(),
        payload.to_metadata_value(),
    );
    event
}

fn nested_pipeline_hitl_event(child_checkpoint_id: &str, child_thread: &str) -> Event {
    let message = "Review the generated answer.";
    let payload = GraphInterruptPayload {
        kind: "dynamic".to_owned(),
        node: None,
        message: Some(format!("delegate: {message}")),
        data: Some(json!({
            "subgraph": "delegate",
            "thread": child_thread,
            "checkpoint_id": child_checkpoint_id,
            "data": {
                "schema_revision": "elitea.graph.hitl-interrupt.v1",
                "type": "hitl",
                "guardrail_type": "pipeline_hitl",
                "node_name": "review",
                "message": message,
                "available_actions": ["approve", "reject"],
                "routes": {"approve": "publish", "reject": "END"},
                "edit_state_key": null,
                "definition_digest": format!("sha256:{}", "3".repeat(64)),
            }
        })),
        thread_id: "thread-1".to_owned(),
        checkpoint_id: "parent-checkpoint-9".to_owned(),
    };
    let mut event = Event::with_id("nested-graph-interrupt", "invocation-1");
    event.timestamp = timestamp(1);
    event.author = "root-agent".to_owned();
    event.llm_response.content = Some(Content {
        role: "assistant".to_owned(),
        parts: vec![Part::Text {
            text: format!("Dynamic interrupt: delegate: {message}"),
        }],
    });
    event.provider_metadata.insert(
        INTERRUPT_METADATA_KEY.to_owned(),
        payload.to_metadata_value(),
    );
    event
}

#[test]
#[allow(clippy::too_many_lines)] // One ordered browser lifecycle is clearer as one trace.
fn ordinary_stream_matches_current_text_lifecycle_without_a_heap_event_queue() {
    let mut projector = AgentEventProjector::new(AgentEventProjectionContext::fixture(
        json!({"id": 11, "version_id": 22}),
    ))
    .expect("projector");

    let start: Vec<_> = projector
        .start(timestamp(0))
        .expect("agent start")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(start.len(), 1);
    assert_eq!(start[0]["type"], "agent_start");
    assert_eq!(start[0]["stream_id"], "conversation-1");
    assert_eq!(start[0]["execution_generation"], "generation-1");

    let first = event(
        "llm-1",
        1,
        true,
        false,
        vec![
            Part::Thinking {
                thinking: "why".to_owned(),
                signature: None,
            },
            Part::Text {
                text: "hel".to_owned(),
            },
        ],
    );
    let first: Vec<_> = projector
        .project(&first)
        .expect("first chunk")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(
        first
            .iter()
            .map(|event| event["type"].as_str())
            .collect::<Vec<_>>(),
        [Some("agent_llm_start"), Some("agent_llm_chunk")]
    );
    assert_eq!(first[1]["content"], "hel");
    assert_eq!(first[1]["thinking"], "why");

    let cumulative = event(
        "llm-1",
        2,
        true,
        false,
        vec![
            Part::Thinking {
                thinking: "why now".to_owned(),
                signature: None,
            },
            Part::Text {
                text: "hello".to_owned(),
            },
        ],
    );
    let cumulative: Vec<_> = projector
        .project(&cumulative)
        .expect("cumulative chunk")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(cumulative.len(), 1);
    assert_eq!(cumulative[0]["content"], "lo");
    assert_eq!(cumulative[0]["thinking"], " now");

    let completed = event(
        "llm-1",
        3,
        false,
        true,
        vec![
            Part::Thinking {
                thinking: "why now".to_owned(),
                signature: None,
            },
            Part::Text {
                text: "hello".to_owned(),
            },
        ],
    );
    let completed: Vec<_> = projector
        .project(&completed)
        .expect("completed turn")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(
        completed
            .iter()
            .map(|event| event["type"].as_str())
            .collect::<Vec<_>>(),
        [Some("agent_llm_end"), Some("partial_message")]
    );
    assert_eq!(
        completed[1]["response_metadata"]["thinking_steps"][0]["text"],
        "hello"
    );

    let terminal: Vec<_> = projector
        .finish_after_eos(CompletedAgentBrowserOutput::fixture("hello"), timestamp(4))
        .expect("EOS projection")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(
        terminal
            .iter()
            .map(|event| event["type"].as_str())
            .collect::<Vec<_>>(),
        [
            Some("pipeline_finish"),
            Some("agent_response"),
            Some("full_message")
        ]
    );
    assert_eq!(terminal[0]["content"], "hello");
    assert_eq!(
        terminal[2]["response_metadata"]["application_details"],
        json!({"id": 11, "version_id": 22})
    );
}

#[test]
fn delta_streaming_content_is_accumulated_without_assuming_cumulative_chunks() {
    let mut projector = AgentEventProjector::new(AgentEventProjectionContext::fixture(json!({})))
        .expect("projector");
    projector.start(timestamp(0)).expect("start");
    projector
        .project(&event(
            "llm-delta",
            1,
            true,
            false,
            vec![Part::Text {
                text: "hel".to_owned(),
            }],
        ))
        .expect("first delta");
    let second: Vec<_> = projector
        .project(&event(
            "llm-delta",
            2,
            true,
            false,
            vec![Part::Text {
                text: "lo".to_owned(),
            }],
        ))
        .expect("second delta")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(second[0]["content"], "lo");
    projector
        .project(&terminal_event_without_content("llm-delta", 3))
        .expect("turn end");
    let terminal: Vec<_> = projector
        .finish_after_eos(CompletedAgentBrowserOutput::fixture("hello"), timestamp(4))
        .expect("EOS")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(terminal[1]["content"], "hello");
}

#[test]
fn tool_calls_and_results_follow_the_current_browser_lifecycle() {
    let mut projector = AgentEventProjector::new(AgentEventProjectionContext::fixture(json!({})))
        .expect("projector");
    projector.start(timestamp(0)).expect("start");
    let tool = event(
        "llm-tool",
        1,
        false,
        true,
        vec![Part::FunctionCall {
            name: "lookup_issue".to_owned(),
            args: json!({"issue_number": 42}),
            id: Some("call-1".to_owned()),
            thought_signature: None,
        }],
    );
    let start = projector
        .project(&tool)
        .expect("tool start")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(
        start.iter().map(|event| &event["type"]).collect::<Vec<_>>(),
        [
            "agent_llm_start",
            "agent_llm_end",
            "partial_message",
            "agent_tool_start",
            "partial_message"
        ]
    );
    assert_eq!(start[3]["response_metadata"]["tool_run_id"], "call-1");
    assert_eq!(
        start[3]["response_metadata"]["tool_inputs"]["issue_number"],
        42
    );

    let mut result = Event::with_id("tool-result", "invocation-1");
    result.timestamp = timestamp(2);
    result.author = "root-agent".to_owned();
    result.llm_response.content = Some(Content {
        role: "function".to_owned(),
        parts: vec![Part::FunctionResponse {
            function_response: adk_rust::FunctionResponseData::new(
                "lookup_issue",
                json!({"title": "Bounded result"}),
            ),
            id: Some("call-1".to_owned()),
            annotations: None,
        }],
    });
    let finish = projector
        .project(&result)
        .expect("tool result")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(finish[0]["type"], "agent_tool_end");
    assert_eq!(finish[0]["response_metadata"]["finish_reason"], "stop");
    assert_eq!(
        finish[0]["response_metadata"]["tool_output"],
        "{\"title\":\"Bounded result\"}"
    );
}

#[test]
fn provider_failures_remain_data_free() {
    let mut projector = AgentEventProjector::new(AgentEventProjectionContext::fixture(json!({})))
        .expect("projector");
    projector.start(timestamp(0)).expect("start");

    let mut provider = event(
        "llm-provider",
        1,
        false,
        true,
        vec![Part::Text {
            text: "ignored".to_owned(),
        }],
    );
    provider.llm_response.error_code = Some("provider-secret-code".to_owned());
    provider.llm_response.error_message = Some("credential-shaped detail".to_owned());
    let error = projection_error(projector.project(&provider));
    assert_eq!(error.code(), AgentEventProjectionErrorCode::ProviderFailure);
    assert_eq!(error.code().as_str(), "agent_event.provider_failure");
    assert!(!error.to_string().contains("credential-shaped"));
    assert!(!format!("{error:?}").contains("provider-secret"));
}

#[test]
fn state_only_events_are_consumed_but_cannot_become_a_completion() {
    let mut projector = AgentEventProjector::new(AgentEventProjectionContext::fixture(json!({})))
        .expect("projector");
    projector.start(timestamp(0)).expect("start");
    let mut state = Event::with_id("state-only", "invocation-1");
    state.timestamp = timestamp(1);
    state.author = "root-agent".to_owned();
    state
        .actions
        .state_delta
        .insert("output".to_owned(), json!("not a terminal response"));
    assert!(projector.project(&state).expect("state event").is_empty());
    let error = projection_error(projector.finish_after_eos(
        CompletedAgentBrowserOutput::fixture("not state"),
        timestamp(2),
    ));
    assert_eq!(error.code(), AgentEventProjectionErrorCode::InvalidState);

    state.invocation_id = "invocation-2".to_owned();
    let error = projection_error(projector.project(&state));
    assert_eq!(error.code(), AgentEventProjectionErrorCode::InvalidState);
}

#[test]
fn multiple_root_model_turns_are_drained_and_terminal_output_is_selected_explicitly() {
    let mut projector = AgentEventProjector::new(AgentEventProjectionContext::fixture(json!({})))
        .expect("projector");
    projector.start(timestamp(0)).expect("start");
    projector
        .project(&event(
            "turn-1",
            1,
            false,
            true,
            vec![Part::Text {
                text: "intermediate".to_owned(),
            }],
        ))
        .expect("first completed turn");
    let second: Vec<_> = projector
        .project(&event(
            "turn-2",
            2,
            false,
            true,
            vec![Part::Text {
                text: "final".to_owned(),
            }],
        ))
        .expect("second completed turn")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(
        second
            .iter()
            .map(|event| event["type"].as_str())
            .collect::<Vec<_>>(),
        [
            Some("agent_llm_start"),
            Some("agent_llm_chunk"),
            Some("agent_llm_end"),
            Some("partial_message")
        ]
    );
    let terminal: Vec<_> = projector
        .finish_after_eos(
            CompletedAgentBrowserOutput::fixture("declared application output"),
            timestamp(3),
        )
        .expect("EOS")
        .into_iter()
        .map(|event| current(&event))
        .collect();
    assert_eq!(terminal[1]["content"], "declared application output");
}

#[test]
fn artifact_delta_is_not_silently_accepted_as_browser_or_completion_state() {
    let mut projector = AgentEventProjector::new(AgentEventProjectionContext::fixture(json!({})))
        .expect("projector");
    projector.start(timestamp(0)).expect("start");
    let mut artifact = Event::with_id("artifact", "invocation-1");
    artifact.timestamp = timestamp(1);
    artifact.author = "root-agent".to_owned();
    artifact
        .actions
        .artifact_delta
        .insert("report".to_owned(), 1);
    let error = projection_error(projector.project(&artifact));
    assert_eq!(
        error.code(),
        AgentEventProjectionErrorCode::UnsupportedCapability
    );
}

#[test]
fn graph_dynamic_hitl_projects_one_checkpoint_bound_public_interrupt() {
    let mut projector =
        AgentEventProjector::new(AgentEventProjectionContext::pipeline_fixture(json!({})))
            .expect("projector");
    projector.start(timestamp(0)).expect("start");
    let event = pipeline_hitl_event(json!({
        "schema_revision": "elitea.graph.hitl-interrupt.v1",
        "type": "hitl",
        "guardrail_type": "pipeline_hitl",
        "node_name": "review",
        "message": "Review the generated answer.",
        "available_actions": ["approve", "reject", "edit"],
        "routes": {
            "approve": "publish",
            "reject": "END",
            "edit": "revise"
        },
        "edit_state_key": "answer",
        "definition_digest": format!("sha256:{}", "1".repeat(64)),
    }));
    let projected = projector
        .project(&event)
        .expect("pipeline HITL projection")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(projected.len(), 1);
    assert_eq!(projected[0]["type"], "agent_hitl_interrupt");
    assert_eq!(projected[0]["content"], "Review the generated answer.");
    let metadata = &projected[0]["response_metadata"];
    assert_eq!(metadata["thread_id"], "thread-1");
    assert_eq!(
        metadata["hitl_interrupts"].as_array().map(Vec::len),
        Some(1)
    );
    let pending = &metadata["hitl_interrupt"];
    assert_eq!(pending, &metadata["hitl_interrupts"][0]);
    assert_eq!(pending["guardrail_type"], "pipeline_hitl");
    assert_eq!(pending["node_name"], "review");
    assert_eq!(pending["routes"]["reject"], "END");
    assert_eq!(pending["edit_state_key"], "answer");
    assert!(
        pending["interrupt_id"]
            .as_str()
            .is_some_and(|value| value.starts_with("hitl_g1:"))
    );
    assert!(
        pending["call_digest"]
            .as_str()
            .is_some_and(|value| value.starts_with("sha256:"))
    );
    assert!(metadata.get("checkpoint_id").is_none());
    assert!(metadata.get("definition_digest").is_none());
    assert!(projector.is_paused());
}

#[test]
fn nested_graph_hitl_projects_without_leaking_child_checkpoint_identity() {
    let mut projector =
        AgentEventProjector::new(AgentEventProjectionContext::pipeline_fixture(json!({})))
            .expect("projector");
    projector.start(timestamp(0)).expect("start");
    let projected = projector
        .project(&nested_pipeline_hitl_event(
            "child-checkpoint-12",
            "thread-1/delegate",
        ))
        .expect("nested pipeline HITL projection")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(projected.len(), 1);
    assert_eq!(projected[0]["content"], "Review the generated answer.");
    let metadata = &projected[0]["response_metadata"];
    assert_eq!(metadata["thread_id"], "thread-1");
    assert_eq!(metadata["hitl_interrupt"]["node_name"], "review");
    assert!(
        metadata["hitl_interrupt"]["interrupt_id"]
            .as_str()
            .is_some_and(|value| value.starts_with("hitl_g1:"))
    );
    assert!(metadata.get("checkpoint_id").is_none());
    assert!(metadata.get("child_thread").is_none());
    assert!(metadata["hitl_interrupt"].get("checkpoint_id").is_none());
    assert!(metadata["hitl_interrupt"].get("child_thread").is_none());
}

#[test]
fn nested_graph_hitl_rejects_an_unbound_child_thread() {
    let mut projector =
        AgentEventProjector::new(AgentEventProjectionContext::pipeline_fixture(json!({})))
            .expect("projector");
    projector.start(timestamp(0)).expect("start");
    let error = projection_error(projector.project(&nested_pipeline_hitl_event(
        "child-checkpoint-12",
        "different-thread/delegate",
    )));
    assert_eq!(error.code(), AgentEventProjectionErrorCode::InvalidState);
}

#[test]
fn graph_tool_confirmation_projects_masked_call_bound_sensitive_interrupt() {
    let message = "Example Corp requires approval before reading customer records.";
    let mut projector =
        AgentEventProjector::new(AgentEventProjectionContext::pipeline_fixture(json!({})))
            .expect("projector");
    projector.start(timestamp(0)).expect("start");
    let projected = projector
        .project(&pipeline_tool_hitl_event(json!({
            "schema_revision": "elitea.graph.tool-confirmation.v1",
            "type": "hitl",
            "guardrail_type": "sensitive_tool",
            "node_name": "lookup",
            "message": message,
            "available_actions": ["approve", "reject", "block_with_comment"],
            "routes": {},
            "definition_digest": format!("sha256:{}", "1".repeat(64)),
            "tool_call_id": "pipeline:lookup:7",
            "tool_name": "search_records",
            "toolkit_name": "Customer Support",
            "toolkit_type": "customer_support",
            "action_label": "Customer Support.search_records",
            "tool_args": {"query": "ticket 42", "token": "***"},
            "argument_digest": format!("sha256:{}", "2".repeat(64)),
            "policy_message": message,
        })))
        .expect("Toolkit confirmation projection")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(projected.len(), 1);
    let pending = &projected[0]["response_metadata"]["hitl_interrupt"];
    assert_eq!(pending["guardrail_type"], "sensitive_tool");
    assert_eq!(pending["tool_call_id"], "pipeline:lookup:7");
    assert_eq!(pending["tool_args"]["token"], "***");
    assert_eq!(
        pending["available_actions"],
        json!(["approve", "reject", "block_with_comment"])
    );
    assert!(
        pending["interrupt_id"]
            .as_str()
            .is_some_and(|value| value.starts_with("hitl_gt1:"))
    );
    assert!(projector.is_paused());
}

#[test]
fn graph_terminal_state_result_projects_as_one_closed_model_turn() {
    let mut projector =
        AgentEventProjector::new(AgentEventProjectionContext::pipeline_fixture(json!({})))
            .expect("projector");
    projector.start(timestamp(0)).expect("start");

    let mut result = pipeline_result_event("Hello, world");
    result.id = "pipeline-result".to_owned();
    result.invocation_id = "invocation-1".to_owned();
    result.author = "root-agent".to_owned();
    result.timestamp = timestamp(1);
    let projected = projector
        .project(&result)
        .expect("terminal pipeline result")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();

    assert_eq!(
        projected
            .iter()
            .map(|event| event["type"].as_str())
            .collect::<Vec<_>>(),
        [
            Some("agent_llm_start"),
            Some("agent_llm_chunk"),
            Some("agent_llm_end"),
            Some("partial_message")
        ]
    );
    assert_eq!(projected[1]["content"], "Hello, world");
    assert_eq!(
        projected[3]["response_metadata"]["thinking_steps"][0]["text"],
        "Hello, world"
    );

    let completed = projector
        .finish_after_eos(
            CompletedAgentBrowserOutput::fixture("Pipeline completed."),
            timestamp(2),
        )
        .expect("post-EOS pipeline result")
        .into_iter()
        .map(|event| current(&event))
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 3);
    assert!(
        completed
            .iter()
            .all(|event| event["content"] == "Hello, world")
    );
}

#[test]
fn malformed_graph_hitl_never_becomes_an_approval_card() {
    let valid = json!({
        "schema_revision": "elitea.graph.hitl-interrupt.v1",
        "type": "hitl",
        "guardrail_type": "pipeline_hitl",
        "node_name": "review",
        "message": "Review the generated answer.",
        "available_actions": ["approve"],
        "routes": {"approve": "publish"},
        "edit_state_key": null,
        "definition_digest": format!("sha256:{}", "2".repeat(64)),
    });
    for invalid in [
        {
            let mut data = valid.clone();
            data["available_actions"] = json!(["continue"]);
            data
        },
        {
            let mut data = valid.clone();
            data["routes"]["approve"] = json!("../escape");
            data
        },
        {
            let mut data = valid.clone();
            data["message"] = json!("different message");
            data
        },
        {
            let mut data = valid.clone();
            data["definition_digest"] = json!("sha256:stale");
            data
        },
    ] {
        let mut projector =
            AgentEventProjector::new(AgentEventProjectionContext::pipeline_fixture(json!({})))
                .expect("projector");
        projector.start(timestamp(0)).expect("start");
        let error = projection_error(projector.project(&pipeline_hitl_event(invalid)));
        assert_eq!(error.code(), AgentEventProjectionErrorCode::InvalidState);
    }
}
