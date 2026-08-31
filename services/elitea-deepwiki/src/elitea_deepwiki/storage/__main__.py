"""``python -m elitea_deepwiki.storage`` — apply the service's migrations.

WHY THIS EXISTS. The migrations were runnable only from Python, by a caller
that had already opened a connection. There is no such caller in a
deployment: the chart runs a Job, the Job runs a container, and a container
runs a command. Without an entry point the published image could not prepare
its own database, so the storage ADR-0022 decision 3 describes had no way to
come into existence outside a test.

WHY A SEPARATE PROCESS AND NOT A STARTUP STEP. Two replicas starting together
would both migrate, and the second would either race the first or find the
work done and have to decide whether that is an error. A Job runs once, and
Kubernetes already knows how to order it before the Deployment.

Exit codes are the interface a Job reads:

    0  the database is at the newest migration (whether or not this run
       applied anything — an already-migrated database is a success, not a
       no-op to report as failure)
    1  a migration failed, or the applied set disagrees with the files

The checksum refusal is the failure most worth reading: it means a migration
that already ran has been edited, so at least one environment is on a schema
no file describes any more.
"""

from __future__ import annotations

import logging
import os
import sys

from .migrate import MigrationError, apply_all

logger = logging.getLogger("elitea_deepwiki.storage.migrate")

# The same variable the service itself reads (config.ENV_PREFIX + DATABASE_URL),
# so the Job and the Deployment cannot be pointed at different databases by a
# values file that sets only one of them.
DSN_ENV = "ELITEA_DEEPWIKI_DATABASE_URL"


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    dsn = os.environ.get(DSN_ENV, "").strip()
    if not dsn:
        logger.error(
            "%s is not set, so there is no database to migrate. It must name "
            "the same database the service itself connects to.", DSN_ENV)
        return 1

    try:
        import psycopg  # noqa: PLC0415
    except ModuleNotFoundError:
        # Named rather than raised bare: the extra is the fix, and a
        # ModuleNotFoundError on its own reads as a broken image.
        logger.error(
            "psycopg is not installed. Build the image with the "
            "storage-postgres extra, e.g. --build-arg EXTRAS='[storage-postgres]'.")
        return 1

    connection = psycopg.connect(dsn)
    try:
        applied = apply_all(connection)
    except MigrationError as error:
        logger.error("%s", error)
        return 1
    finally:
        connection.close()

    if applied:
        logger.info("applied %d migration(s): %s", len(applied), ", ".join(applied))
    else:
        logger.info("the database is already at the newest migration")
    return 0


if __name__ == "__main__":
    sys.exit(main())
