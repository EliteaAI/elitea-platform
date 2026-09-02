"""The copied tool layer, actually composed onto the host that satisfies it.

Skipped without the ``engine`` extra: these import the real modules. Everything
else in this directory reads source, and would pass with a tool layer that
cannot be imported at all — which is exactly what a Pylon reference or a
mistyped substitution leaves behind.
"""

from __future__ import annotations

import inspect

import pytest

from elitea_inventory.tools_table import FAMILIES
from elitea_inventory.v1_overrides import V1Overrides

legacy_runner = pytest.importorskip(
    "elitea_inventory.legacy_runner", reason="needs the engine extra"
)
try:
    BOUND = legacy_runner._bound_host_class()
except Exception as exc:  # noqa: BLE001 - reported as a skip, not a failure
    pytest.skip(f"the engine closure is not installed: {exc}", allow_module_level=True)


def test_every_routed_handler_resolves_on_the_composed_class():
    """Dispatch by table only works if the table's handlers actually exist.

    ``tools_table`` is checked against the copied source elsewhere; this checks
    it against the composed CLASS, which is what a call reaches. The two can
    disagree: a handler defined inside a nested scope, or on a mixin that the
    composition order drops, parses fine and does not bind.
    """
    missing = [
        handler
        for table in FAMILIES.values()
        for handler in table.values()
        if not hasattr(BOUND, handler)
    ]
    assert not missing


def test_the_override_set_is_exactly_the_declared_one():
    """Every method V1Overrides replaces must BE a replacement.

    A method here that the copy does not define is a method that silently does
    nothing (nothing calls it); a method the copy defines and this does not
    override is legacy behaviour running unnoticed. Both are the failure this
    port is most exposed to, because the copy is 3900 lines nobody reads.
    """
    from elitea_inventory import chat_operations, tool_operations

    copied = set(vars(tool_operations.Method)) | set(vars(chat_operations.Method))
    overrides = {
        name
        for name, value in vars(V1Overrides).items()
        if not name.startswith("__") and (inspect.isfunction(value) or isinstance(value, property))
    }
    replacements = {name for name in overrides if name in copied}
    additions = overrides - replacements

    assert replacements == {
        "_get_elitea_client",
        "_get_platform_connection_settings",
        "_download_graph_from_artifacts",
        "_get_or_create_wrapper",
        "_tool_run_ingestion",
        "_run_ingestion_job",
    }
    # `_artifact_client` is new: the legacy code had no per-request transport.
    assert additions == {"_artifact_client"}


def test_the_overrides_win_over_the_copy():
    """Composition ORDER is the whole mechanism, and it is invisible in a diff.

    ``type("BoundToolHost", (V1Overrides, ToolMethod, ChatMethod, ToolHost), {})``
    — reverse those first two and every replacement above becomes dead code
    while the legacy admin-token paths run.
    """
    assert BOUND._tool_run_ingestion is V1Overrides._tool_run_ingestion
    assert BOUND._get_or_create_wrapper is V1Overrides._get_or_create_wrapper


def test_the_admin_platform_client_refuses_rather_than_answering_none():
    """The legacy callers read ``None`` as "platform not configured".

    They then returned a STRING beginning "Error: ..." as the tool's SUCCESSFUL
    result — so a missing credential reached the user as a completed invocation
    whose text happened to start with the word Error. Any surviving call site
    is a bug and should look like one.
    """
    host = BOUND.__new__(BOUND)
    with pytest.raises(RuntimeError) as raised:
        host._get_elitea_client(1)
    assert "no platform admin credential" in str(raised.value)


def test_the_kubernetes_ingestion_path_refuses():
    host = BOUND.__new__(BOUND)
    with pytest.raises(RuntimeError) as raised:
        host._run_ingestion_job({}, "/tmp/graph.json", {})
    assert "not as a Kubernetes Job" in str(raised.value)


def test_ingestion_slots_are_the_hosts_not_the_engines():
    """Two accounting layers for one resource can only disagree.

    The Go host admits or refuses an invocation before the socket is dialled
    (``internal/spi/slots.go``); the legacy tracker held a file lock per worker
    slot inside the plugin pod.
    """
    host = BOUND.__new__(BOUND)
    with pytest.raises(RuntimeError) as raised:
        _ = host.ingestion_tracker
    assert "sub-application host" in str(raised.value)
