"""Guards on the plain copy and on the migration set.

Neither needs a database.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest

from elitea_deepwiki.storage import migrate

LEGACY_DIR = (
    Path(migrate.__file__).resolve().parent / "legacy"
)

#: The digests recorded when the four storage modules were copied out of
#: deepwiki_plugin at ce679f11dc31c209cc67f13565b286d5bb28ce58. They are also
#: written into the package docstring; this test is what makes them binding.
EXPECTED_DIGESTS = {
    "constants.py": "4030c459261afb62bc19f9ae284d6a8f743443b30211b88b80e2b36368bccabb",
    "unified_db.py": "1d2a44e6317effbd9806a539ea30fdd7f15e49140551f5f5d2a6426840e9a3c5",
    "bm25_disk.py": "beac75986d86a776a52d9402fda8859e8b43f73ea9efb02a8c491e799c7b744e",
    "docstore.py": "7fb251ab3b51e13eaabb3f2104c5077fc88a81dfaebb1664186cfa14dc9450c1",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.parametrize("filename,digest", sorted(EXPECTED_DIGESTS.items()))
def test_legacy_copy_is_verbatim(filename: str, digest: str):
    """The reference implementation must stay byte-identical to the legacy one.

    The whole parity argument rests on this: if these files are edited, the
    "reference" backend is no longer the code the P0 fixtures were recorded
    from, and a green parity run stops meaning what it claims. A deliberate
    change belongs in a commit that updates this digest and says why.
    """
    path = LEGACY_DIR / filename
    assert path.is_file(), f"{filename} is missing from the legacy copy"
    assert sha256(path) == digest, (
        f"{filename} has been modified since it was copied out of "
        f"deepwiki_plugin. Revert it, or update the digest here and in the "
        f"package docstring with a reason."
    )


def test_the_legacy_copy_has_no_extra_files():
    """A file appearing here without a digest would be unguarded."""
    present = {
        path.name
        for path in LEGACY_DIR.glob("*.py")
        if path.name != "__init__.py"
    }
    assert present == set(EXPECTED_DIGESTS)


def test_package_docstring_records_the_same_digests():
    """The docstring is where a reader looks; keep it from going stale."""
    from elitea_deepwiki.storage import legacy

    for filename, digest in EXPECTED_DIGESTS.items():
        assert digest in legacy.__doc__, f"{filename}'s digest is not documented"


# ---------------------------------------------------------------------------
# migrations
# ---------------------------------------------------------------------------


def test_migrations_are_discovered_in_order():
    migrations = migrate.discover()
    assert migrations, "no migrations found"
    versions = [item.version for item in migrations]
    assert versions == sorted(versions)
    assert versions[0] == "0001"


def test_every_migration_filename_is_numbered(tmp_path: Path):
    """A misnamed file is an error, not something to skip.

    Skipping would mean a typo in a migration filename reads as "there are no
    migrations here" — the failure shape that keeps showing up in this
    codebase, where absence is mistaken for correctness.
    """
    (tmp_path / "0001_fine.sql").write_text("SELECT 1;")
    (tmp_path / "oops.sql").write_text("SELECT 1;")
    with pytest.raises(migrate.MigrationError, match="does not match"):
        migrate.discover(tmp_path)


def test_duplicate_versions_are_rejected(tmp_path: Path):
    (tmp_path / "0001_one.sql").write_text("SELECT 1;")
    (tmp_path / "0001_two.sql").write_text("SELECT 2;")
    with pytest.raises(migrate.MigrationError, match="duplicate migration version"):
        migrate.discover(tmp_path)


def test_checksums_are_stable_for_a_given_text():
    migration = migrate.discover()[0]
    assert migration.checksum == hashlib.sha256(
        migration.path.read_text(encoding="utf-8").encode("utf-8")
    ).hexdigest()


def test_migration_sql_declares_the_text_search_configuration():
    """The one schema object the retrieval path cannot work without.

    `deepwiki_porter` is created by migration 0001 and named by the backend.
    A migration that stopped creating it would leave every FTS query failing
    at runtime rather than at deploy time.
    """
    from elitea_deepwiki.storage.postgres import TS_CONFIG

    sql = migrate.discover()[0].sql
    assert f"CREATE TEXT SEARCH CONFIGURATION {TS_CONFIG}" in sql


def test_the_unicode61_fold_is_identical_on_both_sides():
    """The write side and the read side must tokenise the same way.

    Migration 0001's generated column and `PostgresBackend.search_fts` both
    fold non-alphanumerics to spaces to reproduce FTS5's `unicode61`. If only
    one of them did, terms would be indexed that no query could name (or the
    reverse) and every FTS result would silently narrow.
    """
    sql = migrate.discover()[0].sql
    backend_source = (
        Path(migrate.__file__).resolve().parent / "postgres.py"
    ).read_text(encoding="utf-8")

    fold = r"'\[\^\[:alnum:\]\]\+', ' ', 'g'"
    assert re.search(fold, sql), "migration 0001 no longer folds non-alphanumerics"
    assert re.search(fold, backend_source), "search_fts no longer folds them"

    # Both query-side uses — the match and the lexeme extraction — need it.
    assert len(re.findall(fold, backend_source)) >= 2
