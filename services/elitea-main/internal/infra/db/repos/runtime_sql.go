package repos

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type sqlRow interface {
	Scan(dest ...any) error
}

type sqlRows interface {
	Close()
	Err() error
	Next() bool
	Scan(dest ...any) error
}

type sqlExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) sqlRow
	Query(ctx context.Context, sql string, args ...any) (sqlRows, error)
}

type pgxQueryer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type pgxExecutor struct {
	queryer pgxQueryer
}

func (e pgxExecutor) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return e.queryer.Exec(ctx, sql, arguments...)
}

func (e pgxExecutor) QueryRow(ctx context.Context, sql string, args ...any) sqlRow {
	return e.queryer.QueryRow(ctx, sql, args...)
}

func (e pgxExecutor) Query(ctx context.Context, sql string, args ...any) (sqlRows, error) {
	return e.queryer.Query(ctx, sql, args...)
}

func (e pgxExecutor) InsertCurrentIndexTerminalNotification(
	ctx context.Context,
	arg sqlcgen.InsertCurrentIndexTerminalNotificationParams,
) (int64, error) {
	return sqlcgen.New(e.queryer).InsertCurrentIndexTerminalNotification(ctx, arg)
}

type sharedStore interface {
	sqlExecutor
	WithinTx(ctx context.Context, opts pgx.TxOptions, fn func(sqlExecutor) error) error
}

type postgresSharedStore struct {
	pool *pgxpool.Pool
}

func newPostgresSharedStore(pool *pgxpool.Pool) (*postgresSharedStore, error) {
	if pool == nil {
		return nil, errors.New("database pool is required")
	}
	return &postgresSharedStore{pool: pool}, nil
}

func (s *postgresSharedStore) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return s.pool.Exec(ctx, sql, arguments...)
}

func (s *postgresSharedStore) QueryRow(ctx context.Context, sql string, args ...any) sqlRow {
	return s.pool.QueryRow(ctx, sql, args...)
}

func (s *postgresSharedStore) Query(ctx context.Context, sql string, args ...any) (sqlRows, error) {
	return s.pool.Query(ctx, sql, args...)
}

func (s *postgresSharedStore) WithinTx(ctx context.Context, opts pgx.TxOptions, fn func(sqlExecutor) error) (runErr error) {
	if fn == nil {
		return errors.New("transaction callback is required")
	}
	tx, err := s.pool.BeginTx(ctx, opts)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(context.WithoutCancel(ctx))
	}()
	if err := fn(pgxExecutor{queryer: tx}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

type projectStore interface {
	WithinProjectTx(ctx context.Context, projectID int64, opts pgx.TxOptions, fn func(sqlExecutor) error) error
}

type postgresProjectStore struct {
	executor *tenant.Executor
}

func newPostgresProjectStore(pool *pgxpool.Pool) (*postgresProjectStore, error) {
	if pool == nil {
		return nil, errors.New("database pool is required")
	}
	return &postgresProjectStore{executor: tenant.NewExecutor(pool)}, nil
}

func (s *postgresProjectStore) WithinProjectTx(ctx context.Context, projectID int64, opts pgx.TxOptions, fn func(sqlExecutor) error) error {
	if fn == nil {
		return errors.New("project transaction callback is required")
	}
	return s.executor.WithinTx(ctx, tenant.Project{ID: projectID}, opts, func(ctx context.Context, tx pgx.Tx) error {
		return fn(pgxExecutor{queryer: tx})
	})
}

func parseProjectID(value string) (int64, error) {
	projectID, err := strconv.ParseInt(value, 10, 64)
	if err != nil || projectID <= 0 || strconv.FormatInt(projectID, 10) != value {
		return 0, errors.New("project ID must be a canonical positive integer")
	}
	return projectID, nil
}
