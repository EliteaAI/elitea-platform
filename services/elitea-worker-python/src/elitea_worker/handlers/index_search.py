"""Source-only parity kernel for current index retrieval toolkit tools.

The kernel deliberately contains no vector-store query, model construction,
Pylon callback wrapper, output publication or worker registration.  It makes
one current SDK call; a later mounted slice must compose authorization, input
claiming, artifact persistence and UI-event projection around it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from elitea_worker.execution.errors import InvalidInput


_OPERATIONS = frozenset({"search_index", "stepback_search_index", "list_indexes"})


class IndexSearchSDK(Protocol):
    def execute(
        self,
        *,
        operation: str,
        toolkit_config: dict[str, Any],
        tool_params: dict[str, Any],
        runtime_config: dict[str, Any],
        llm_model: str | None,
        llm_config: dict[str, Any],
        mcp_tokens: dict[str, Any] | None,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True, slots=True)
class IndexSearchRequest:
    operation: str
    toolkit_config: dict[str, Any]
    tool_params: dict[str, Any]
    runtime_config: dict[str, Any]
    llm_model: str | None
    llm_config: dict[str, Any]
    mcp_tokens: dict[str, Any] | None


class IndexSearchHandler:
    def __init__(self, sdk: IndexSearchSDK) -> None:
        self._sdk = sdk

    def execute(self, request: IndexSearchRequest) -> dict[str, Any]:
        _validate(request)
        # Intentionally let SDK exceptions escape. The current Pylon wrapper,
        # not BaseIndexerToolkit, owns its exception event/response branch.
        return self._sdk.execute(
            operation=request.operation,
            toolkit_config=request.toolkit_config,
            tool_params=request.tool_params,
            runtime_config=request.runtime_config,
            llm_model=request.llm_model,
            llm_config=request.llm_config,
            mcp_tokens=request.mcp_tokens,
        )


def _validate(request: IndexSearchRequest) -> None:
    if (
        request.operation not in _OPERATIONS
        or not isinstance(request.toolkit_config, dict)
        or not request.toolkit_config
        or not isinstance(request.tool_params, dict)
        or not isinstance(request.runtime_config, dict)
        or not isinstance(request.llm_config, dict)
        or (request.llm_model is not None and not isinstance(request.llm_model, str))
        or (request.mcp_tokens is not None and not isinstance(request.mcp_tokens, dict))
    ):
        raise InvalidInput()
