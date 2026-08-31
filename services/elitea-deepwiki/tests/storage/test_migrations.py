"""Guards on the migration set. No database needed."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest

from elitea_deepwiki.storage import migrate


def test_migrations_are_discovered_in_order():
    migrations = migrate.discover()
    assert migrations, "no migrations found"
    versions = [item.version for item in migrations]
    assert versions == sorted(versions)
    assert versions[0] == "0001"


def test_every_migration_filename_is_numbered(tmp_path: Path):
    """A misnamed file is an error, not something to skip.

    Skipping would mean a typo in a migration filename reads as "there are no
    migrations here" — the failure shape that keeps recurring in this
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
