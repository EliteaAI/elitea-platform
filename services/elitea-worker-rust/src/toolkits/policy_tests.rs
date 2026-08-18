use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::policy::{ToolAdmissionDecision, ToolAdmissionPolicy, ToolAdmissionPolicyErrorCode};
use super::snapshot::FrozenToolSnapshot;
use crate::agents::request::{
    AgentExecutionKind, AgentExecutionPayload, AgentExecutionRequest, AgentInputBinding,
    NextInputSuggestionPolicy, UserInput,
};

fn policy(blocked_toolkits: &[&str], blocked_tools: &[(&str, &[&str])]) -> ToolAdmissionPolicy {
    let blocked_toolkits = blocked_toolkits
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let blocked_tools = blocked_tools
        .iter()
        .map(|(toolkit, tools)| {
            (
                (*toolkit).to_owned(),
                tools.iter().map(ToString::to_string).collect::<Vec<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    ToolAdmissionPolicy::new(&blocked_toolkits, &blocked_tools).expect("policy")
}

#[test]
fn toolkit_and_tool_matching_preserve_the_sdk_canonical_contract() {
    let policy = policy(
        &["Data_Analysis"],
        &[("GitHub", &["Create-File", "Delete_Repo"])],
    );

    for toolkit in [
        "data_analysis",
        "data-analysis",
        "DataAnalysis",
        "Data Analysis",
    ] {
        assert_eq!(
            policy.toolkit_decision(toolkit),
            ToolAdmissionDecision::BlockedToolkit
        );
    }
    for tool in [
        "create_file",
        "CreateFile",
        "create-file",
        "Create File",
        "github___CreateFile",
        "github:create-file",
    ] {
        assert_eq!(
            policy.tool_decision("github", tool),
            ToolAdmissionDecision::BlockedTool
        );
    }
    assert_eq!(
        policy.tool_decision("github", "get_issue"),
        ToolAdmissionDecision::Allowed
    );
    assert_eq!(
        policy.tool_decision("artifacts", "CreateFile"),
        ToolAdmissionDecision::Allowed
    );
}

#[test]
fn separator_only_and_duplicate_entries_do_not_create_ambiguous_membership() {
    let policy = policy(
        &["---", "  ", "shell", "S-H-E-L-L"],
        &[
            ("***", &["create_file"]),
            ("*", &["create_file"]),
            ("github", &["---", "delete_repo"]),
        ],
    );

    assert_eq!(policy.toolkit_decision(""), ToolAdmissionDecision::Allowed);
    assert_eq!(
        policy.toolkit_decision("shell"),
        ToolAdmissionDecision::BlockedToolkit
    );
    assert_eq!(
        policy.tool_decision("github", "delete-repo"),
        ToolAdmissionDecision::BlockedTool
    );
    assert_eq!(
        policy.tool_decision("github", "---"),
        ToolAdmissionDecision::Allowed
    );
    assert_eq!(
        policy.tool_decision("filesystem", "create_file"),
        ToolAdmissionDecision::Allowed,
        "the current blocked-tool policy has no global wildcard"
    );
}

#[test]
fn whole_toolkit_policy_filters_the_frozen_snapshot_before_materialization() {
    let request = request(vec![
        configured_tool(19, "sharepoint", "team_docs"),
        configured_tool(20, "github", "source"),
    ]);
    let snapshot = FrozenToolSnapshot::from_request(&request).expect("snapshot");
    let admitted = snapshot.apply_policy(&policy(&["Share Point"], &[]));
    let references = admitted.iter().collect::<Vec<_>>();

    assert_eq!(admitted.len(), 1);
    assert_eq!(references[0].tool_type(), "github");
}

#[test]
fn configuration_growth_is_bounded_and_diagnostics_are_data_free() {
    let oversized_identifier = format!("secret-{}", "x".repeat(1_024));
    let error = ToolAdmissionPolicy::new(
        std::slice::from_ref(&oversized_identifier),
        &BTreeMap::new(),
    )
    .err()
    .expect("oversized policy must fail");

    assert_eq!(
        error.code(),
        ToolAdmissionPolicyErrorCode::ResourceExhausted
    );
    let diagnostics = format!("{error:?} {error}");
    assert!(!diagnostics.contains(&oversized_identifier));

    let too_many = (0..16_385)
        .map(|index| format!("toolkit-{index}"))
        .collect::<Vec<_>>();
    assert_eq!(
        ToolAdmissionPolicy::new(&too_many, &BTreeMap::new())
            .err()
            .expect("policy entry count must be bounded")
            .code(),
        ToolAdmissionPolicyErrorCode::ResourceExhausted
    );
}

fn configured_tool(id: u64, tool_type: &str, toolkit_name: &str) -> Value {
    json!({
        "id": id,
        "type": tool_type,
        "toolkit_name": toolkit_name,
        "settings": {"selected_tools": ["read"]}
    })
}

fn request(tools: Vec<Value>) -> AgentExecutionRequest {
    AgentExecutionRequest {
        kind: AgentExecutionKind::Adhoc,
        binding: AgentInputBinding {
            input_bundle_id: "bundle-1".to_owned(),
            input_bundle_digest: [1; 32],
            request_entry_id: "request-1".to_owned(),
            request_immutable_version: "version-1".to_owned(),
            request_content_digest: [2; 32],
        },
        payload: AgentExecutionPayload {
            llm: Map::new(),
            chat_history: Vec::new(),
            user_input: UserInput::Text("question".to_owned()),
            thread_id: Some("thread-1".to_owned()),
            checkpoint_id: None,
            debug: false,
            tools,
            application: json!({"instructions": "answer carefully"})
                .as_object()
                .cloned()
                .expect("fixture object"),
            internal_tools: Vec::new(),
            steps_limit: None,
            mcp_tokens: Map::new(),
            ignored_mcp_servers: Vec::new(),
            user_declined_mcp_servers: Vec::new(),
            should_continue: false,
            hitl_resume: false,
            hitl_action: None,
            hitl_value: None,
            hitl_decisions: Vec::new(),
            execution_generation: Some("generation-1".to_owned()),
            is_regenerate: false,
            meta: Map::new(),
            conversation_id: Some("conversation-1".to_owned()),
            persona: "generic".to_owned(),
            context_settings: Map::new(),
            supports_vision: false,
            return_chat_history: false,
            invoked_skills: Vec::new(),
            applied_skills: Vec::new(),
            auto_approve_sensitive_actions: false,
            attached_skills: Vec::new(),
            input_attachments: Vec::new(),
            parallel_reconcile: None,
            parallel_terminal_errors: Vec::new(),
            exception_handling_enabled: None,
            debug_mode: None,
            next_input_suggestion: NextInputSuggestionPolicy::default(),
        },
    }
}
