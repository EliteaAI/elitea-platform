from __future__ import annotations

from types import SimpleNamespace

import pytest

from sync_worker_sdk_catalog import ContractSyncError, _require_complete_imports


def test_failed_sdk_imports_are_never_projected_as_a_complete_catalog() -> None:
    with pytest.raises(ContractSyncError, match="incomplete"):
        _require_complete_imports(
            SimpleNamespace(FAILED_IMPORTS={"provider": "sensitive import error"})
        )


@pytest.mark.parametrize("failed_imports", [None, (), []])
def test_failed_import_registry_must_be_an_explicit_empty_dict(
    failed_imports: object,
) -> None:
    with pytest.raises(ContractSyncError, match="incomplete"):
        _require_complete_imports(SimpleNamespace(FAILED_IMPORTS=failed_imports))

    _require_complete_imports(SimpleNamespace(FAILED_IMPORTS={}))
