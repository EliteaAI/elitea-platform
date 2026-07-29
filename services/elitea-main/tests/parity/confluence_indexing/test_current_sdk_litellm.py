from __future__ import annotations

import openai
import pytest
from langchain_core.messages import HumanMessage

from .fake_services import (
    CHAT_COMPLETIONS_PATH,
    EMBEDDINGS_PATH,
    FixtureHTTPServer,
    LiteLLMFixture,
    LiteLLMHandler,
)
from .sdk_current import current_model_clients


def _records(fixture: LiteLLMFixture, path: str):
    return [record for record in fixture.records if record.path == path]


def test_current_sdk_model_clients_forward_project_auth_and_organization(
    current_sdk,
) -> None:
    fixture = LiteLLMFixture()
    with FixtureHTTPServer(fixture, LiteLLMHandler) as service:
        llm, embeddings = current_model_clients(current_sdk, service.base_url)

        response = llm.invoke([HumanMessage(content="describe the fixture")])
        vector = embeddings.embed_query("embed the fixture")

    assert response.content == "PARENT_IMAGE_DESCRIPTION"
    assert len(vector) == fixture.embedding_dimension
    assert [record.path for record in fixture.records] == [
        CHAT_COMPLETIONS_PATH,
        EMBEDDINGS_PATH,
    ]
    for record in fixture.records:
        assert record.headers["authorization"] == fixture.required_authorization
        assert (
            record.headers["openai-organization"]
            == fixture.required_organization
        )


def test_current_sdk_model_client_rejects_wrong_bearer(
    current_sdk,
) -> None:
    fixture = LiteLLMFixture()
    with FixtureHTTPServer(fixture, LiteLLMHandler) as service:
        llm, _ = current_model_clients(
            current_sdk,
            service.base_url,
            auth_token="wrong-fixture-pat",
        )

        with pytest.raises(openai.AuthenticationError) as caught:
            llm.invoke([HumanMessage(content="must not authenticate")])

    assert caught.value.status_code == 401
    records = _records(fixture, CHAT_COMPLETIONS_PATH)
    assert len(records) == 1
    assert records[0].headers["authorization"] == "Bearer wrong-fixture-pat"


@pytest.mark.parametrize("status", [403, 429, 500, 503])
def test_current_sdk_chat_client_preserves_litellm_failure_status(
    current_sdk,
    status: int,
) -> None:
    fixture = LiteLLMFixture(chat_status_sequence=[status])
    with FixtureHTTPServer(fixture, LiteLLMHandler) as service:
        llm, _ = current_model_clients(current_sdk, service.base_url)

        with pytest.raises(openai.APIStatusError) as caught:
            llm.invoke([HumanMessage(content="fixture failure")])

    assert caught.value.status_code == status
    assert len(_records(fixture, CHAT_COMPLETIONS_PATH)) == 1


@pytest.mark.parametrize("status", [403, 429, 500, 503])
def test_current_sdk_embedding_client_preserves_litellm_failure_and_retries(
    current_sdk,
    status: int,
) -> None:
    # EliteAClient.get_embeddings uses the production OpenAIEmbeddings retry
    # policy. Supply enough failures to exhaust it deterministically.
    fixture = LiteLLMFixture(embedding_status_sequence=[status, status, status])
    with FixtureHTTPServer(fixture, LiteLLMHandler) as service:
        _, embeddings = current_model_clients(current_sdk, service.base_url)

        with pytest.raises(openai.APIStatusError) as caught:
            embeddings.embed_query("fixture failure")

    assert caught.value.status_code == status
    expected_calls = 1 if status == 403 else 3
    assert len(_records(fixture, EMBEDDINGS_PATH)) == expected_calls
