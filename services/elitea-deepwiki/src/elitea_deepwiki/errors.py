"""The legacy error contract, ported.

Two shapes cross this boundary and both are frozen by ADR-0022 decision 2:

* a **tool** failure is HTTP 200 with ``status: "Error"`` in the body, carrying
  ``error_category`` / ``error_type`` and a ``result`` string holding the list
  of result objects;
* a **transport** failure is a non-2xx with
  ``{"errorCode", "message", "details"}``.

Ported from ``methods/invoke.py::_create_error_response`` and the inline
``errorCode`` dicts in ``routes/invoke.py`` / ``routes/invocations.py``. The
category classifier's precedence is load-bearing — the recorded fixture
``conformance/fixtures/spi/errors.json`` is the test.

One behaviour is deliberately NOT ported: the legacy `include_traceback=True`
path put a full Python stack trace into a caller-visible message. The category
and type survive; the trace is logged and does not leave the process.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Every category the legacy classifier can emit.
ERROR_CATEGORIES = frozenset(
    {
        "resource_not_found",
        "service_busy",
        "artifact_error",
        "out_of_memory",
        "timeout_error",
        "training_failed",
        "inference_failed",
        "runtime_error",
        "invalid_input",
        "unknown_error",
    }
)


def classify(exception: BaseException) -> str:
    """Return the legacy error category for ``exception``.

    The order of these tests is the contract: a ``ValueError`` whose message
    says "not found" is ``resource_not_found``, not ``invalid_input``, because
    the substring tests run first. See
    ``conformance/fixtures/spi/errors.json::classifier_precedence``.
    """
    text = str(exception).lower()

    if "not found" in text or isinstance(exception, FileNotFoundError):
        return "resource_not_found"
    if "[service_busy]" in text or "service is busy" in text:
        return "service_busy"
    if "download" in text or "artifact" in text:
        return "artifact_error"
    if "memory" in text or isinstance(exception, MemoryError):
        return "out_of_memory"
    if "timeout" in text:
        return "timeout_error"
    if isinstance(exception, RuntimeError):
        if "training" in text:
            return "training_failed"
        if "inference" in text or "generat" in text:
            return "inference_failed"
        return "runtime_error"
    if isinstance(exception, ValueError):
        return "invalid_input"
    return "unknown_error"


def tool_error(
    invocation_id: str,
    operation: str,
    exception: BaseException,
    model_name: str | None = None,
) -> dict[str, Any]:
    """Build the HTTP-200 tool-failure body.

    Mirrors the legacy ``include_traceback=False`` branch, which is the only
    branch this port keeps.
    """
    category = classify(exception)
    model_context = f" for model '{model_name}'" if model_name else ""
    message = f"{str(operation).capitalize()} failed{model_context}: {exception}"

    logger.warning(
        "invocation %s failed: operation=%s category=%s type=%s",
        invocation_id,
        operation,
        category,
        type(exception).__name__,
        exc_info=exception,
    )

    return {
        "invocation_id": invocation_id,
        "status": "Error",
        "result": json.dumps(
            [
                {
                    "object_type": "message",
                    "result_target": "response",
                    "result_encoding": "plain",
                    "data": message,
                }
            ]
        ),
        "result_type": "String",
        "error_category": category,
        "error_type": type(exception).__name__,
    }


def transport_error(status_code: int, message: str, details: list[str] | None = None):
    """Build the legacy ``errorCode`` envelope for a transport-level failure."""
    return {
        "errorCode": str(status_code),
        "message": message,
        "details": details or [],
    }


NOT_FOUND = transport_error(404, "Resource Not Found")
BAD_REQUEST = transport_error(400, "Bad Request")
INTERNAL_ERROR = transport_error(500, "Internal Server Error")
