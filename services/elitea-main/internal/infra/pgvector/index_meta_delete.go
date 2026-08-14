package pgvector

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
	"github.com/jackc/pgx/v5"
)

var ErrCurrentIndexMetaDelete = errors.New("pgvector: current index metadata delete failed")

// CurrentIndexMetaRemover performs the current synchronous PgVector
// transaction. Its deliberate safety corrections require the selected ID to
// be an index_meta row and its collection to be a bounded JSON string before
// that exact string collection can be deleted.
type CurrentIndexMetaRemover struct {
	queryTimeout time.Duration
	gate         chan struct{}
}

func NewCurrentIndexMetaRemover() *CurrentIndexMetaRemover {
	return &CurrentIndexMetaRemover{
		queryTimeout: defaultCurrentIndexMetaQueryTimeout,
		gate:         make(chan struct{}, defaultCurrentIndexMetaConnections),
	}
}

func (r *CurrentIndexMetaRemover) Delete(
	ctx context.Context,
	target indexmetaapp.ResolvedTarget,
	indexMetaID string,
) (string, error) {
	if r == nil || ctx == nil || r.queryTimeout <= 0 ||
		r.gate == nil || cap(r.gate) <= 0 || target.SchemaID <= 0 ||
		target.ConnectionString == "" ||
		len(target.ConnectionString) > indexmetaapp.MaxCurrentPgvectorDSNBytes ||
		strings.ContainsAny(target.ConnectionString, "\x00\r\n") ||
		indexMetaID == "" ||
		len(indexMetaID) > indexmetaapp.MaxCurrentIndexMetaIDBytes ||
		strings.ContainsAny(indexMetaID, "\x00\r\n") {
		return "", ErrCurrentIndexMetaDelete
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	select {
	case r.gate <- struct{}{}:
		defer func() { <-r.gate }()
	case <-ctx.Done():
		return "", ctx.Err()
	}

	dsn, ok := normalizeCurrentPgvectorDSN(target.ConnectionString)
	if !ok {
		return "", ErrCurrentIndexMetaDelete
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return "", ErrCurrentIndexMetaDelete
	}
	queryContext, cancel := context.WithTimeout(ctx, r.queryTimeout)
	defer cancel()
	connection, err := pgx.ConnectConfig(queryContext, config)
	if err != nil {
		return "", currentIndexMetaDeleteError(queryContext, err)
	}
	defer closeCurrentIndexMetaDeleteConnection(connection)

	transaction, err := connection.BeginTx(queryContext, pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadWrite,
	})
	if err != nil {
		return "", currentIndexMetaDeleteError(queryContext, err)
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		rollbackContext, rollbackCancel := context.WithTimeout(
			context.Background(),
			currentIndexMetaCloseTimeout,
		)
		defer rollbackCancel()
		_ = transaction.Rollback(rollbackContext)
	}()

	schema := pgx.Identifier{
		strconv.FormatInt(int64(target.SchemaID), 10),
	}.Sanitize()
	var rawIndexName []byte
	err = transaction.QueryRow(queryContext, `
SELECT cmetadata->'collection'
FROM `+schema+`.langchain_pg_embedding
WHERE id = $1
  AND cmetadata->'type' = to_jsonb('index_meta'::text)`,
		indexMetaID,
	).Scan(&rawIndexName)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", indexmetaapp.ErrCurrentIndexMetaNotFound
	}
	if err != nil {
		return "", currentIndexMetaDeleteError(queryContext, err)
	}
	var indexName string
	if err := json.Unmarshal(rawIndexName, &indexName); err != nil ||
		!validCurrentIndexMetaCollection(indexName) {
		return "", ErrCurrentIndexMetaDelete
	}

	_, err = transaction.Exec(queryContext, `
DELETE FROM `+schema+`.langchain_pg_embedding
WHERE cmetadata->'collection' = to_jsonb($1::text)`,
		indexName,
	)
	if err != nil {
		return "", currentIndexMetaDeleteError(queryContext, err)
	}
	if err := transaction.Commit(queryContext); err != nil {
		return "", currentIndexMetaDeleteError(queryContext, err)
	}
	committed = true
	return indexName, nil
}

func validCurrentIndexMetaCollection(value string) bool {
	return value != "" &&
		len(value) <= indexmetaapp.MaxCurrentIndexMetaCollectionBytes &&
		utf8.ValidString(value) &&
		!strings.ContainsAny(value, "\x00\r\n")
}

func closeCurrentIndexMetaDeleteConnection(connection *pgx.Conn) {
	if connection == nil {
		return
	}
	closeContext, cancel := context.WithTimeout(
		context.Background(),
		currentIndexMetaCloseTimeout,
	)
	defer cancel()
	_ = connection.Close(closeContext)
}

func currentIndexMetaDeleteError(ctx context.Context, cause error) error {
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
	return ErrCurrentIndexMetaDelete
}

var _ indexmetaapp.ExternalDeleter = (*CurrentIndexMetaRemover)(nil)
