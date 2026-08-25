from __future__ import annotations

import inspect

from elitea_worker.execution import delivery
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


def test_agent_execution_classifies_a_budget_rejection_before_any_fault() -> None:
    """The agent execute arm must answer a budget rejection first.

    This is a SOURCE-SHAPE gate, and it is weaker than the adapter test in
    tests/unit/test_agent.py that raises a real BudgetExceededError through
    ``EliteaSdkAgentAdapter``. It exists because the thing that can break here
    is ORDER, and order is invisible to a test that only checks the outcome of
    one input: ``_is_mcp_dependency_failure`` walks the exception chain and
    would claim a budget rejection wrapped in an MCP frame, and the internal
    failure arm claims everything left.

    Driving ``_execute_resolved`` end to end needs the whole claim, control,
    output and spool harness. That harness has no agent fixture, so building
    one for three lines of classification would cost more than it proves.
    """

    source = inspect.getsource(delivery.AgentExecutionDeliveryProcessor._execute_resolved)
    budget_at = source.find("SdkBudgetExceeded")
    mcp_at = source.find("_is_mcp_dependency_failure")
    internal_at = source.find('stage="execute"')

    assert budget_at != -1, "the agent execute arm no longer classifies SdkBudgetExceeded"
    assert mcp_at != -1 and internal_at != -1, "the arms this ordering is relative to moved"
    assert budget_at < mcp_at < internal_at, (
        "a budget rejection must be answered before the dependency and internal arms"
    )
    assert "raise ResourceExhausted() from None" in source
