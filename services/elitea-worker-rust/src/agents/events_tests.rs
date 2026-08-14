use adk_rust::{Content, Event, FinishReason, Part};
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};

use super::events::{
    AgentEventProjectionContext, AgentEventProjectionErrorCode, AgentEventProjector,
    CompletedAgentBrowserOutput,
};
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
fn tool_and_provider_data_fail_closed_without_entering_operator_errors() {
    let mut projector = AgentEventProjector::new(AgentEventProjectionContext::fixture(json!({})))
        .expect("projector");
    projector.start(timestamp(0)).expect("start");
    let tool = event(
        "llm-tool",
        1,
        false,
        true,
        vec![Part::FunctionCall {
            name: "sensitive".to_owned(),
            args: json!({"secret": "must-not-escape"}),
            id: Some("call-1".to_owned()),
            thought_signature: None,
        }],
    );
    let error = projection_error(projector.project(&tool));
    assert_eq!(
        error.code(),
        AgentEventProjectionErrorCode::UnsupportedCapability
    );
    assert!(!error.to_string().contains("must-not-escape"));
    assert!(!format!("{error:?}").contains("must-not-escape"));

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
