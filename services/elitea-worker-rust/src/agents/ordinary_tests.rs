use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use http::{Request, Response, StatusCode, Version};
use http_body_util::Full;
use tonic::body::Body;

use super::assembly_tests::ordinary_request;
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

#[tokio::test(flavor = "current_thread")]
async fn application_and_adhoc_share_authorized_redemption_model_session_and_projection() {
    for kind in [AgentExecutionKind::Application, AgentExecutionKind::Adhoc] {
        let request = ordinary_request(kind);
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
        assert_eq!(body["messages"][1]["content"], "current");
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
