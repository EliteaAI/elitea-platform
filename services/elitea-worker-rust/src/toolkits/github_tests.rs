use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use adk_rust::tool::SimpleToolContext;
use adk_rust::{ReadonlyContext, ToolContext, Toolset};
use async_trait::async_trait;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::StatusCode;
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue, RETRY_AFTER};
use serde_json::{Map, Value, json};

use super::families::github::client::{
    GitHubApi, GitHubClient, GitHubClientError, GitHubClientErrorCode, GitHubRequestKind,
    test_map_status, test_project_branches, test_project_user,
};
use super::families::github::config::{GitHubAuthKind, GitHubToolkitConfig};
use super::families::github::tools::{
    GitHubToolsetErrorCode, build_github_read_only_toolset, test_build_with_api,
};
use super::policy::ToolAdmissionPolicy;

const TEST_PKCS8_KEY_BODY: &str = "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDIp4UApaJQ247TbIW43Pg8S+GVMRT6qsdhbg6iSSL6a3qwH4VYLIFcw73rXtRnYrxTasyqi3JwWwDO8xay7FCPuWlyQbnjQjhBnMz3M57riwYhR69PWTL2E9m8CucL9tVtRDLoPhN2dYdTG/qd1WUxdBJEvnXovJImufpEtLihATWNfou3XQxySk8R7Od3diY/rv55YS6x1xZG536JgoZr4UAOr8NYDTE5tBqqc4AYc3LyLjW9VbKISWFlyIHtFU1YESRcUtVswJ1JFtTypQvPWuCiY39M+mv52q/BE9uoODtt19pt2Nsi2FEKjTEVmDMIkJoaAzJReqVeiW4VQkmzAgMBAAECggEAI6TukZDa5rY6BwDOOGq4hi2Moy4W5fiUdpBQdS+80PNq1gKjc2hkipATGs67uKnnfoIIXXtsFt1zpU+1ho9IOF/dhXh7hw1qZO1v07IN1xXZPuw3DkdwMBqSoT7mkE+G1mQ5DtyIJJD4OyFLQeJ4mXJfFGspEvD8nXiIJtBbw+3cMzbUJRYwTWfTxIHfkq7uuXUs1zn3hGm1Ku3WIQo/e3+y1eiecSTqJqrGGWLtZjB6689c59RI0leT6jM4tizOIQ3BkUXAetn/HRFbKZRcNFhh0e7+G6QIVTFX/wXHbLZsJWkPzHxNX2USoWqgpnmgiGZSGTbAt/CJ492NeX0K8QKBgQD4W6jcKVAjlu6SKrhVlhO8RdjYs4IC+Mi4/1eyhvCtgtPhrHxWb/5zHPrlYZrt3E5rdhvcshNkcOM9cS1MxwPCnJshs+eWnjXwkl+tWy3ceroc21xAhu9XHrPqNLuyX04YHV/B0Rg23aC+/C8aQmikq30yeLxFpTiz0jQdSDgnFwKBgQDO1BfuiMQBoDRDYfUx3NfwJXcw5AX81U625OU5aOZc5WBC3I/F4W5S5r3D3CbsiunD+JGxxEuR+xFjSinxQkT9hQ/Vjp5PX53wJ1WmGQmM/VyBlSN6htfCR/Y8ra9nuUiV1qphlTrckdy1wY2VreK/RG3QZcFRlrlv+mFWGXaTxQKBgQC/yYCHq3uQUDChPU4mAYPyAvomtdBzXQ0cF0rwuVXIl9vpTNqjoU6cNEfntM0AW/1O7OEtN3LUQHyq6Ogzfwf/VBJUH2p6nGhJA6/Q3jV3Kmrod9kwl0LiQvpqpRhA8WoMIzrcIA0T6WgFtBbnr1rBtxAyVpwFKEa2TmAiMK/0NwKBgDW7gCQmP9W0Sx+eWVcE6symzxpSgwO2XubA/JQ3nnFP3fxA1NExybmb3Hz/utUFGcohz6gBOSjJszC6Wb8l2kqKwRxYGuTAEIYNkgC+zG5mfBvmJPt2AKOmkmAdN06ZIjRbOpRzcoFPG6nUiPXz4M6T9nuHk/ugTri6sYLuxpGJAoGBALI0mlazlyncjdZYq8GNnN8HaQu6uMahky1cgJjnN5LSq8jC03gEhHwyPlFSmjKVXD0En2YyQC5dEZAtFde76EJMAqtU3ZbEDADY/0H1ajcguEPUXBtey/xQ2y5tWgsXtaF0PeIfamGlgC2pAnH72m5MbRKuM5IiUql/qXNlOreq";

fn settings(configuration: &Value, selected_tools: &[&str]) -> Map<String, Value> {
    json!({
        "github_configuration": configuration,
        "repository": "https://github.example.test/EliteaAI/elitea-platform.git",
        "active_branch": "feature/runtime",
        "base_branch": "main",
        "selected_tools": selected_tools,
        "pgvector_configuration": null,
        "embedding_model": null
    })
    .as_object()
    .expect("GitHub settings fixture")
    .clone()
}

fn token_config(selected_tools: &[&str]) -> GitHubToolkitConfig {
    GitHubToolkitConfig::parse(&settings(
        &json!({
            "configuration_type": "github",
            "base_url": "https://github.example.test/api/v3/",
            "access_token": "fixture-token",
            "username": "ignored-user",
            "password": "ignored-password"
        }),
        selected_tools,
    ))
    .expect("valid GitHub token configuration")
}

fn policy(blocked: &[(&str, &[&str])]) -> Arc<ToolAdmissionPolicy> {
    let blocked = blocked
        .iter()
        .map(|(toolkit, tools)| {
            (
                (*toolkit).to_owned(),
                tools.iter().map(ToString::to_string).collect::<Vec<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    Arc::new(ToolAdmissionPolicy::new(&[], &blocked).expect("GitHub policy fixture"))
}

fn context() -> Arc<SimpleToolContext> {
    Arc::new(
        SimpleToolContext::new("github-tool-test")
            .with_session_id("session-1")
            .with_function_call_id("call-1"),
    )
}

#[test]
fn current_materialized_configuration_preserves_auth_precedence_and_repository_shape() {
    let config = token_config(&["get_me", "list_branches_in_repo", "get_me"]);

    assert_eq!(config.auth_kind(), GitHubAuthKind::Token);
    assert_eq!(
        config.base_url().as_str(),
        "https://github.example.test/api/v3"
    );
    assert_eq!(config.repository(), "EliteaAI/elitea-platform");
    assert_eq!(config.active_branch(), "feature/runtime");
    assert_eq!(config.base_branch(), "main");
    assert_eq!(
        config.selected_tools(),
        [
            Box::<str>::from("get_me"),
            Box::<str>::from("list_branches_in_repo")
        ]
    );
}

#[test]
fn malformed_auth_origin_repository_and_bounds_fail_without_sensitive_diagnostics() {
    let secret = "fixture-secret-that-must-not-render";
    let cases = [
        settings(
            &json!({"base_url": "http://api.github.com", "access_token": secret}),
            &["get_me"],
        ),
        settings(
            &json!({"base_url": "https://user@api.github.com", "access_token": secret}),
            &["get_me"],
        ),
        settings(
            &json!({"base_url": "https://api.github.com", "username": "user"}),
            &["get_me"],
        ),
        settings(
            &json!({"base_url": "https://api.github.com", "app_private_key": secret}),
            &["get_me"],
        ),
    ];
    for mut case in cases {
        if case
            .get("github_configuration")
            .and_then(Value::as_object)
            .is_some_and(|configuration| configuration.contains_key("access_token"))
        {
            case.insert("repository".to_owned(), json!("too/many/segments"));
        }
        let Err(error) = GitHubToolkitConfig::parse(&case) else {
            panic!("invalid GitHub configuration was accepted");
        };
        let diagnostic = format!("{error:?} {error}");
        assert!(!diagnostic.contains(secret));
        assert!(!diagnostic.contains("github.com"));
    }

    let oversized = settings(
        &json!({"base_url": "https://api.github.com", "access_token": "x".repeat(64 * 1_024 + 1)}),
        &["get_me"],
    );
    assert!(GitHubToolkitConfig::parse(&oversized).is_err());
}

#[test]
fn request_builder_is_origin_bound_and_uses_the_current_auth_contract() {
    let client =
        GitHubClient::new(token_config(&["list_branches_in_repo"])).expect("GitHub token client");
    let request = client
        .test_request(
            GitHubRequestKind::Repository,
            &["repos", "EliteaAI", "elitea-platform", "branches"],
            &[("per_page", "17".to_owned())],
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        )
        .expect("origin-bound GitHub request");

    assert_eq!(
        request.url().as_str(),
        "https://github.example.test/api/v3/repos/EliteaAI/elitea-platform/branches?per_page=17"
    );
    assert_eq!(
        request
            .headers()
            .get(AUTHORIZATION)
            .expect("authorization header"),
        "token fixture-token"
    );
    assert_eq!(
        request
            .headers()
            .get("x-github-api-version")
            .expect("GitHub version header"),
        "2022-11-28"
    );
}

#[test]
fn github_app_probe_accepts_pkcs8_and_creates_a_short_lived_rs256_jwt() {
    let config = GitHubToolkitConfig::parse(&settings(
        &json!({
            "base_url": "https://api.github.com",
            "app_id": "123456",
            "app_private_key": format!("-----BEGIN PRIVATE KEY-----\n{TEST_PKCS8_KEY_BODY}\n-----END PRIVATE KEY-----")
        }),
        &["get_me"],
    ))
    .expect("valid GitHub App configuration");
    let client = GitHubClient::new(config).expect("GitHub App client");
    let now = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    let request = client
        .test_request(GitHubRequestKind::Probe, &[], &[], now)
        .expect("GitHub App probe request");

    assert_eq!(request.url().as_str(), "https://api.github.com/app");
    let authorization = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .expect("GitHub App authorization");
    let token = authorization
        .strip_prefix("Bearer ")
        .expect("GitHub App bearer token");
    let parts = token.split('.').collect::<Vec<_>>();
    assert_eq!(parts.len(), 3);
    let header: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(parts[0])
            .expect("GitHub App JWT header"),
    )
    .expect("GitHub App JWT header JSON");
    let payload: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(parts[1])
            .expect("GitHub App JWT payload"),
    )
    .expect("GitHub App JWT payload JSON");
    assert_eq!(header, json!({"alg": "RS256", "typ": "JWT"}));
    assert_eq!(payload["iss"], "123456");
    assert_eq!(payload["iat"], 1_700_000_000_u64);
    assert_eq!(payload["exp"], 1_700_000_600_u64);
    assert!(!parts[2].is_empty());
}

#[test]
fn response_projection_is_bounded_and_omits_unknown_or_null_fields() {
    let user = test_project_user(&json!({
        "login": "octocat",
        "id": 1,
        "name": null,
        "company": "GitHub",
        "raw_secret_field": "must not project"
    }))
    .expect("valid GitHub user response");
    assert_eq!(
        user,
        json!({"login": "octocat", "id": 1, "company": "GitHub"})
    );

    let branches = test_project_branches(
        &json!([
            {"name": "main", "protected": true, "commit": {"sha": "abc"}},
            {"name": "feature", "protected": false}
        ]),
        2,
    )
    .expect("valid GitHub branches response");
    assert_eq!(
        branches,
        json!([
            {"name": "main", "protected": true},
            {"name": "feature", "protected": false}
        ])
    );
    assert!(test_project_branches(&json!([{"name": "main", "protected": true}]), 0).is_err());
}

#[test]
fn github_rate_limits_remain_distinct_from_authorization_failures() {
    let permission = test_map_status(StatusCode::FORBIDDEN, &HeaderMap::new())
        .expect_err("plain forbidden must be an authorization failure");
    assert_eq!(permission.code(), GitHubClientErrorCode::Authorization);
    assert!(!permission.retryable());

    let mut primary_limit = HeaderMap::new();
    primary_limit.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
    let primary = test_map_status(StatusCode::FORBIDDEN, &primary_limit)
        .expect_err("exhausted primary limit must be rate limited");
    assert_eq!(primary.code(), GitHubClientErrorCode::RateLimited);
    assert!(primary.retryable());

    let mut secondary_limit = HeaderMap::new();
    secondary_limit.insert(RETRY_AFTER, HeaderValue::from_static("60"));
    let secondary = test_map_status(StatusCode::FORBIDDEN, &secondary_limit)
        .expect_err("secondary limit must be rate limited");
    assert_eq!(secondary.code(), GitHubClientErrorCode::RateLimited);
    assert!(secondary.retryable());
}

#[tokio::test]
async fn native_adk_tools_preserve_selection_policy_and_argument_contracts() {
    let client = Arc::new(FixtureGitHubApi::default());
    let selected = vec!["get_me".to_owned(), "list_branches_in_repo".to_owned()];
    let toolset = test_build_with_api(
        "team-github",
        "EliteaAI/elitea-platform",
        &selected,
        &policy(&[("github", &["get_me"])]),
        &(client.clone() as Arc<dyn GitHubApi>),
    )
    .expect("native GitHub toolset");
    let readonly: Arc<dyn ReadonlyContext> = context();
    let mut tools = toolset.tools(readonly).await.expect("native GitHub tools");

    assert_eq!(tools.len(), 1);
    let tool = tools.pop().expect("list branches tool");
    assert_eq!(tool.name(), "list_branches_in_repo");
    assert!(tool.is_read_only());
    assert!(tool.is_concurrency_safe());
    assert!(
        tool.description()
            .starts_with("Toolkit: team-github\nRepository:")
    );
    let invocation: Arc<dyn ToolContext> = context();
    let result = tool
        .execute(invocation, json!({"max_count": 7, "unused": null}))
        .await
        .expect("GitHub branch result");
    assert_eq!(result, json!([{"name": "main", "protected": true}]));
    assert_eq!(
        client
            .branch_limits
            .lock()
            .expect("branch limit calls")
            .as_slice(),
        &[7]
    );

    let invalid = tool
        .execute(context(), json!({"max_count": 101}))
        .await
        .expect_err("over-limit branch count");
    assert_eq!(invalid.code, "tool.execution.invalid_input");
}

#[test]
fn partial_profile_rejects_empty_or_unported_selection_before_network_use() {
    let Err(empty) = build_github_read_only_toolset("github", token_config(&[]), &policy(&[]))
    else {
        panic!("empty selection means the full unported SDK catalog");
    };
    assert_eq!(empty.code(), GitHubToolsetErrorCode::UnsupportedSelection);

    let Err(unsupported) =
        build_github_read_only_toolset("github", token_config(&["create_issue"]), &policy(&[]))
    else {
        panic!("write tool is not in the first read-only profile");
    };
    assert_eq!(
        unsupported.code(),
        GitHubToolsetErrorCode::UnsupportedSelection
    );
}

#[derive(Default)]
struct FixtureGitHubApi {
    branch_limits: Mutex<Vec<usize>>,
}

#[async_trait]
impl GitHubApi for FixtureGitHubApi {
    async fn get_authenticated_user(&self) -> Result<Value, GitHubClientError> {
        Ok(json!({"login": "octocat", "id": 1}))
    }

    async fn list_branches(&self, max_count: usize) -> Result<Value, GitHubClientError> {
        self.branch_limits
            .lock()
            .expect("branch limit fixture lock")
            .push(max_count);
        Ok(json!([{"name": "main", "protected": true}]))
    }
}
