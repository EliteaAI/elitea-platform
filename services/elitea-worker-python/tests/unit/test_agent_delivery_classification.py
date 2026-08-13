from __future__ import annotations

from elitea_worker.execution.delivery import _is_mcp_dependency_failure


def _raised_from_module(module: str, source: str) -> BaseException:
    namespace = {"__name__": module}
    try:
        exec(compile(source, "mcp_failure_fixture.py", "exec"), namespace)
    except BaseException as error:  # noqa: BLE001 - classification fixture
        return error
    raise AssertionError("the classification fixture did not raise")


def test_mcp_dependency_failure_classification_is_source_scoped() -> None:
    mcp_http_error = _raised_from_module(
        "elitea_sdk.runtime.utils.mcp_adapter",
        "raise ValueError('MCP endpoint returned HTML')",
    )
    mcp_timeout = _raised_from_module(
        "elitea_sdk.runtime.utils.mcp_adapter",
        "raise TimeoutError('bounded MCP discovery')",
    )
    ordinary_input_error = _raised_from_module(
        "elitea_sdk.runtime.clients.client",
        "raise ValueError('invalid agent input')",
    )
    ordinary_timeout = _raised_from_module(
        "elitea_sdk.runtime.clients.client",
        "raise TimeoutError('model timed out')",
    )

    assert _is_mcp_dependency_failure(mcp_http_error)
    assert _is_mcp_dependency_failure(mcp_timeout)
    assert not _is_mcp_dependency_failure(ordinary_input_error)
    assert not _is_mcp_dependency_failure(ordinary_timeout)


def test_mcp_authorization_is_not_classified_as_dependency_failure() -> None:
    class McpAuthorizationRequired(RuntimeError):
        pass

    assert not _is_mcp_dependency_failure(
        McpAuthorizationRequired("authorization required")
    )
