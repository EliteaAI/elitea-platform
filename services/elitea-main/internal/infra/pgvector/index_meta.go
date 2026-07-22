package pgvector

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	defaultCurrentIndexMetaQueryTimeout = 15 * time.Second
	currentIndexMetaCloseTimeout        = 5 * time.Second
	defaultCurrentIndexMetaConnections  = 16
)

var ErrCurrentIndexMetaRead = errors.New("pgvector: current index meta read failed")

// CurrentIndexMetaReader opens the already-resolved project-owned PgVector
// target for one bounded request. It starts no goroutines, never accepts a
// schema name independently of the saved toolkit ID, and never includes a DSN
// or driver error in its returned error.
type CurrentIndexMetaReader struct {
	queryTimeout time.Duration
	gate         chan struct{}
}

func NewCurrentIndexMetaReader() *CurrentIndexMetaReader {
	return &CurrentIndexMetaReader{
		queryTimeout: defaultCurrentIndexMetaQueryTimeout,
		gate:         make(chan struct{}, defaultCurrentIndexMetaConnections),
	}
}

func (r *CurrentIndexMetaReader) List(
	ctx context.Context,
	target indexmetaapp.ResolvedTarget,
) ([]indexmetaapp.RawRecord, error) {
	if r == nil || ctx == nil || r.queryTimeout <= 0 || r.gate == nil || cap(r.gate) <= 0 ||
		target.SchemaID <= 0 || target.MaxRows <= 0 || target.MaxRows > indexmetaapp.MaxCurrentIndexMetaRows ||
		target.MaxMetadataBytes <= 0 || target.MaxMetadataBytes > indexmetaapp.MaxCurrentIndexMetaMetadataBytes ||
		target.MaxTotalBytes <= 0 || target.MaxTotalBytes > indexmetaapp.MaxCurrentIndexMetaTotalBytes {
		return nil, ErrCurrentIndexMetaRead
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case r.gate <- struct{}{}:
		defer func() { <-r.gate }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	dsn, ok := normalizeCurrentPgvectorDSN(target.ConnectionString)
	if !ok {
		return nil, ErrCurrentIndexMetaRead
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, ErrCurrentIndexMetaRead
	}

	queryContext, cancel := context.WithTimeout(ctx, r.queryTimeout)
	defer cancel()
	connection, err := pgx.ConnectConfig(queryContext, config)
	if err != nil {
		return nil, currentIndexMetaReadError(queryContext, err)
	}
	closed := false
	defer func() {
		if !closed {
			closeContext, closeCancel := context.WithTimeout(context.Background(), currentIndexMetaCloseTimeout)
			defer closeCancel()
			_ = connection.Close(closeContext)
		}
	}()

	schema := pgx.Identifier{strconv.FormatInt(int64(target.SchemaID), 10)}.Sanitize()
	statement := `
SELECT
    id,
    CASE WHEN octet_length(cmetadata::text) <= $2 THEN cmetadata ELSE NULL END,
    octet_length(cmetadata::text)
FROM ` + schema + `.langchain_pg_embedding
WHERE cmetadata @> '{"type":"index_meta"}'::jsonb
ORDER BY (cmetadata->>'updated_on')::numeric DESC NULLS LAST, id ASC
LIMIT $1`
	rows, err := connection.Query(queryContext, statement, target.MaxRows+1, target.MaxMetadataBytes)
	if err != nil {
		if currentIndexMetaTableMissing(err) {
			if closeErr := closeCurrentIndexMetaConnection(connection); closeErr != nil {
				return nil, closeErr
			}
			closed = true
			return []indexmetaapp.RawRecord{}, nil
		}
		return nil, currentIndexMetaReadError(queryContext, err)
	}
	defer rows.Close()

	records := make([]indexmetaapp.RawRecord, 0, min(target.MaxRows, 128))
	totalBytes := 0
	for rows.Next() {
		var id string
		var metadata []byte
		var storedBytes int32
		if err := rows.Scan(&id, &metadata, &storedBytes); err != nil {
			return nil, currentIndexMetaReadError(queryContext, err)
		}
		if id == "" || len(id) > indexmetaapp.MaxCurrentIndexMetaIDBytes ||
			storedBytes <= 0 || int(storedBytes) > target.MaxMetadataBytes || len(metadata) == 0 ||
			len(metadata) > target.MaxMetadataBytes {
			return nil, indexmetaapp.ErrCurrentIndexMetaLimitExceeded
		}
		totalBytes += len(id) + len(metadata)
		if totalBytes > target.MaxTotalBytes {
			return nil, indexmetaapp.ErrCurrentIndexMetaLimitExceeded
		}
		records = append(records, indexmetaapp.RawRecord{
			ID:       id,
			Metadata: append([]byte(nil), metadata...),
		})
		if len(records) > target.MaxRows {
			return nil, indexmetaapp.ErrCurrentIndexMetaLimitExceeded
		}
	}
	if err := rows.Err(); err != nil {
		return nil, currentIndexMetaReadError(queryContext, err)
	}
	rows.Close()
	if err := closeCurrentIndexMetaConnection(connection); err != nil {
		return nil, err
	}
	closed = true
	return records, nil
}

func normalizeCurrentPgvectorDSN(value string) (string, bool) {
	if value == "" || len(value) > indexmetaapp.MaxCurrentPgvectorDSNBytes || strings.ContainsAny(value, "\x00\r\n") {
		return "", false
	}
	switch {
	case strings.HasPrefix(value, "postgresql+psycopg://"):
		return "postgresql://" + strings.TrimPrefix(value, "postgresql+psycopg://"), true
	case strings.HasPrefix(value, "postgresql://"), strings.HasPrefix(value, "postgres://"):
		return value, true
	default:
		return "", false
	}
}

func currentIndexMetaTableMissing(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "42P01"
}

func currentIndexMetaReadError(ctx context.Context, cause error) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	if errors.Is(cause, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return ErrCurrentIndexMetaRead
}

func closeCurrentIndexMetaConnection(connection *pgx.Conn) error {
	closeContext, cancel := context.WithTimeout(context.Background(), currentIndexMetaCloseTimeout)
	defer cancel()
	if err := connection.Close(closeContext); err != nil {
		return currentIndexMetaReadError(closeContext, err)
	}
	return nil
}

var _ indexmetaapp.ExternalReader = (*CurrentIndexMetaReader)(nil)
