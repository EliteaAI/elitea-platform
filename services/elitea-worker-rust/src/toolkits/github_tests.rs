use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use adk_rust::tool::SimpleToolContext;
use adk_rust::{ReadonlyContext, Tool, ToolContext, Toolset};
use async_trait::async_trait;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::StatusCode;
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue, RETRY_AFTER};
use serde_json::{Map, Value, json};

use super::families::github::client::{
    GitHubApi, GitHubClient, GitHubClientError, GitHubClientErrorCode, GitHubFileScope,
    GitHubRequestKind, test_map_status, test_project_branches, test_project_issue_detail,
    test_project_issue_list, test_project_issue_search, test_project_text_file,
    test_project_tree_files, test_project_tree_sha, test_project_user, test_validate_file_path,
};
use super::families::github::config::{GitHubAuthKind, GitHubToolkitConfig};
use super::families::github::pull_requests::{
    test_project_pull_request_detail, test_project_pull_request_files,
    test_project_pull_request_list,
};
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

    let content = base64::engine::general_purpose::STANDARD.encode("alpha\nbeta\n");
    assert_eq!(
        test_project_text_file(&json!({
            "type": "file",
            "encoding": "base64",
            "size": 11,
            "content": format!("{}\n", content)
        }))
        .expect("valid GitHub text file"),
        "alpha\nbeta\n"
    );
    assert!(
        test_project_text_file(&json!({
            "type": "file",
            "encoding": "base64",
            "size": 2,
            "content": "/w=="
        }))
        .is_err()
    );
    assert!(test_validate_file_path("src/lib.rs").is_ok());
    for invalid_path in ["/etc/passwd", "../secret", "src/../secret", "src//lib.rs"] {
        assert!(test_validate_file_path(invalid_path).is_err());
    }

    let tree = json!({
        "truncated": false,
        "tree": [
            {"path": "README.md", "type": "blob"},
            {"path": "src", "type": "tree"},
            {"path": "src/lib.rs", "type": "blob"},
            {"path": "src/nested/mod.rs", "type": "blob"},
            {"path": "vendor/dependency", "type": "commit"}
        ]
    });
    assert_eq!(
        test_project_tree_files(&tree, "src").expect("bounded recursive tree"),
        json!(["src/lib.rs", "src/nested/mod.rs"])
    );
    assert!(test_project_tree_files(&json!({"truncated": true, "tree": []}), "").is_err());
    assert_eq!(
        test_project_tree_sha(&json!({
            "commit": {"commit": {"tree": {"sha": "A".repeat(40)}}}
        }))
        .expect("branch tree SHA"),
        "a".repeat(40)
    );
}

#[test]
fn issue_projection_matches_the_current_sdk_fields_and_is_bounded() {
    let issue = json!({
        "number": 42,
        "title": "Bound the worker",
        "body": "Issue body",
        "state": "open",
        "html_url": "https://github.example.test/EliteaAI/elitea-platform/issues/42",
        "created_at": "2026-08-18T10:00:00Z",
        "updated_at": "2026-08-18T11:00:00Z",
        "comments": 3,
        "labels": [{"name": "rust"}],
        "assignees": [{"login": "octocat"}],
        "raw_secret_field": "must not project"
    });
    assert_eq!(
        test_project_issue_detail(&issue).expect("bounded issue detail"),
        json!({
            "number": 42,
            "title": "Bound the worker",
            "body": "Issue body",
            "state": "open",
            "url": "https://github.example.test/EliteaAI/elitea-platform/issues/42",
            "created_at": "2026-08-18T10:00:00+00:00",
            "updated_at": "2026-08-18T11:00:00+00:00",
            "comments": 3,
            "labels": ["rust"],
            "assignees": ["octocat"]
        })
    );
    assert_eq!(
        test_project_issue_list(&json!([issue.clone()])).expect("bounded issue list"),
        json!([{
            "number": 42,
            "title": "Bound the worker",
            "state": "open",
            "created_at": "2026-08-18T10:00:00+00:00",
            "updated_at": "2026-08-18T11:00:00+00:00",
            "url": "https://github.example.test/EliteaAI/elitea-platform/issues/42",
            "labels": ["rust"],
            "assignees": ["octocat"]
        }])
    );
    assert_eq!(
        test_project_issue_search(
            &json!({"total_count": 1, "items": [{
                "number": 42,
                "title": "Bound the worker",
                "body": null,
                "state": "open",
                "html_url": "https://github.example.test/EliteaAI/elitea-platform/pull/42",
                "pull_request": {"url": "ignored"}
            }]}),
            30,
        )
        .expect("bounded issue search"),
        json!([{
            "id": 42,
            "title": "Bound the worker",
            "description": null,
            "status": "open",
            "url": "https://github.example.test/EliteaAI/elitea-platform/pull/42",
            "entity_type": "PR"
        }])
    );
    assert_eq!(
        test_project_issue_search(&json!({"total_count": 0, "items": []}), 30)
            .expect("empty issue search"),
        Value::String("No issues or PRs found matching your query.".to_owned())
    );
    assert!(
        test_project_issue_detail(&json!({
            "number": 1,
            "title": "x",
            "body": "x".repeat(128 * 1_024 + 1),
            "state": "open",
            "html_url": "https://github.example.test/issue/1",
            "created_at": "2026-08-18T10:00:00Z",
            "updated_at": "2026-08-18T10:00:00Z",
            "comments": 0,
            "labels": [],
            "assignees": []
        }))
        .is_err()
    );
}

#[test]
fn pull_request_projection_is_complete_typed_and_bounded() {
    let pull = pull_request_fixture();
    assert_eq!(
        test_project_pull_request_list(&json!([pull.clone()]), 1)
            .expect("bounded pull-request list"),
        json!([{
            "number": 42,
            "title": "Bound the worker",
            "state": "open",
            "created_at": "2026-08-18T10:00:00+00:00",
            "updated_at": null,
            "html_url": "https://github.example.test/EliteaAI/elitea-platform/pull/42",
            "user": null,
            "head": "feature/runtime",
            "base": "main"
        }])
    );
    assert_eq!(
        test_project_pull_request_detail(
            &pull,
            &json!([{"body": "Looks good", "user": {"login": "reviewer"}}]),
            &json!([{"commit": {"message": "feat: bound output"}}]),
            42,
        )
        .expect("bounded typed pull-request detail"),
        json!({
            "title": "Bound the worker",
            "number": 42,
            "body": null,
            "pr_url": "https://github.example.test/EliteaAI/elitea-platform/pull/42",
            "state": "open",
            "head": "feature/runtime",
            "base": "main",
            "comments": [{"body": "Looks good", "user": "reviewer"}],
            "commits": [{"message": "feat: bound output"}]
        })
    );
}

#[test]
fn pull_request_file_projection_is_complete_and_bounded() {
    let pull = pull_request_fixture();
    assert_eq!(
        test_project_pull_request_files(
            &pull,
            &[json!([
                {
                    "filename": "src/lib.rs",
                    "status": "modified",
                    "additions": 2,
                    "deletions": 1,
                    "changes": 3,
                    "patch": "@@ -1 +1 @@"
                },
                {
                    "filename": "src/new.rs",
                    "status": "added",
                    "additions": 1,
                    "deletions": 0,
                    "changes": 1,
                    "patch": null
                }
            ])],
            42,
        )
        .expect("bounded pull-request files"),
        json!([
            {
                "path": "src/lib.rs",
                "patch": "@@ -1 +1 @@",
                "filename": "src/lib.rs",
                "status": "modified",
                "additions": 2,
                "deletions": 1,
                "changes": 3
            },
            {
                "path": "src/new.rs",
                "patch": null,
                "filename": "src/new.rs",
                "status": "added",
                "additions": 1,
                "deletions": 0,
                "changes": 1
            }
        ])
    );
    let mut oversized = pull;
    oversized["changed_files"] = json!(301);
    assert!(test_project_pull_request_files(&oversized, &[], 42).is_err());
    let mut incomplete = pull_request_fixture();
    incomplete["changed_files"] = json!(1);
    assert!(test_project_pull_request_files(&incomplete, &[json!([])], 42).is_err());
}

#[test]
fn pull_request_detail_rejects_an_over_limit_collection() {
    assert!(
        test_project_pull_request_detail(
            &pull_request_fixture(),
            &Value::Array(
                (0..11)
                    .map(|_| json!({"body": null, "user": null}))
                    .collect(),
            ),
            &json!([]),
            42,
        )
        .is_err()
    );
}

fn pull_request_fixture() -> Value {
    json!({
        "number": 42,
        "title": "Bound the worker",
        "body": null,
        "state": "open",
        "html_url": "https://github.example.test/EliteaAI/elitea-platform/pull/42",
        "created_at": "2026-08-18T10:00:00Z",
        "updated_at": null,
        "user": null,
        "head": {"ref": "feature/runtime"},
        "base": {"ref": "main"},
        "changed_files": 2
    })
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

async fn native_file_tools(client: &Arc<FixtureGitHubApi>) -> Vec<Arc<dyn Tool>> {
    let selected = vec![
        "read_file".to_owned(),
        "read_multiple_files".to_owned(),
        "grep_file".to_owned(),
    ];
    let toolset = test_build_with_api(
        "team-github",
        "EliteaAI/elitea-platform",
        &selected,
        &policy(&[]),
        &(client.clone() as Arc<dyn GitHubApi>),
    )
    .expect("native GitHub file toolset");
    let readonly: Arc<dyn ReadonlyContext> = context();
    toolset
        .tools(readonly)
        .await
        .expect("native GitHub file tools")
}

fn insert_file(client: &FixtureGitHubApi, path: &str, content: String) {
    client
        .files
        .lock()
        .expect("file fixture lock")
        .insert(path.to_owned(), content);
}

#[tokio::test]
async fn native_read_file_preserves_python_line_slicing_and_guidance() {
    let client = Arc::new(FixtureGitHubApi::default());
    insert_file(
        &client,
        "src/main.py",
        "alpha\r\nbeta\u{2028}gamma\ndelta".to_owned(),
    );
    insert_file(&client, "large.py", "x\n".repeat(100_001));
    let tools = native_file_tools(&client).await;

    let read_file = tools
        .iter()
        .find(|tool| tool.name() == "read_file")
        .expect("read_file tool");
    assert_eq!(
        read_file
            .execute(
                context(),
                json!({
                    "file_path": "src/main.py",
                    "branch": "release/v2",
                    "repo_name": "EliteaAI/other",
                    "start_line": 2,
                    "end_line": 3
                }),
            )
            .await
            .expect("bounded GitHub file read"),
        Value::String("beta\u{2028}gamma\n".to_owned())
    );
    let guidance = read_file
        .execute(context(), json!({"file_path": "large.py"}))
        .await
        .expect("large-file guidance");
    assert_eq!(
        guidance,
        json!({
            "__result_status__": "content_too_large",
            "context": {
                "actual_chars": 200_002,
                "limit_chars": 200_000,
                "requested": "full file read"
            },
            "extension": ".py",
            "filename": "large.py",
            "instruction_for_readFile": {
                "extra_params": {},
                "first_class_params": {
                    "end_line": "integer (1-indexed, inclusive) — last line to read. Valid range 1..100001. Omit to read to the end.",
                    "start_line": "integer (1-indexed, inclusive) — first line to read. Valid range 1..100001. Omit to read from the beginning."
                },
                "notes": "Use start_line/end_line together to read a bounded slice of a large file and keep tokens bounded."
            },
            "read_limits": {
                "full_read_allowed": false,
                "max_output_chars": 200_000
            },
            "schema_version": "1.0",
            "total_lines": 100_001,
            "type": "text/x-python",
            "unit": "lines"
        })
    );
    assert!(
        client
            .file_calls
            .lock()
            .expect("file call fixture lock")
            .iter()
            .any(|call| {
                call == &(
                    "src/main.py".to_owned(),
                    Some("release/v2".to_owned()),
                    Some("EliteaAI/other".to_owned()),
                )
            })
    );
}

#[tokio::test]
async fn native_grep_and_batch_reads_are_bounded_before_network_use() {
    let client = Arc::new(FixtureGitHubApi::default());
    insert_file(
        &client,
        "search.rs",
        "before\nfn Main() {}\nafter\nlast".to_owned(),
    );
    insert_file(&client, "budget.txt", "x".repeat(200_000));
    insert_file(&client, "must-not-fetch.txt", "unreachable".to_owned());
    let tools = native_file_tools(&client).await;
    let grep = tools
        .iter()
        .find(|tool| tool.name() == "grep_file")
        .expect("grep_file tool");
    assert_eq!(
        grep.execute(
            context(),
            json!({
                "file_path": "search.rs",
                "pattern": "fn main\\(\\)",
                "is_regex": true,
                "context_lines": 1
            }),
        )
        .await
        .expect("bounded regex search"),
        Value::String(
            "Found 1 match(es) for pattern 'fn main\\(\\)' in search.rs:\n\n\n--- Match 1 at line 2 ---\n  before\n> fn Main() {}\n  after"
                .to_owned()
        )
    );
    let calls_before_invalid_regex = client
        .file_calls
        .lock()
        .expect("file call fixture lock")
        .len();
    assert!(
        grep.execute(
            context(),
            json!({"file_path": "search.rs", "pattern": "[", "is_regex": true}),
        )
        .await
        .is_err()
    );
    assert_eq!(
        client
            .file_calls
            .lock()
            .expect("file call fixture lock")
            .len(),
        calls_before_invalid_regex
    );

    let read_multiple = tools
        .iter()
        .find(|tool| tool.name() == "read_multiple_files")
        .expect("read_multiple_files tool");
    assert_eq!(
        read_multiple
            .execute(
                context(),
                json!({"file_paths": ["budget.txt", "must-not-fetch.txt"]}),
            )
            .await
            .expect("capped batch read"),
        json!({
            "budget.txt": "x".repeat(200_000),
            "must-not-fetch.txt": "Skipped: the batch's cumulative 200000-character read limit was already reached by earlier files in this call. Read this file individually with read_file."
        })
    );
    let calls = client.file_calls.lock().expect("file call fixture lock");
    assert!(
        !calls
            .iter()
            .any(|(path, _, _)| path == "must-not-fetch.txt")
    );
}

#[tokio::test]
async fn native_repository_navigation_uses_the_admitted_base_and_active_scopes() {
    let client = Arc::new(FixtureGitHubApi::default());
    let selected = vec![
        "list_files_in_main_branch".to_owned(),
        "list_files_in_bot_branch".to_owned(),
        "get_files_from_directory".to_owned(),
    ];
    let toolset = test_build_with_api(
        "team-github",
        "EliteaAI/elitea-platform",
        &selected,
        &policy(&[]),
        &(client.clone() as Arc<dyn GitHubApi>),
    )
    .expect("native GitHub navigation toolset");
    let readonly: Arc<dyn ReadonlyContext> = context();
    let tools = toolset.tools(readonly).await.expect("navigation tools");

    for (name, arguments) in [
        ("list_files_in_main_branch", json!({})),
        ("list_files_in_bot_branch", json!({})),
        (
            "get_files_from_directory",
            json!({"directory_path": "/src/nested/"}),
        ),
    ] {
        let tool = tools
            .iter()
            .find(|tool| tool.name() == name)
            .expect("selected navigation tool");
        assert_eq!(
            tool.execute(context(), arguments)
                .await
                .expect("repository file list"),
            json!(["src/lib.rs", "src/nested/mod.rs"])
        );
    }
    assert_eq!(
        client
            .file_list_calls
            .lock()
            .expect("file list call fixture lock")
            .as_slice(),
        &[
            (GitHubFileScope::BaseBranch, None),
            (GitHubFileScope::ActiveBranch, None),
            (
                GitHubFileScope::ActiveBranch,
                Some("/src/nested/".to_owned())
            )
        ]
    );
}

#[tokio::test]
async fn native_issue_reads_preserve_the_current_sdk_schemas_and_bounds() {
    let client = Arc::new(FixtureGitHubApi::default());
    let selected = vec![
        "get_issues".to_owned(),
        "get_issue".to_owned(),
        "search_issues".to_owned(),
    ];
    let toolset = test_build_with_api(
        "team-github",
        "EliteaAI/elitea-platform",
        &selected,
        &policy(&[]),
        &(client.clone() as Arc<dyn GitHubApi>),
    )
    .expect("native GitHub issue toolset");
    let readonly: Arc<dyn ReadonlyContext> = context();
    let tools = toolset.tools(readonly).await.expect("issue tools");

    for (name, arguments) in [
        ("get_issues", json!({})),
        (
            "get_issue",
            json!({"issue_number": 42, "repo_name": "EliteaAI/other"}),
        ),
        (
            "search_issues",
            json!({
                "search_query": "is:open label:rust",
                "repo_name": "EliteaAI/other",
                "max_count": 17
            }),
        ),
    ] {
        let tool = tools
            .iter()
            .find(|tool| tool.name() == name)
            .expect("selected issue tool");
        assert!(tool.execute(context(), arguments).await.is_ok());
    }
    assert_eq!(
        client
            .issue_calls
            .lock()
            .expect("issue calls fixture lock")
            .as_slice(),
        &[
            "list".to_owned(),
            "get:42:EliteaAI/other".to_owned(),
            "search:is:open label:rust:EliteaAI/other:17".to_owned(),
        ]
    );

    let search = tools
        .iter()
        .find(|tool| tool.name() == "search_issues")
        .expect("search issues tool");
    let calls_before = client
        .issue_calls
        .lock()
        .expect("issue calls fixture lock")
        .len();
    assert!(
        search
            .execute(context(), json!({"search_query": "<script>alert(1)"}))
            .await
            .is_err()
    );
    assert_eq!(
        client
            .issue_calls
            .lock()
            .expect("issue calls fixture lock")
            .len(),
        calls_before
    );
}

#[tokio::test]
async fn native_pull_request_inspection_preserves_public_scope_and_limits() {
    let client = Arc::new(FixtureGitHubApi::default());
    let selected = vec![
        "list_open_pull_requests".to_owned(),
        "get_pull_request".to_owned(),
        "list_pull_request_diffs".to_owned(),
    ];
    let toolset = test_build_with_api(
        "team-github",
        "EliteaAI/elitea-platform",
        &selected,
        &policy(&[]),
        &(client.clone() as Arc<dyn GitHubApi>),
    )
    .expect("native pull-request toolset");
    let readonly: Arc<dyn ReadonlyContext> = context();
    let tools = toolset.tools(readonly).await.expect("pull-request tools");

    for (name, arguments) in [
        ("list_open_pull_requests", json!({"max_count": 17})),
        (
            "get_pull_request",
            json!({"pr_number": 42, "repo_name": "EliteaAI/other"}),
        ),
        (
            "list_pull_request_diffs",
            json!({"pr_number": 42, "repo_name": "EliteaAI/other"}),
        ),
    ] {
        let tool = tools
            .iter()
            .find(|tool| tool.name() == name)
            .expect("selected pull-request tool");
        assert!(tool.execute(context(), arguments).await.is_ok());
    }
    assert_eq!(
        client
            .pull_request_calls
            .lock()
            .expect("pull-request calls fixture lock")
            .as_slice(),
        &[
            "list:17".to_owned(),
            "get:42:EliteaAI/other".to_owned(),
            "files:42:EliteaAI/other".to_owned(),
        ]
    );
    let list = tools
        .iter()
        .find(|tool| tool.name() == "list_open_pull_requests")
        .expect("list pull requests tool");
    assert_eq!(
        list.parameters_schema()
            .and_then(|schema| schema.pointer("/properties/max_count/maximum").cloned()),
        Some(json!(100))
    );
    let detail = tools
        .iter()
        .find(|tool| tool.name() == "get_pull_request")
        .expect("get pull request tool");
    assert_eq!(
        detail
            .parameters_schema()
            .and_then(|schema| schema.get("required").cloned()),
        Some(json!(["pr_number"]))
    );
    assert!(
        list.execute(context(), json!({"max_count": null}))
            .await
            .is_ok()
    );
    assert_eq!(
        client
            .pull_request_calls
            .lock()
            .expect("pull-request calls fixture lock")
            .last(),
        Some(&"list:100".to_owned())
    );
    assert!(
        list.execute(context(), json!({"max_count": 101}))
            .await
            .is_err()
    );
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
    files: Mutex<BTreeMap<String, String>>,
    file_calls: Mutex<Vec<FileCall>>,
    file_list_calls: Mutex<Vec<FileListCall>>,
    issue_calls: Mutex<Vec<String>>,
    pull_request_calls: Mutex<Vec<String>>,
}

type FileCall = (String, Option<String>, Option<String>);
type FileListCall = (GitHubFileScope, Option<String>);

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

    async fn read_text_file(
        &self,
        file_path: &str,
        branch: Option<&str>,
        repository: Option<&str>,
    ) -> Result<String, GitHubClientError> {
        self.file_calls
            .lock()
            .expect("file call fixture lock")
            .push((
                file_path.to_owned(),
                branch.map(ToOwned::to_owned),
                repository.map(ToOwned::to_owned),
            ));
        Ok(self
            .files
            .lock()
            .expect("file fixture lock")
            .get(file_path)
            .cloned()
            .unwrap_or_default())
    }

    async fn list_repository_files(
        &self,
        scope: GitHubFileScope,
        directory_path: Option<&str>,
    ) -> Result<Value, GitHubClientError> {
        self.file_list_calls
            .lock()
            .expect("file list call fixture lock")
            .push((scope, directory_path.map(ToOwned::to_owned)));
        Ok(json!(["src/lib.rs", "src/nested/mod.rs"]))
    }

    async fn list_open_issues(&self) -> Result<Value, GitHubClientError> {
        self.issue_calls
            .lock()
            .expect("issue calls fixture lock")
            .push("list".to_owned());
        Ok(json!([]))
    }

    async fn get_issue(
        &self,
        issue_number: u64,
        repository: Option<&str>,
    ) -> Result<Value, GitHubClientError> {
        self.issue_calls
            .lock()
            .expect("issue calls fixture lock")
            .push(format!(
                "get:{issue_number}:{}",
                repository.unwrap_or("default")
            ));
        Ok(json!({"number": issue_number}))
    }

    async fn search_issues(
        &self,
        search_query: &str,
        repository: Option<&str>,
        max_count: usize,
    ) -> Result<Value, GitHubClientError> {
        self.issue_calls
            .lock()
            .expect("issue calls fixture lock")
            .push(format!(
                "search:{search_query}:{}:{max_count}",
                repository.unwrap_or("default")
            ));
        Ok(json!([]))
    }

    async fn list_open_pull_requests(&self, max_count: usize) -> Result<Value, GitHubClientError> {
        self.pull_request_calls
            .lock()
            .expect("pull-request calls fixture lock")
            .push(format!("list:{max_count}"));
        Ok(json!([]))
    }

    async fn get_pull_request(
        &self,
        pull_request_number: u64,
        repository: Option<&str>,
    ) -> Result<Value, GitHubClientError> {
        self.pull_request_calls
            .lock()
            .expect("pull-request calls fixture lock")
            .push(format!(
                "get:{pull_request_number}:{}",
                repository.unwrap_or("default")
            ));
        Ok(json!({"number": pull_request_number}))
    }

    async fn list_pull_request_files(
        &self,
        pull_request_number: u64,
        repository: Option<&str>,
    ) -> Result<Value, GitHubClientError> {
        self.pull_request_calls
            .lock()
            .expect("pull-request calls fixture lock")
            .push(format!(
                "files:{pull_request_number}:{}",
                repository.unwrap_or("default")
            ));
        Ok(json!([]))
    }
}
