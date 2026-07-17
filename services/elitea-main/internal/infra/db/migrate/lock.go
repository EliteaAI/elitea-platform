package migrate

import (
	"context"
	"fmt"
	"hash/fnv"

	"github.com/jackc/pgx/v5/pgxpool"
)

func advisoryLockKey(scope Scope, targetID string) int64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte("elitea-platform:migrations:"))
	_, _ = hash.Write([]byte(scope))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(targetID))
	return int64(hash.Sum64()) // PostgreSQL advisory locks use the bit pattern.
}

func acquireLock(ctx context.Context, conn *pgxpool.Conn, key int64) error {
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", key); err != nil {
		return fmt.Errorf("migrate: acquire advisory lock: %w", err)
	}
	return nil
}

func releaseLock(ctx context.Context, conn *pgxpool.Conn, key int64) error {
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", key); err != nil {
		return fmt.Errorf("migrate: release advisory lock: %w", err)
	}
	return nil
}
