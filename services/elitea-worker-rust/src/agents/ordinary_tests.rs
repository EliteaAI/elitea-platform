use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use http::{Request, Response, StatusCode, Version};
use http_body_util::Full;
use tonic::body::Body;

use super::assembly_tests::{current_text_history, ordinary_request};
use super::ordinary::OrdinaryNativeAgentAssembler;
use super::request::AgentExecutionKind;
use super::runtime::{
    AuthorizedNativeAssembly, NativeAgentAssembler, NativeAgentCompletionSelector,
};
use super::session::AuthorizedNativeCommandBinding;
use crate::protocol::control::test_runtime_context_authority;
use crate::protocol::node_event::encode_current_node_event_json;
use crate::transport::model_gateway::{
    TestModelGatewayOutcome, test_model_gateway_client, test_model_gateway_config,
    test_model_gateway_response,
};
use crate::transport::runtime_context::{
    RuntimeContextClient, RuntimeContextConfig, RuntimeContextRpc, RuntimeContextTransportError,
};

const TOKEN: &str = "ephemeral-ordinary-fixture-token";

struct RuntimeContextFixture {
    response: Mutex<Option<Response<Body>>>,
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl RuntimeContextRpc for RuntimeContextFixture {
    async fn post(
        &self,
        _request: Request<Body>,
    ) -> Result<Response<Body>, RuntimeContextTransportError> {
        self.calls.fetch_add(1, Ordering::AcqRel);
        self.response
            .lock()
            .map_err(|_| RuntimeContextTransportError::Unavailable)?
            .take()
            .ok_or(RuntimeContextTransportError::Unavailable)
    }
}

fn runtime_context_client() -> (RuntimeContextClient, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let raw = serde_json::json!({
        "schema_version": "elitea.runtime.elitea-client-token.v1",
        "project_id": 17,
        "token": TOKEN,
    })
    .to_string();
    let response = Response::builder()
        .status(StatusCode::OK)
        .version(Version::HTTP_2)
        .header("content-type", "application/json")
        .header("cache-control", "private, no-cache, no-store")
        .header("pragma", "no-cache")
        .header("content-length", raw.len())
        .body(Body::new(Full::new(Bytes::from(raw))))
        .expect("runtime-context fixture response");
    let client = RuntimeContextClient::with_rpc(
        RuntimeContextFixture {
            response: Mutex::new(Some(response)),
            calls: Arc::clone(&calls),
        },
        RuntimeContextConfig {
            origin: "https://content.internal".to_owned(),
            deadline: Duration::from_secs(1),
            max_response_bytes: 32 * 1_024,
        },
    )
    .expect("runtime-context fixture client");
    (client, calls)
}

fn model_response() -> Response<Body> {
    let raw = concat!(
        "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"native \"},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"response\"},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n",
        "data: [DONE]\n\n",
    );
    test_model_gateway_response(Body::new(Full::<Bytes>::from(raw)))
}

fn anthropic_response() -> Response<Body> {
    let raw = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_ordinary\",\"content\":[],\"model\":\"claude-sonnet-4-5\",\"role\":\"assistant\",\"type\":\"message\",\"usage\":{\"input_tokens\":3,\"output_tokens\":0}}}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"native Anthropic response\"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":3}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n",
    );
    test_model_gateway_response(Body::new(Full::<Bytes>::from(raw)))
}

fn use_native_anthropic(request: &mut super::request::AgentExecutionRequest) {
    match request.kind {
        AgentExecutionKind::Application => {
            request
                .payload
                .llm
                .get_mut("kwargs")
                .and_then(serde_json::Value::as_object_mut)
                .expect("application runtime model")
                .insert("openai_compatible".to_owned(), serde_json::json!(false));
            let settings = request
                .payload
                .application
                .get_mut("version_details")
                .and_then(serde_json::Value::as_object_mut)
                .and_then(|version| version.get_mut("llm_settings"))
                .and_then(serde_json::Value::as_object_mut)
                .expect("application model settings");
            settings.insert(
                "model_name".to_owned(),
                serde_json::json!("claude-sonnet-4-5"),
            );
            settings.insert("openai_compatible".to_owned(), serde_json::json!(false));
        }
        AgentExecutionKind::Adhoc => {
            let settings = request
                .payload
                .llm
                .get_mut("kwargs")
                .and_then(serde_json::Value::as_object_mut)
                .expect("ad-hoc model settings");
            settings.insert("model".to_owned(), serde_json::json!("claude-sonnet-4-5"));
            settings.insert("openai_compatible".to_owned(), serde_json::json!(false));
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn application_and_adhoc_share_authorized_redemption_model_session_and_projection() {
    for kind in [AgentExecutionKind::Application, AgentExecutionKind::Adhoc] {
        let mut request = ordinary_request(kind);
        request.payload.chat_history = current_text_history();
        let (runtime_context, context_calls) = runtime_context_client();
        let (model_gateway, captured) = test_model_gateway_client(
            vec![TestModelGatewayOutcome::Response(model_response())],
            test_model_gateway_config(),
        )
        .expect("model gateway fixture client");
        let assembler =
            OrdinaryNativeAgentAssembler::new(Arc::new(runtime_context), Arc::new(model_gateway));
        let assembly = AuthorizedNativeAssembly::new(
            &request,
            test_runtime_context_authority(),
            AuthorizedNativeCommandBinding::fixture(),
        );
        let mut invocation = assembler
            .assemble(assembly)
            .await
            .expect("authorized ordinary assembly");
        assert_eq!(context_calls.load(Ordering::Acquire), 1);
        assert_eq!(
            invocation.project_start(chrono::Utc::now()).unwrap().len(),
            1
        );

        let (mut native, mut projector, completion) = invocation.start().expect("native start");
        while let Some(event) = native.next_event().await.expect("native event") {
            let _batch = projector.project(&event).expect("projected native event");
        }
        let completed = completion.select().await.expect("selected completion");
        let finish = projector
            .finish_after_eos(completed, chrono::Utc::now())
            .expect("finished browser output");
        let full_message = finish
            .into_iter()
            .map(|event| {
                serde_json::from_slice::<serde_json::Value>(
                    &encode_current_node_event_json(&event).expect("canonical browser event"),
                )
                .expect("browser event JSON")
            })
            .find(|event| event["type"] == "full_message")
            .expect("full message event");
        assert_eq!(full_message["content"], "native response");

        let captured = captured.lock().expect("captured model request");
        assert_eq!(captured.len(), 1);
        let body: serde_json::Value =
            serde_json::from_slice(&captured[0].body).expect("model request JSON");
        assert_eq!(body["messages"][1]["role"], "user");
        assert_eq!(
            body["messages"][1]["content"][0]["text"],
            "earlier question"
        );
        assert_eq!(body["messages"][2]["role"], "assistant");
        assert_eq!(body["messages"][2]["content"][0]["text"], "earlier ");
        assert_eq!(body["messages"][2]["content"][1]["text"], "answer");
        assert_eq!(body["messages"][3]["content"], "current");
        assert_eq!(
            body["messages"][0]["content"],
            match kind {
                AgentExecutionKind::Application => "review carefully",
                AgentExecutionKind::Adhoc => "be concise",
            }
        );
        assert_eq!(captured[0].headers["openai-organization"], "17");
        assert!(captured[0].headers["authorization"].is_sensitive());
    }
}

#[tokio::test(flavor = "current_thread")]
async fn application_and_adhoc_select_native_anthropic_without_changing_the_lifecycle() {
    for kind in [AgentExecutionKind::Application, AgentExecutionKind::Adhoc] {
        let mut request = ordinary_request(kind);
        request.payload.chat_history = current_text_history();
        use_native_anthropic(&mut request);
        let (runtime_context, context_calls) = runtime_context_client();
        let (model_gateway, captured) = test_model_gateway_client(
            vec![TestModelGatewayOutcome::Response(anthropic_response())],
            test_model_gateway_config(),
        )
        .expect("model gateway fixture client");
        let assembler =
            OrdinaryNativeAgentAssembler::new(Arc::new(runtime_context), Arc::new(model_gateway));
        let assembly = AuthorizedNativeAssembly::new(
            &request,
            test_runtime_context_authority(),
            AuthorizedNativeCommandBinding::fixture(),
        );
        let mut invocation = assembler
            .assemble(assembly)
            .await
            .expect("authorized native Anthropic assembly");
        assert_eq!(context_calls.load(Ordering::Acquire), 1);
        assert_eq!(
            invocation.project_start(chrono::Utc::now()).unwrap().len(),
            1
        );

        let (mut native, mut projector, completion) = invocation.start().expect("native start");
        while let Some(event) = native.next_event().await.expect("native event") {
            let _batch = projector.project(&event).expect("projected native event");
        }
        let completed = completion.select().await.expect("selected completion");
        let finish = projector
            .finish_after_eos(completed, chrono::Utc::now())
            .expect("finished browser output");
        let full_message = finish
            .into_iter()
            .map(|event| {
                serde_json::from_slice::<serde_json::Value>(
                    &encode_current_node_event_json(&event).expect("canonical browser event"),
                )
                .expect("browser event JSON")
            })
            .find(|event| event["type"] == "full_message")
            .expect("full message event");
        assert_eq!(full_message["content"], "native Anthropic response");

        let captured = captured.lock().expect("captured native request");
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].uri.path(), "/llm/v1/messages");
        let body: serde_json::Value =
            serde_json::from_slice(&captured[0].body).expect("native request JSON");
        assert_eq!(body["model"], "claude-sonnet-4-5");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(
            body["messages"][0]["content"][0]["text"],
            "earlier question"
        );
        assert_eq!(body["messages"][1]["role"], "assistant");
        assert_eq!(body["messages"][1]["content"][0]["text"], "earlier ");
        assert_eq!(body["messages"][1]["content"][1]["text"], "answer");
        assert_eq!(body["messages"][2]["content"], "current");
        assert_eq!(captured[0].headers["openai-organization"], "17");
        assert!(captured[0].headers["authorization"].is_sensitive());
        assert!(captured[0].headers["x-api-key"].is_sensitive());
    }
}

#[tokio::test(flavor = "current_thread")]
async fn unsupported_profile_fails_before_pat_redemption_or_model_request() {
    let mut request = ordinary_request(AgentExecutionKind::Application);
    request
        .payload
        .tools
        .push(serde_json::json!({"type": "github"}));
    let (runtime_context, context_calls) = runtime_context_client();
    let (model_gateway, captured) =
        test_model_gateway_client(Vec::new(), test_model_gateway_config())
            .expect("model gateway fixture client");
    let assembler =
        OrdinaryNativeAgentAssembler::new(Arc::new(runtime_context), Arc::new(model_gateway));
    let assembly = AuthorizedNativeAssembly::new(
        &request,
        test_runtime_context_authority(),
        AuthorizedNativeCommandBinding::fixture(),
    );

    let result = assembler.assemble(assembly).await;
    assert!(result.is_err());
    assert_eq!(context_calls.load(Ordering::Acquire), 0);
    assert!(captured.lock().expect("captured model requests").is_empty());
}
