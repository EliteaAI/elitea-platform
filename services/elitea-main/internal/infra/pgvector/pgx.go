package pgvector

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// PGXConnector owns an immutable copy of the public PgVector administrator
// connection configuration. Each Connect call clones it and changes only the
// target database, so concurrent project provisioning cannot race on config.
type PGXConnector struct {
	config *pgx.ConnConfig
}

// NewPGXConnector creates the live adapter without opening a connection. The
// caller remains responsible for resolving the public configuration and secret
// before construction.
func NewPGXConnector(config *pgx.ConnConfig) (*PGXConnector, error) {
	if config == nil {
		return nil, ErrInvalidConnector
	}
	return &PGXConnector{config: config.Copy()}, nil
}

// Connect opens one direct auto-commit pgx connection. Provisioner validates
// database before invoking this method and closes every returned connection.
func (c *PGXConnector) Connect(ctx context.Context, database string) (Connection, error) {
	if ctx == nil || c == nil || c.config == nil || !validPostgresName(database) {
		return nil, ErrInvalidRequest
	}
	config := c.config.Copy()
	config.Database = database
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return nil, operationError(ctx, "connect", err)
	}
	return pgxConnection{connection: connection}, nil
}

type pgxConnection struct {
	connection *pgx.Conn
}

func (c pgxConnection) QueryBool(ctx context.Context, statement string, args ...any) (bool, error) {
	var value bool
	err := c.connection.QueryRow(ctx, statement, args...).Scan(&value)
	return value, err
}

func (c pgxConnection) Exec(ctx context.Context, statement string, args ...any) error {
	_, err := c.connection.Exec(ctx, statement, args...)
	return err
}

func (c pgxConnection) Close(ctx context.Context) error {
	return c.connection.Close(ctx)
}
