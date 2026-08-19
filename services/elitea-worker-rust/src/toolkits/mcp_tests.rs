use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use adk_rust::tool::{BasicToolset, SimpleToolContext};
use adk_rust::{ErrorCategory, ErrorComponent, ReadonlyContext, Tool, ToolContext, Toolset};
use async_trait::async_trait;
use serde_json::{Value, json};

use super::mcp::{
    McpConnector, McpMaterializationError, McpMaterializationErrorCode, RemoteMcpConfig,
    materialize_mcp_toolsets,
};
use super::policy::ToolAdmissionPolicy;
use super::snapshot::FrozenToolSnapshot;

fn policy(blocked: &[&str]) -> Arc<ToolAdmissionPolicy> {
    let blocked_tools = if blocked.is_empty() {
        BTreeMap::new()
    } else {
        BTreeMap::from([(
            "mcp".to_owned(),
            blocked.iter().map(ToString::to_string).collect(),
        )])
    };
    Arc::new(ToolAdmissionPolicy::new(&[], &blocked_tools).expect("MCP fixture policy"))
}

fn frozen(tool_type: &str, settings: &Value) -> serde_json::Map<String, Value> {
    json!({
        "tools": [{
            "id": 41,
            "type": tool_type,
            "toolkit_name": "release intelligence",
            "settings": settings
        }]
    })
    .as_object()
    .cloned()
    .expect("MCP version object")
}

fn settings(selected_tools: &[&str]) -> Value {
    json!({
        "url": "https://mcp.example.invalid/v1/mcp",
        "headers": null,
        "client_id": null,
        "client_secret": null,
        "scopes": null,
        "timeout": "12",
        "selected_tools": selected_tools,
        "enable_caching": true,
        "cache_ttl": "300",
        "ssl_verify": true
    })
}

fn context() -> Arc<SimpleToolContext> {
    Arc::new(
        SimpleToolContext::new("mcp-test")
            .with_session_id("session-1")
            .with_function_call_id("call-1"),
    )
}

struct FixtureConnector {
    calls: AtomicUsize,
    endpoints: Mutex<Vec<String>>,
    tools: Vec<Arc<dyn Tool>>,
}

impl FixtureConnector {
    fn new(tools: Vec<Arc<dyn Tool>>) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            endpoints: Mutex::new(Vec::new()),
            tools,
        }
    }
}

#[async_trait]
impl McpConnector for FixtureConnector {
    async fn connect(
        &self,
        config: &RemoteMcpConfig,
    ) -> Result<Arc<dyn Toolset>, McpMaterializationError> {
        self.calls.fetch_add(1, Ordering::AcqRel);
        self.endpoints
            .lock()
            .expect("fixture endpoints")
            .push(config.endpoint().to_owned());
        assert_eq!(config.timeout(), Duration::from_secs(12));
        Ok(Arc::new(BasicToolset::new(
            "fixture_mcp",
            self.tools.clone(),
        )))
    }
}

struct FixtureTool {
    name: &'static str,
    description: &'static str,
    read_only: bool,
    result: Value,
    calls: Arc<AtomicUsize>,
}

impl FixtureTool {
    fn new(name: &'static str, read_only: bool, result: Value) -> (Arc<Self>, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        (
            Arc::new(Self {
                name,
                description: "Look up release evidence for a concrete query.",
                read_only,
                result,
                calls: calls.clone(),
            }),
            calls,
        )
    }
}

#[async_trait]
impl Tool for FixtureTool {
    fn name(&self) -> &str {
        self.name
    }

    fn description(&self) -> &str {
        self.description
    }

    fn parameters_schema(&self) -> Option<Value> {
        Some(json!({
            "type": "object",
            "properties": {"query": {"type": "string", "maxLength": 1024}},
            "required": ["query"],
            "additionalProperties": false
        }))
    }

    fn is_read_only(&self) -> bool {
        self.read_only
    }

    fn is_concurrency_safe(&self) -> bool {
        self.read_only
    }

    async fn execute(
        &self,
        _context: Arc<dyn ToolContext>,
        _arguments: Value,
    ) -> adk_rust::Result<Value> {
        self.calls.fetch_add(1, Ordering::AcqRel);
        Ok(self.result.clone())
    }
}

#[tokio::test]
async fn direct_https_mcp_discovers_filters_describes_and_executes_native_adk_tools() {
    let (lookup, lookup_calls) = FixtureTool::new("lookup_release", true, json!({"risk": "low"}));
    let (mutate, mutate_calls) = FixtureTool::new("publish_release", false, json!({"ok": true}));
    let connector = FixtureConnector::new(vec![lookup, mutate]);
    let version = frozen("mcp", &settings(&["LOOKUP_RELEASE"]));
    let snapshot = FrozenToolSnapshot::from_version_details(&version)
        .expect("MCP snapshot")
        .apply_policy(policy(&[]).as_ref());
    let toolsets = materialize_mcp_toolsets(&snapshot, &connector, &policy(&[]))
        .await
        .expect("materialized MCP toolset");

    assert_eq!(connector.calls.load(Ordering::Acquire), 1);
    assert_eq!(
        connector
            .endpoints
            .lock()
            .expect("fixture endpoints")
            .as_slice(),
        ["https://mcp.example.invalid/v1/mcp"]
    );
    assert_eq!(toolsets.len(), 1);
    let readonly: Arc<dyn ReadonlyContext> = context();
    let tools = toolsets[0].tools(readonly).await.expect("MCP ADK tools");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name(), "lookup_release");
    assert!(tools[0].description().contains("release intelligence"));
    assert!(
        tools[0]
            .description()
            .contains("marks this operation read-only")
    );
    assert!(!tools[0].description().contains("mcp.example.invalid"));
    assert!(tools[0].is_read_only());
    assert!(tools[0].is_concurrency_safe());

    let result = tools[0]
        .execute(context(), json!({"query": "1.2"}))
        .await
        .expect("MCP tool result");
    assert_eq!(result, json!({"risk": "low"}));
    assert_eq!(lookup_calls.load(Ordering::Acquire), 1);
    assert_eq!(mutate_calls.load(Ordering::Acquire), 0);
}

#[tokio::test]
async fn invalid_or_unowned_mcp_authority_fails_before_connecting() {
    let cases = [
        ("mcp_config", settings(&[])),
        (
            "mcp",
            json!({
                "url": "http://mcp.example.invalid/mcp",
                "selected_tools": []
            }),
        ),
        (
            "mcp",
            json!({
                "url": "https://mcp.example.invalid/mcp",
                "headers": {"Authorization": "Bearer secret"},
                "selected_tools": []
            }),
        ),
        (
            "mcp",
            json!({
                "url": "https://mcp.example.invalid/mcp",
                "ssl_verify": false,
                "selected_tools": []
            }),
        ),
    ];
    for (tool_type, settings) in cases {
        let connector = FixtureConnector::new(Vec::new());
        let version = frozen(tool_type, &settings);
        let snapshot = FrozenToolSnapshot::from_version_details(&version)
            .expect("MCP snapshot")
            .apply_policy(policy(&[]).as_ref());
        let Err(error) = materialize_mcp_toolsets(&snapshot, &connector, &policy(&[])).await else {
            panic!("unowned MCP authority must fail");
        };
        assert!(matches!(
            error.code(),
            McpMaterializationErrorCode::InvalidConfiguration
                | McpMaterializationErrorCode::UnsupportedAuthority
        ));
        assert_eq!(connector.calls.load(Ordering::Acquire), 0);
        let diagnostics = format!("{error:?} {error}");
        assert!(!diagnostics.contains("secret"));
        assert!(!diagnostics.contains("mcp.example.invalid"));
    }
}

#[tokio::test]
async fn unknown_selection_and_blocked_tools_fail_or_filter_before_execution() {
    let (lookup, calls) = FixtureTool::new("lookup_release", true, json!({"risk": "low"}));
    let connector = FixtureConnector::new(vec![lookup]);
    let unknown = frozen("mcp", &settings(&["missing_tool"]));
    let snapshot = FrozenToolSnapshot::from_version_details(&unknown)
        .expect("MCP snapshot")
        .apply_policy(policy(&[]).as_ref());
    let Err(error) = materialize_mcp_toolsets(&snapshot, &connector, &policy(&[])).await else {
        panic!("unknown MCP selection must fail");
    };
    assert_eq!(
        error.code(),
        McpMaterializationErrorCode::InvalidConfiguration
    );

    let blocked = frozen("mcp", &settings(&[]));
    let snapshot = FrozenToolSnapshot::from_version_details(&blocked)
        .expect("MCP snapshot")
        .apply_policy(policy(&["lookup_release"]).as_ref());
    let toolsets = materialize_mcp_toolsets(&snapshot, &connector, &policy(&["lookup_release"]))
        .await
        .expect("blocked MCP toolset");
    let readonly: Arc<dyn ReadonlyContext> = context();
    assert!(
        toolsets[0]
            .tools(readonly)
            .await
            .expect("blocked tools")
            .is_empty()
    );
    assert_eq!(calls.load(Ordering::Acquire), 0);
}

#[tokio::test]
async fn oversized_mcp_results_are_redacted_and_never_retried() {
    let secret = "provider-result-secret";
    let (tool, calls) = FixtureTool::new(
        "lookup_release",
        false,
        json!({"data": format!("{secret}{}", "x".repeat(512 * 1_024))}),
    );
    let connector = FixtureConnector::new(vec![tool]);
    let version = frozen("mcp", &settings(&[]));
    let snapshot = FrozenToolSnapshot::from_version_details(&version)
        .expect("MCP snapshot")
        .apply_policy(policy(&[]).as_ref());
    let toolsets = materialize_mcp_toolsets(&snapshot, &connector, &policy(&[]))
        .await
        .expect("MCP toolset");
    let readonly: Arc<dyn ReadonlyContext> = context();
    let tool = toolsets[0]
        .tools(readonly)
        .await
        .expect("MCP tools")
        .pop()
        .expect("MCP fixture tool");
    let error = tool
        .execute(context(), json!({"query": "risk"}))
        .await
        .expect_err("oversized MCP result");

    assert_eq!(calls.load(Ordering::Acquire), 1);
    assert_eq!(error.component, ErrorComponent::Tool);
    assert_eq!(error.category, ErrorCategory::Internal);
    assert!(!error.is_retryable());
    assert!(!format!("{error:?} {error}").contains(secret));
}
