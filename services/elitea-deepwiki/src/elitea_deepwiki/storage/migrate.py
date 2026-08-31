"""Service-owned, versioned, checksummed migrations.

ADR-0022 decision 3: the service owns its operational storage and its
migrations; product data and product migrations stay Go-owned and are not
touched. This is the whole runner — numbered ``.sql`` files applied in order,
each recorded with the SHA-256 of the text that was applied.

The checksum is the point. A migration that has been applied is immutable: if
its file changes afterwards, every environment that already ran it is silently
on a different schema from the one the file now describes. This refuses instead
of pretending.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "migrations"

_FILENAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

_BOOTSTRAP = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT        PRIMARY KEY,
    name       TEXT        NOT NULL,
    checksum   TEXT        NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


class MigrationError(RuntimeError):
    """Raised when the migration set and the database disagree."""


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    path: Path
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


def discover(directory: Path | None = None) -> list[Migration]:
    """Return every migration, ordered by version.

    A file that does not match ``NNNN_name.sql`` is an error rather than
    something to skip: a typo in a migration filename must not read as "there
    are no migrations here".
    """
    directory = directory or MIGRATIONS_DIR
    migrations: list[Migration] = []
    seen: dict[str, Path] = {}

    for path in sorted(directory.glob("*.sql")):
        match = _FILENAME.match(path.name)
        if match is None:
            raise MigrationError(
                f"{path.name} does not match NNNN_name.sql; migrations must be "
                "numbered so their order is unambiguous"
            )
        version, name = match.groups()
        if version in seen:
            raise MigrationError(
                f"duplicate migration version {version}: {seen[version].name} "
                f"and {path.name}"
            )
        seen[version] = path
        migrations.append(
            Migration(
                version=version,
                name=name,
                path=path,
                sql=path.read_text(encoding="utf-8"),
            )
        )

    return migrations


def apply_all(connection, directory: Path | None = None) -> list[str]:
    """Apply every unapplied migration. Returns the versions applied.

    ``connection`` is a psycopg connection. Each migration runs in its own
    transaction together with the row that records it, so a failure cannot
    leave a migration half-applied but marked done.
    """
    migrations = discover(directory)

    with connection.cursor() as cursor:
        cursor.execute(_BOOTSTRAP)
        connection.commit()

        cursor.execute("SELECT version, name, checksum FROM schema_migrations")
        applied = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}

    for migration in migrations:
        record = applied.get(migration.version)
        if record is not None:
            _name, checksum = record
            if checksum != migration.checksum:
                raise MigrationError(
                    f"migration {migration.version}_{migration.name} was "
                    f"applied with checksum {checksum} but the file now hashes "
                    f"to {migration.checksum}. Applied migrations are "
                    f"immutable — add a new migration instead of editing this "
                    f"one."
                )
            continue

    newly_applied: list[str] = []
    for migration in migrations:
        if migration.version in applied:
            continue
        logger.info("applying migration %s_%s", migration.version, migration.name)
        with connection.cursor() as cursor:
            cursor.execute(migration.sql)
            cursor.execute(
                "INSERT INTO schema_migrations (version, name, checksum) "
                "VALUES (%s, %s, %s)",
                (migration.version, migration.name, migration.checksum),
            )
        connection.commit()
        newly_applied.append(migration.version)

    return newly_applied
