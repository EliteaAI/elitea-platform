from __future__ import annotations

import pytest


@pytest.mark.skip(
    reason=(
        "standalone-worker Confluence target is not injectable through production "
        "wiring: index.ingest.v1 requires a claimed execution, protected input "
        "content, workload identity, and an initialized EliteAClient, while no "
        "production Go/worker seam can bind this harness's Confluence and LiteLLM "
        "HTTP endpoints; do not replace that missing cross-process boundary with "
        "a mocked adapter"
    )
)
def test_standalone_worker_matches_current_confluence_goldens() -> None:
    """Enable only after the real production composition accepts fixture endpoints."""


@pytest.mark.skip(
    reason=(
        "current SDK index_data is synchronous and exposes no cancellation "
        "input; baseline Stop is Pylon task cancellation plus index-meta "
        "reconciliation, so a direct SDK harness cannot claim Stop parity "
        "without exercising the real orchestration boundary"
    )
)
def test_current_sdk_stop_reconciles_terminal_history_and_events() -> None:
    """Enable in the cross-process Pylon-versus-worker orchestration profile."""
