use std::sync::Arc;

use adk_rust::model::MockLlm;
use adk_rust::{Content, Llm, LlmResponse};
use chrono::Utc;

use super::assembly::OrdinaryNoToolProfile;
use super::assembly_tests::ordinary_request;
use super::events::AgentEventProjectionErrorCode;
use super::request::AgentExecutionKind;
use super::runtime::{NativeAgentCompletionSelector, NativeAgentRuntimeErrorCode};
use super::session::{
    AuthorizedNativeCommandBinding, BoundOrdinaryAgentModel, OrdinaryNativeAgentPlan,
    assemble_ordinary_native,
};
use crate::protocol::node_event::encode_current_node_event_json;

struct FixtureBoundModel {
    model: Arc<MockLlm>,
    completed: String,
}

impl BoundOrdinaryAgentModel for FixtureBoundModel {
    fn adk_model(&self) -> Arc<dyn Llm> {
        self.model.clone()
    }

    fn take_completed_text(self) -> Result<String, super::runtime::NativeAgentAssemblyError> {
        Ok(self.completed)
    }
}

fn bound_model(response: &str) -> FixtureBoundModel {
    FixtureBoundModel {
        model: Arc::new(
            MockLlm::new("fixture-model").with_response(LlmResponse::new(
                Content::new("assistant").with_text(response),
            )),
        ),
        completed: response.to_owned(),
    }
}

#[tokio::test]
async fn invocation_local_session_runs_one_real_adk_turn_and_projects_the_exact_completion() {
    let request = ordinary_request(AgentExecutionKind::Application);
    let profile = OrdinaryNoToolProfile::validate(&request).expect("ordinary profile");
    let plan = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("native plan");
    let mut assembled = assemble_ordinary_native(bound_model("native response"), plan)
        .await
        .expect("native assembly");
    let start = assembled
        .project_start(Utc::now())
        .expect("projected start");
    assert_eq!(start.len(), 1);

    let (mut native, mut projector, completion) = assembled.start().expect("native start");
    let mut projected = 0_usize;
    while let Some(event) = native.next_event().await.expect("native event") {
        projected += projector.project(&event).expect("projected event").len();
    }
    assert!(projected >= 3);
    let completion = completion.select().await.expect("selected completion");
    let finish = projector
        .finish_after_eos(completion, Utc::now())
        .expect("projected completion");
    let mut event_types = Vec::new();
    for event in finish {
        let value: serde_json::Value = serde_json::from_slice(
            &encode_current_node_event_json(&event).expect("canonical browser event"),
        )
        .expect("browser event JSON");
        event_types.push(value["type"].as_str().unwrap_or_default().to_owned());
        if value["type"] == "full_message" {
            assert_eq!(value["content"], "native response");
            assert_eq!(value["stream_id"], "conversation-1");
            assert_eq!(value["message_id"], "message-1");
            assert_eq!(value["response_metadata"]["project_id"], 7);
            assert_eq!(value["response_metadata"]["chat_project_id"], 9);
        }
    }
    assert_eq!(
        event_types,
        ["pipeline_finish", "agent_response", "full_message"]
    );
    assert_eq!(
        native
            .next_event()
            .await
            .expect_err("one-use stream")
            .code(),
        NativeAgentRuntimeErrorCode::InvalidState
    );
}

#[test]
fn pseudonymous_session_identity_is_stable_per_thread_and_separated_between_threads() {
    let request = ordinary_request(AgentExecutionKind::Adhoc);
    let profile = OrdinaryNoToolProfile::validate(&request).expect("ordinary profile");
    let first = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("first plan");
    let same = OrdinaryNativeAgentPlan::from_authorized(
        &request,
        &profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("same plan");
    assert_eq!(first.session_id(), same.session_id());
    assert!(!first.session_id().contains("tenant-1"));
    assert!(!first.session_id().contains("user:42"));

    let mut other_request = ordinary_request(AgentExecutionKind::Adhoc);
    other_request.payload.thread_id = Some("thread-2".to_owned());
    let other_profile =
        OrdinaryNoToolProfile::validate(&other_request).expect("other ordinary profile");
    let other = OrdinaryNativeAgentPlan::from_authorized(
        &other_request,
        &other_profile,
        &AuthorizedNativeCommandBinding::fixture(),
    )
    .expect("other plan");
    assert_ne!(first.session_id(), other.session_id());
}

#[test]
fn invalid_completed_content_never_becomes_a_browser_terminal() {
    let Err(error) =
        super::events::CompletedAgentBrowserOutput::ordinary(String::new(), "thread-1".to_owned())
    else {
        panic!("empty model result was accepted");
    };
    assert_eq!(error.code(), AgentEventProjectionErrorCode::InvalidOutput);
}
