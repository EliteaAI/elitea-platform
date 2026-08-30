//! Admission and compaction behavior for conversation context management.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use adk_runner::compaction::CompactionStrategy;
use adk_rust::model::MockLlm;
use adk_rust::{
    BaseEventsSummarizer, Content, Event, EventActions, EventCompaction, FunctionResponseData, Llm,
    Part,
};
use async_trait::async_trait;
use serde_json::{Map, Value, json};

use super::context_management::{ContextCompactionPlan, ContextManagementPlan};
use super::runtime::NativeAgentAssemblyErrorCode;

const CONVERSATION: Option<&str> = Some("conv-1");

fn settings(pairs: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in pairs {
        map.insert((*key).to_owned(), value.clone());
    }
    map
}

fn admit(pairs: &[(&str, Value)]) -> Result<ContextManagementPlan, NativeAgentAssemblyErrorCode> {
    ContextManagementPlan::admit_current(&settings(pairs), CONVERSATION)
        .map_err(|error| error.code())
}

fn turn(author: &str, role: &str, text: &str) -> Event {
    let mut event = Event::new("inv-1");
    event.author = author.to_owned();
    event.set_content(Content::new(role).with_text(text.to_owned()));
    event
}

fn tool_response(name: &str) -> Event {
    let mut event = Event::new("inv-1");
    event.author = "assistant".to_owned();
    let mut content = Content::new("user");
    content.parts.push(Part::FunctionResponse {
        function_response: FunctionResponseData {
            name: name.to_owned(),
            response: json!({"ok": true}),
            inline_data: Vec::new(),
            file_data: Vec::new(),
        },
        id: None,
        annotations: None,
    });
    event.set_content(content);
    event
}

/// A summarizer that records what it was handed and answers with a fixed
/// rollup, in the `EventCompaction` shape `LlmEventSummarizer` produces.
struct StubSummarizer {
    calls: AtomicUsize,
    summarized: std::sync::Mutex<Vec<String>>,
    answer: Option<String>,
}

impl StubSummarizer {
    fn new(answer: Option<&str>) -> Arc<Self> {
        Arc::new(Self {
            calls: AtomicUsize::new(0),
            summarized: std::sync::Mutex::new(Vec::new()),
            answer: answer.map(ToOwned::to_owned),
        })
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }

    fn summarized(&self) -> Vec<String> {
        self.summarized.lock().expect("stub lock").clone()
    }
}

#[async_trait]
impl BaseEventsSummarizer for StubSummarizer {
    async fn summarize_events(&self, events: &[Event]) -> adk_rust::Result<Option<Event>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut seen = self.summarized.lock().expect("stub lock");
        for event in events {
            if let Some(content) = event.content() {
                for part in &content.parts {
                    if let Part::Text { text } = part {
                        seen.push(text.clone());
                    }
                }
            }
        }
        let Some(answer) = self.answer.as_ref() else {
            return Ok(None);
        };
        let mut summary = Event::new("compaction");
        summary.author = "system".to_owned();
        summary.actions = EventActions {
            compaction: Some(EventCompaction {
                start_timestamp: events
                    .first()
                    .map(|event| event.timestamp)
                    .unwrap_or_default(),
                end_timestamp: events
                    .last()
                    .map(|event| event.timestamp)
                    .unwrap_or_default(),
                compacted_content: Content::new("model").with_text(answer.clone()),
            }),
            ..Default::default()
        };
        Ok(Some(summary))
    }
}

fn text_of(event: &Event) -> String {
    event
        .content()
        .map(|content| {
            content
                .parts
                .iter()
                .filter_map(|part| match part {
                    Part::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------- admission

#[test]
fn empty_settings_admit_the_disabled_default() {
    assert_eq!(
        ContextManagementPlan::admit_current(&Map::new(), CONVERSATION)
            .expect("an unconfigured stack must stay off"),
        ContextManagementPlan::Disabled
    );
}

#[test]
fn an_absent_conversation_admits_the_disabled_default() {
    let configured = settings(&[("enabled", json!(true))]);
    assert_eq!(
        ContextManagementPlan::admit_current(&configured, None)
            .expect("context management is scoped to a conversation"),
        ContextManagementPlan::Disabled
    );
}

#[test]
fn the_master_switch_off_admits_the_disabled_plan() {
    assert_eq!(
        admit(&[("enabled", json!(false))]).expect("an explicit off is admitted"),
        ContextManagementPlan::Disabled
    );
}

#[test]
fn every_strategy_switched_off_admits_the_disabled_plan() {
    assert_eq!(
        admit(&[
            ("enabled", json!(true)),
            ("enable_summarization", json!(false)),
            ("enable_context_editing", json!(false)),
        ])
        .expect("an inert configuration changes nothing the model sees"),
        ContextManagementPlan::Disabled
    );
}

#[test]
fn the_frozen_defaults_admit_a_summarization_plan() {
    let plan = admit(&[("enabled", json!(true))]).expect("the frozen contract is admitted");
    assert_eq!(
        plan,
        ContextManagementPlan::Summarize(ContextCompactionPlan {
            max_context_tokens: 64_000,
            preserve_recent_messages: 5,
            preserve_system_messages: true,
            summary_instructions:
                "Generate a concise summary of the following conversation messages".to_owned(),
        })
    );
}

#[test]
fn the_full_frozen_contract_is_admitted() {
    let plan = admit(&[
        ("enabled", json!(true)),
        ("enable_summarization", json!(true)),
        ("enable_context_editing", json!(false)),
        ("max_context_tokens", json!(12_000)),
        ("preserve_recent_messages", json!(9)),
        ("preserve_system_messages", json!(false)),
        ("summary_instructions", json!("Condense this")),
        ("summary_llm_settings", json!(null)),
    ])
    .expect("every frozen key is admitted");
    assert_eq!(
        plan,
        ContextManagementPlan::Summarize(ContextCompactionPlan {
            max_context_tokens: 12_000,
            preserve_recent_messages: 9,
            preserve_system_messages: false,
            summary_instructions: "Condense this".to_owned(),
        })
    );
}

#[test]
fn an_unrecognized_setting_is_refused() {
    assert_eq!(
        admit(&[("enabled", json!(true)), ("strategy_name", json!("greedy"))])
            .expect_err("an unfrozen key must not be ignored"),
        NativeAgentAssemblyErrorCode::InvalidInput
    );
}

#[test]
fn malformed_setting_types_are_refused() {
    for pairs in [
        vec![("enabled", json!("yes"))],
        vec![
            ("enabled", json!(true)),
            ("max_context_tokens", json!("64000")),
        ],
        vec![
            ("enabled", json!(true)),
            ("preserve_recent_messages", json!(5.5)),
        ],
        vec![
            ("enabled", json!(true)),
            ("preserve_system_messages", json!(1)),
        ],
        vec![("enabled", json!(true)), ("summary_instructions", json!(7))],
        vec![
            ("enabled", json!(true)),
            ("summary_llm_settings", json!("gpt-4o")),
        ],
    ] {
        assert_eq!(
            admit(&pairs).expect_err("a malformed setting must not silently degrade"),
            NativeAgentAssemblyErrorCode::InvalidInput,
            "{pairs:?}"
        );
    }
}

#[test]
fn out_of_range_settings_are_refused() {
    for pairs in [
        vec![("enabled", json!(true)), ("max_context_tokens", json!(999))],
        vec![("enabled", json!(true)), ("max_context_tokens", json!(-1))],
        vec![
            ("enabled", json!(true)),
            ("preserve_recent_messages", json!(0)),
        ],
        vec![
            ("enabled", json!(true)),
            ("preserve_recent_messages", json!(100)),
        ],
    ] {
        assert_eq!(
            admit(&pairs).expect_err("an out-of-range setting must not be clamped"),
            NativeAgentAssemblyErrorCode::InvalidInput,
            "{pairs:?}"
        );
    }
}

#[test]
fn context_editing_stays_capability_gated() {
    assert_eq!(
        admit(&[
            ("enabled", json!(true)),
            ("enable_context_editing", json!(true))
        ])
        .expect_err("tool-output editing has no ADK-Rust 2.0.0 primitive"),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

#[test]
fn a_dedicated_summary_model_stays_capability_gated() {
    assert_eq!(
        admit(&[
            ("enabled", json!(true)),
            ("summary_llm_settings", json!({"model_name": "gpt-4o-mini"}))
        ])
        .expect_err("a second model needs a credential the claim does not carry"),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

// -------------------------------------------------------------- composition

#[test]
fn the_disabled_plan_composes_no_runner_change() {
    let model: Arc<dyn Llm> = Arc::new(MockLlm::new("fixture-model"));
    for summarization_model in [None, Some(model)] {
        assert!(
            ContextManagementPlan::Disabled
                .prepare_runner_composition(summarization_model)
                .expect("the default-off path never fails")
                .is_none(),
            "an unconfigured stack must not reach the Runner's compaction seam"
        );
    }
}

#[test]
fn an_active_plan_composes_the_frozen_budget_onto_the_runner() {
    let plan = admit(&[
        ("enabled", json!(true)),
        ("max_context_tokens", json!(12_000)),
    ])
    .expect("admitted");
    let model: Arc<dyn Llm> = Arc::new(MockLlm::new("fixture-model"));
    let composed = plan
        .prepare_runner_composition(Some(model))
        .expect("an active plan composes")
        .expect("an active plan reaches the Runner's compaction seam");
    assert_eq!(composed.context_budget, 12_000);
    assert_eq!(
        composed.max_retries, 1,
        "one summarization pass per invocation, as the current SDK does"
    );
}

#[test]
fn an_active_plan_without_a_model_is_refused() {
    let plan = admit(&[("enabled", json!(true))]).expect("admitted");
    assert_eq!(
        plan.prepare_runner_composition(None)
            .expect_err("a plan with nothing to summarize with is refused")
            .code(),
        NativeAgentAssemblyErrorCode::UnsupportedCapability
    );
}

#[test]
fn the_prompt_template_reproduces_both_sdk_shapes() {
    let bare = ContextCompactionPlan {
        max_context_tokens: 1_000,
        preserve_recent_messages: 1,
        preserve_system_messages: true,
        summary_instructions: "Condense this".to_owned(),
    };
    assert_eq!(
        bare.prompt_template(),
        "Condense this\n\n<messages>\n{conversation_history}\n</messages>"
    );

    let templated = ContextCompactionPlan {
        summary_instructions: "Roll up: {messages}".to_owned(),
        ..bare.clone()
    };
    assert_eq!(
        templated.prompt_template(),
        "Roll up: {conversation_history}"
    );

    let native = ContextCompactionPlan {
        summary_instructions: "Roll up: {conversation_history}".to_owned(),
        ..bare
    };
    assert_eq!(native.prompt_template(), "Roll up: {conversation_history}");
}

// --------------------------------------------------------------- compaction

fn over_budget_transcript() -> Vec<Event> {
    let mut events = vec![turn("system", "system", "SYSTEM PROMPT")];
    for index in 0..8 {
        events.push(turn(
            "user",
            "user",
            &format!("old-{index} {}", "x".repeat(400)),
        ));
    }
    for index in 0..3 {
        events.push(turn("user", "user", &format!("recent-{index}")));
    }
    events
}

#[tokio::test]
async fn an_over_budget_transcript_is_compacted_around_the_preserved_tail() {
    let plan = ContextCompactionPlan {
        max_context_tokens: 200,
        preserve_recent_messages: 3,
        preserve_system_messages: true,
        summary_instructions: "Condense this".to_owned(),
    };
    let summarizer = StubSummarizer::new(Some("ROLLED UP"));
    let strategy = plan.strategy(summarizer.clone());

    let compacted = strategy
        .compact(over_budget_transcript(), 200)
        .await
        .expect("compaction succeeds");

    assert_eq!(summarizer.calls(), 1, "exactly one summarization pass");

    // The system prompt survives verbatim, at the head.
    assert_eq!(text_of(&compacted[0]), "SYSTEM PROMPT");
    assert_eq!(compacted[0].author, "system");

    // The summary replaces the over-budget head, in the SDK's shape.
    assert!(
        text_of(&compacted[1]).starts_with("Here is a summary of the conversation to date:"),
        "got {:?}",
        text_of(&compacted[1])
    );
    assert!(text_of(&compacted[1]).contains("ROLLED UP"));

    // The untouchable tail survives intact and in order.
    let tail = &compacted[compacted.len() - 3..];
    assert_eq!(
        tail.iter().map(text_of).collect::<Vec<_>>(),
        vec!["recent-0", "recent-1", "recent-2"]
    );
    assert!(compacted.len() < 12, "the transcript actually shrank");

    // Neither the system prompt nor the preserved tail was ever summarized.
    let handed_over = summarizer.summarized();
    assert!(!handed_over.iter().any(|text| text == "SYSTEM PROMPT"));
    assert!(!handed_over.iter().any(|text| text.starts_with("recent-")));
    assert!(handed_over.iter().any(|text| text.starts_with("old-")));
}

#[tokio::test]
async fn an_under_budget_transcript_is_left_alone() {
    let plan = ContextCompactionPlan {
        max_context_tokens: 64_000,
        preserve_recent_messages: 3,
        preserve_system_messages: true,
        summary_instructions: "Condense this".to_owned(),
    };
    let summarizer = StubSummarizer::new(Some("ROLLED UP"));
    let strategy = plan.strategy(summarizer.clone());
    let original = over_budget_transcript();

    let compacted = strategy
        .compact(original.clone(), 64_000)
        .await
        .expect("compaction succeeds");

    assert_eq!(summarizer.calls(), 0, "no summarization below the budget");
    assert_eq!(
        compacted.iter().map(text_of).collect::<Vec<_>>(),
        original.iter().map(text_of).collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn a_transcript_inside_a_tool_loop_is_never_compacted() {
    let plan = ContextCompactionPlan {
        max_context_tokens: 200,
        preserve_recent_messages: 3,
        preserve_system_messages: true,
        summary_instructions: "Condense this".to_owned(),
    };
    let summarizer = StubSummarizer::new(Some("ROLLED UP"));
    let strategy = plan.strategy(summarizer.clone());
    let mut events = over_budget_transcript();
    events.push(tool_response("search"));

    let compacted = strategy
        .compact(events.clone(), 200)
        .await
        .expect("compaction succeeds");

    assert_eq!(
        summarizer.calls(),
        0,
        "summarizing mid tool loop would break call/response pairing"
    );
    assert_eq!(compacted.len(), events.len());
}

#[tokio::test]
async fn preserve_system_messages_off_lets_the_system_turn_be_summarized() {
    let plan = ContextCompactionPlan {
        max_context_tokens: 200,
        preserve_recent_messages: 3,
        preserve_system_messages: false,
        summary_instructions: "Condense this".to_owned(),
    };
    let summarizer = StubSummarizer::new(Some("ROLLED UP"));
    let strategy = plan.strategy(summarizer.clone());

    let compacted = strategy
        .compact(over_budget_transcript(), 200)
        .await
        .expect("compaction succeeds");

    assert!(
        summarizer
            .summarized()
            .iter()
            .any(|text| text == "SYSTEM PROMPT"),
        "the switch is honored in both directions"
    );
    assert!(
        !compacted.iter().any(|event| event.author == "system"),
        "no pinned system turn survives when the switch is off"
    );
}

#[tokio::test]
async fn a_summarizer_that_answers_nothing_leaves_the_transcript_intact() {
    let plan = ContextCompactionPlan {
        max_context_tokens: 200,
        preserve_recent_messages: 3,
        preserve_system_messages: true,
        summary_instructions: "Condense this".to_owned(),
    };
    let summarizer = StubSummarizer::new(None);
    let strategy = plan.strategy(summarizer.clone());
    let original = over_budget_transcript();

    let compacted = strategy
        .compact(original.clone(), 200)
        .await
        .expect("a refused summary is not a compaction failure");

    assert_eq!(summarizer.calls(), 1);
    assert_eq!(
        compacted.iter().map(text_of).collect::<Vec<_>>(),
        original.iter().map(text_of).collect::<Vec<_>>(),
        "no turn is dropped when there is no summary to replace it with"
    );
}

#[tokio::test]
async fn a_transcript_shorter_than_the_preserved_tail_is_left_alone() {
    let plan = ContextCompactionPlan {
        max_context_tokens: 1_000,
        preserve_recent_messages: 5,
        preserve_system_messages: true,
        summary_instructions: "Condense this".to_owned(),
    };
    let summarizer = StubSummarizer::new(Some("ROLLED UP"));
    let strategy = plan.strategy(summarizer.clone());
    let events = vec![
        turn("system", "system", "SYSTEM PROMPT"),
        turn("user", "user", &"y".repeat(40_000)),
    ];

    let compacted = strategy
        .compact(events.clone(), 1_000)
        .await
        .expect("compaction succeeds");

    assert_eq!(summarizer.calls(), 0);
    assert_eq!(compacted.len(), events.len());
}
