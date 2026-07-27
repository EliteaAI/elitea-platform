from __future__ import annotations

import base64
import importlib.util
import os
import shutil

import pytest
from langchain_community.document_loaders.confluence import ContentFormat

from .fake_services import (
    CHAT_COMPLETIONS_PATH,
    ConfluenceFixture,
    ConfluenceHandler,
    FixtureHTTPServer,
    HTTPConfluenceClient,
    LiteLLMFixture,
    LiteLLMHandler,
    decoded_requests,
    deterministic_blank_png,
    deterministic_text_png,
)
from .sdk_current import current_model_clients


def _loader(current_sdk, client, llm, *, bins_with_llm: bool):
    return current_sdk.confluence_loader(
        client,
        llm,
        bins_with_llm,
        url=client.url,
        space_key="ENG",
        include_attachments=True,
        include_restricted_content=True,
        content_format=ContentFormat.VIEW,
        keep_markdown_format=True,
        limit=1,
        max_pages=1,
        min_retry_seconds=0,
        max_retry_seconds=0,
        number_of_retries=1,
    )


def _require_binary(name: str) -> str:
    path = shutil.which(name)
    if path:
        return path
    if os.getenv("ELITEA_REQUIRE_INDEX_BINARIES") == "1":
        pytest.fail(f"required current-indexing binary is unavailable: {name}")
    pytest.skip(
        f"{name} is unavailable outside the mandatory binary-media CI profile"
    )


def _require_python_module(name: str) -> None:
    if importlib.util.find_spec(name) is not None:
        return
    reason = (
        f"current-baseline OCR needs {name}; the standalone worker profile "
        "currently installs only unstructured_pytesseract"
    )
    if os.getenv("ELITEA_REQUIRE_INDEX_BINARIES") == "1":
        pytest.fail(reason)
    pytest.skip(reason)


def test_current_sdk_pdf_attachment_uses_real_poppler_and_vision_per_page(
    current_sdk,
) -> None:
    _require_binary("pdfinfo")
    _require_binary("pdftoppm")
    confluence = ConfluenceFixture(
        include_text_attachment=False,
        include_image_attachment=False,
        include_pdf_attachment=True,
    )
    litellm = LiteLLMFixture(
        vision_responses=["PDF_PAGE_ONE_DESCRIPTION", "PDF_PAGE_TWO_DESCRIPTION"]
    )
    with (
        FixtureHTTPServer(confluence, ConfluenceHandler) as source,
        FixtureHTTPServer(litellm, LiteLLMHandler) as models,
    ):
        llm, _ = current_model_clients(current_sdk, models.base_url)
        loader = _loader(
            current_sdk,
            HTTPConfluenceClient(source.base_url),
            llm,
            bins_with_llm=True,
        )

        documents = list(loader._lazy_load(kwargs={}))

    assert len(documents) == 1
    assert (
        "architecture.pdfPage 1:\nPDF_PAGE_ONE_DESCRIPTION\n\n"
        "Page 2:\nPDF_PAGE_TWO_DESCRIPTION\n\n"
        in documents[0].page_content
    )
    calls = decoded_requests(litellm.records, CHAT_COMPLETIONS_PATH)
    assert len(calls) == 2
    assert all(
        call["messages"][0]["content"][0]["text"] == loader.prompt
        for call in calls
    )


def test_current_sdk_image_attachment_uses_real_tesseract_without_litellm(
    current_sdk,
) -> None:
    _require_binary("tesseract")
    _require_python_module("pytesseract")
    confluence = ConfluenceFixture(
        include_text_attachment=False,
        include_image_attachment=True,
        image_bytes=deterministic_text_png(),
    )
    with FixtureHTTPServer(confluence, ConfluenceHandler) as source:
        loader = _loader(
            current_sdk,
            HTTPConfluenceClient(source.base_url),
            llm=None,
            bins_with_llm=False,
        )

        documents = list(loader._lazy_load(kwargs={}))

    assert len(documents) == 1
    normalized = " ".join(documents[0].page_content.upper().split())
    assert "DIAGRAM.PNGOCR 123" in normalized


def test_current_sdk_empty_tesseract_result_adds_only_attachment_title(
    current_sdk,
) -> None:
    _require_binary("tesseract")
    _require_python_module("pytesseract")
    confluence = ConfluenceFixture(
        include_text_attachment=False,
        include_image_attachment=True,
        image_bytes=deterministic_blank_png(),
    )
    with FixtureHTTPServer(confluence, ConfluenceHandler) as source:
        loader = _loader(
            current_sdk,
            HTTPConfluenceClient(source.base_url),
            llm=None,
            bins_with_llm=False,
        )

        raw_ocr = loader.process_image(
            f"{source.base_url}/download/attachments/page-1/diagram.png"
        )
        documents = list(loader._lazy_load(kwargs={}))

    assert raw_ocr == ""
    assert documents[0].page_content.rstrip().endswith("diagram.png")


def test_current_sdk_embedded_base64_image_uses_authenticated_model_client(
    current_sdk,
) -> None:
    encoded = base64.b64encode(ConfluenceFixture().image_bytes).decode()
    storage_value = (
        "<p>Context before the embedded image.</p>"
        "<ac:image><ac:resource><ac:media-type>image/png</ac:media-type>"
        f"<ac:data>{encoded}</ac:data></ac:resource></ac:image>"
        "<p>Context after the embedded image.</p>"
    )
    confluence = ConfluenceFixture(storage_value=storage_value)
    litellm = LiteLLMFixture()
    with (
        FixtureHTTPServer(confluence, ConfluenceHandler) as source,
        FixtureHTTPServer(litellm, LiteLLMHandler) as models,
    ):
        llm, _ = current_model_clients(current_sdk, models.base_url)
        wrapper = current_sdk.confluence_wrapper.model_construct(
            base_url=source.base_url,
            client=HTTPConfluenceClient(source.base_url),
            llm=llm,
        )

        content = wrapper.get_page_with_image_descriptions("page-1")

    assert (
        "[Image embedded-image.png Description: PARENT\\_IMAGE\\_DESCRIPTION]"
        in content
    )
    calls = decoded_requests(litellm.records, CHAT_COMPLETIONS_PATH)
    assert len(calls) == 1
    prompt = calls[0]["messages"][0]["content"][0]["text"]
    assert "Image Name/Reference: embedded-image.png" in prompt
    assert "Context before the embedded image." in prompt
