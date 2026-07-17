package migrate

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const ensureLedgerSQL = `
CREATE SCHEMA IF NOT EXISTS elitea_runtime;
CREATE TABLE IF NOT EXISTS elitea_runtime.schema_migrations (
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    version BIGINT NOT NULL,
    name TEXT NOT NULL,
    checksum BYTEA NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (target_kind, target_id, version),
    CONSTRAINT schema_migrations_target_kind
        CHECK (target_kind IN ('shared', 'tenant')),
    CONSTRAINT schema_migrations_checksum_length
        CHECK (octet_length(checksum) = 32)
)`

func ensureLedger(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, ensureLedgerSQL); err != nil {
		return fmt.Errorf("migrate: ensure ledger: %w", err)
	}
	return nil
}

func recordedChecksum(
	ctx context.Context,
	tx pgx.Tx,
	scope Scope,
	targetID string,
	version int64,
) ([]byte, bool, error) {
	var checksum []byte
	err := tx.QueryRow(ctx, `
SELECT checksum
FROM elitea_runtime.schema_migrations
WHERE target_kind = $1 AND target_id = $2 AND version = $3`,
		string(scope), targetID, version,
	).Scan(&checksum)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("migrate: read ledger: %w", err)
	}
	return checksum, true, nil
}

func recordMigration(
	ctx context.Context,
	tx pgx.Tx,
	targetID string,
	migration Migration,
) error {
	if _, err := tx.Exec(ctx, `
INSERT INTO elitea_runtime.schema_migrations
    (target_kind, target_id, version, name, checksum)
VALUES ($1, $2, $3, $4, $5)`,
		string(migration.Scope), targetID, migration.Version, migration.Name, migration.Checksum[:],
	); err != nil {
		return fmt.Errorf("migrate: record %s: %w", migration.Path, err)
	}
	return nil
}
