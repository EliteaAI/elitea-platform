package pgvector

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"reflect"
	"strconv"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
	"github.com/jackc/pgx/v5"
)

const (
	defaultCurrentIndexMetaWriteTimeout = 30 * time.Second
	defaultCurrentIndexMetaWrites       = 16
	maxCurrentIndexMetaAdoptionHistory  = 4_096

	// maxCurrentIndexMetaHistoryBytes is the largest encoded history array one
	// index metadata row keeps. Entry size is data-dependent, so the entry
	// ceiling alone cannot hold the row under the write cap. The row nests the
	// array as a JSON string, and escaping can double that string. A quarter of
	// the write cap therefore holds the row under the cap in the worst case.
	maxCurrentIndexMetaHistoryBytes = indexingapp.MaxCurrentInitialIndexMetaBytes / 4
)

var ErrCurrentIndexMetaWrite = errors.New("pgvector: current index metadata write failed")

// CurrentIndexMetaWriter owns the bounded external transaction that creates or
// resets the one current index_meta row for a toolkit/index pair. A
// schema-scoped advisory transaction lock serializes first-table creation and
// same-index conflict checks without adding a process-local correctness
// dependency.
type CurrentIndexMetaWriter struct {
	queryTimeout time.Duration
	gate         chan struct{}
}

func NewCurrentIndexMetaWriter() *CurrentIndexMetaWriter {
	return &CurrentIndexMetaWriter{
		queryTimeout: defaultCurrentIndexMetaWriteTimeout,
		gate:         make(chan struct{}, defaultCurrentIndexMetaWrites),
	}
}

func (w *CurrentIndexMetaWriter) MaterializeInitial(
	ctx context.Context,
	target indexingapp.CurrentIndexMetaTarget,
	record indexingapp.CurrentInitialIndexMeta,
) error {
	if w == nil || ctx == nil || w.queryTimeout <= 0 || w.gate == nil || cap(w.gate) <= 0 ||
		target.SchemaID <= 0 || target.SchemaID != record.ToolkitID ||
		len(target.ConnectionString) == 0 ||
		len(target.ConnectionString) > indexingapp.MaxCurrentIndexMetaConnectionStringBytes ||
		record.Validate() != nil {
		return ErrCurrentIndexMetaWrite
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case w.gate <- struct{}{}:
		defer func() { <-w.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}

	dsn, ok := normalizeCurrentPgvectorDSN(target.ConnectionString)
	if !ok {
		return indexingapp.ErrCurrentIndexMetaTargetUnavailable
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return indexingapp.ErrCurrentIndexMetaTargetUnavailable
	}
	queryContext, cancel := context.WithTimeout(ctx, w.queryTimeout)
	defer cancel()
	connection, err := pgx.ConnectConfig(queryContext, config)
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	closed := false
	defer func() {
		if !closed {
			closeContext, closeCancel := context.WithTimeout(context.Background(), currentIndexMetaCloseTimeout)
			defer closeCancel()
			_ = connection.Close(closeContext)
		}
	}()

	transaction, err := connection.BeginTx(queryContext, pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadWrite,
	})
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed := false
	defer func() {
		if !committed {
			rollbackContext, rollbackCancel := context.WithTimeout(context.Background(), currentIndexMetaCloseTimeout)
			defer rollbackCancel()
			_ = transaction.Rollback(rollbackContext)
		}
	}()

	schema := pgx.Identifier{strconv.FormatInt(int64(target.SchemaID), 10)}.Sanitize()
	if _, err := transaction.Exec(
		queryContext,
		`SELECT pg_advisory_xact_lock($1::integer, 0)`,
		target.SchemaID,
	); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	for _, statement := range currentIndexMetaSchemaStatements(schema) {
		if _, err := transaction.Exec(queryContext, statement); err != nil {
			return currentIndexMetaWriteError(queryContext, err)
		}
	}

	existing, err := loadCurrentIndexMetaForUpdate(queryContext, transaction, schema, record.IndexName)
	if err != nil {
		return err
	}
	plan, err := planCurrentInitialIndexMeta(record, existing)
	if err != nil {
		return err
	}
	switch {
	case plan.noop:
	case plan.insert:
		if _, err := transaction.Exec(
			queryContext,
			`INSERT INTO `+schema+`.langchain_pg_embedding (id, document, cmetadata)
VALUES ($1, $2, $3::jsonb)`,
			plan.id,
			plan.document,
			plan.metadata,
		); err != nil {
			return currentIndexMetaWriteError(queryContext, err)
		}
	default:
		tag, err := transaction.Exec(
			queryContext,
			`UPDATE `+schema+`.langchain_pg_embedding
SET cmetadata = $2::jsonb
WHERE id = $1`,
			plan.id,
			plan.metadata,
		)
		if err != nil {
			return currentIndexMetaWriteError(queryContext, err)
		}
		if tag.RowsAffected() != 1 {
			return indexingapp.ErrCurrentIndexMetaConflict
		}
	}

	if err := transaction.Commit(queryContext); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed = true
	closeContext, closeCancel := context.WithTimeout(context.Background(), currentIndexMetaCloseTimeout)
	defer closeCancel()
	if err := connection.Close(closeContext); err != nil {
		return currentIndexMetaWriteError(closeContext, err)
	}
	closed = true
	return nil
}

func (w *CurrentIndexMetaWriter) MaterializeTerminal(
	ctx context.Context,
	target indexingapp.CurrentIndexMetaTarget,
	record indexingapp.CurrentTerminalIndexMeta,
) error {
	// PoV parity is intentionally limited to the current index_meta contract.
	// Cancellation/failure does not delete partially written embeddings here;
	// cleanup requires a separately versioned manual-vs-system policy.
	if w == nil || ctx == nil || w.queryTimeout <= 0 || w.gate == nil || cap(w.gate) <= 0 ||
		target.SchemaID <= 0 || target.SchemaID != record.ToolkitID ||
		len(target.ConnectionString) == 0 ||
		len(target.ConnectionString) > indexingapp.MaxCurrentIndexMetaConnectionStringBytes ||
		record.Validate() != nil {
		return ErrCurrentIndexMetaWrite
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case w.gate <- struct{}{}:
		defer func() { <-w.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}

	dsn, ok := normalizeCurrentPgvectorDSN(target.ConnectionString)
	if !ok {
		return ErrCurrentIndexMetaWrite
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return ErrCurrentIndexMetaWrite
	}
	queryContext, cancel := context.WithTimeout(ctx, w.queryTimeout)
	defer cancel()
	connection, err := pgx.ConnectConfig(queryContext, config)
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	closed := false
	defer func() {
		if !closed {
			closeContext, closeCancel := context.WithTimeout(context.Background(), currentIndexMetaCloseTimeout)
			defer closeCancel()
			_ = connection.Close(closeContext)
		}
	}()

	transaction, err := connection.BeginTx(queryContext, pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadWrite,
	})
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed := false
	defer func() {
		if !committed {
			rollbackContext, rollbackCancel := context.WithTimeout(context.Background(), currentIndexMetaCloseTimeout)
			defer rollbackCancel()
			_ = transaction.Rollback(rollbackContext)
		}
	}()

	schema := pgx.Identifier{strconv.FormatInt(int64(target.SchemaID), 10)}.Sanitize()
	if _, err := transaction.Exec(
		queryContext,
		`SELECT pg_advisory_xact_lock($1::integer, 0)`,
		target.SchemaID,
	); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	existing, err := loadCurrentIndexMetaForUpdate(queryContext, transaction, schema, record.IndexName)
	if err != nil {
		return err
	}
	plan, err := planCurrentTerminalIndexMeta(record, existing)
	if err != nil {
		return err
	}
	if !plan.noop {
		tag, err := transaction.Exec(
			queryContext,
			`UPDATE `+schema+`.langchain_pg_embedding
SET cmetadata = $2::jsonb
WHERE id = $1`,
			plan.id,
			plan.metadata,
		)
		if err != nil {
			return currentIndexMetaWriteError(queryContext, err)
		}
		if tag.RowsAffected() != 1 {
			return indexingapp.ErrCurrentIndexMetaConflict
		}
	}

	if err := transaction.Commit(queryContext); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed = true
	closeContext, closeCancel := context.WithTimeout(context.Background(), currentIndexMetaCloseTimeout)
	defer closeCancel()
	if err := connection.Close(closeContext); err != nil {
		return currentIndexMetaWriteError(closeContext, err)
	}
	closed = true
	return nil
}

// MaterializeScheduledFailure applies the exact current pre-admission failed
// metadata shape. The stable occurrence marker is stored only in the history
// entry and makes retries converge after a partial notification failure.
func (w *CurrentIndexMetaWriter) MaterializeScheduledFailure(
	ctx context.Context,
	target indexmetaapp.ResolvedTarget,
	effect indexscheduleapp.FailureEffect,
) error {
	if w == nil || ctx == nil || w.queryTimeout <= 0 || w.gate == nil ||
		cap(w.gate) <= 0 || target.SchemaID <= 0 ||
		int64(target.SchemaID) != effect.ToolkitID ||
		len(target.ConnectionString) == 0 ||
		len(target.ConnectionString) > indexmetaapp.MaxCurrentPgvectorDSNBytes ||
		effect.Validate() != nil {
		return ErrCurrentIndexMetaWrite
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case w.gate <- struct{}{}:
		defer func() { <-w.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}

	dsn, ok := normalizeCurrentPgvectorDSN(target.ConnectionString)
	if !ok {
		return ErrCurrentIndexMetaWrite
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return ErrCurrentIndexMetaWrite
	}
	queryContext, cancel := context.WithTimeout(ctx, w.queryTimeout)
	defer cancel()
	connection, err := pgx.ConnectConfig(queryContext, config)
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	closed := false
	defer func() {
		if !closed {
			closeContext, closeCancel := context.WithTimeout(
				context.Background(),
				currentIndexMetaCloseTimeout,
			)
			defer closeCancel()
			_ = connection.Close(closeContext)
		}
	}()

	transaction, err := connection.BeginTx(queryContext, pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadWrite,
	})
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed := false
	defer func() {
		if !committed {
			rollbackContext, rollbackCancel := context.WithTimeout(
				context.Background(),
				currentIndexMetaCloseTimeout,
			)
			defer rollbackCancel()
			_ = transaction.Rollback(rollbackContext)
		}
	}()

	schema := pgx.Identifier{
		strconv.FormatInt(int64(target.SchemaID), 10),
	}.Sanitize()
	if _, err := transaction.Exec(
		queryContext,
		`SELECT pg_advisory_xact_lock($1::integer, 0)`,
		target.SchemaID,
	); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	existing, err := loadCurrentIndexMetaForUpdate(
		queryContext,
		transaction,
		schema,
		effect.IndexMetaID,
	)
	if err != nil {
		return err
	}
	plan, err := planCurrentScheduledFailure(effect, existing)
	if err != nil {
		return err
	}
	if !plan.noop {
		tag, err := transaction.Exec(
			queryContext,
			`UPDATE `+schema+`.langchain_pg_embedding
SET cmetadata = $2::jsonb
WHERE id = $1`,
			plan.id,
			plan.metadata,
		)
		if err != nil {
			return currentIndexMetaWriteError(queryContext, err)
		}
		if tag.RowsAffected() != 1 {
			return indexingapp.ErrCurrentIndexMetaConflict
		}
	}
	if err := transaction.Commit(queryContext); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed = true
	closeContext, closeCancel := context.WithTimeout(
		context.Background(),
		currentIndexMetaCloseTimeout,
	)
	defer closeCancel()
	if err := connection.Close(closeContext); err != nil {
		return currentIndexMetaWriteError(closeContext, err)
	}
	closed = true
	return nil
}

func (w *CurrentIndexMetaWriter) CleanupManualStop(
	ctx context.Context,
	target indexingapp.CurrentIndexMetaTarget,
	record indexingapp.CurrentManualStopCleanup,
) error {
	if w == nil || ctx == nil || w.queryTimeout <= 0 || w.gate == nil ||
		cap(w.gate) <= 0 ||
		target.SchemaID <= 0 || target.SchemaID != record.ToolkitID ||
		len(target.ConnectionString) == 0 ||
		len(target.ConnectionString) >
			indexingapp.MaxCurrentIndexMetaConnectionStringBytes ||
		record.Validate() != nil {
		return ErrCurrentIndexMetaWrite
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case w.gate <- struct{}{}:
		defer func() { <-w.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}

	dsn, ok := normalizeCurrentPgvectorDSN(target.ConnectionString)
	if !ok {
		return ErrCurrentIndexMetaWrite
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return ErrCurrentIndexMetaWrite
	}
	queryContext, cancel := context.WithTimeout(ctx, w.queryTimeout)
	defer cancel()
	connection, err := pgx.ConnectConfig(queryContext, config)
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	closed := false
	defer func() {
		if !closed {
			closeContext, closeCancel := context.WithTimeout(
				context.Background(),
				currentIndexMetaCloseTimeout,
			)
			defer closeCancel()
			_ = connection.Close(closeContext)
		}
	}()

	transaction, err := connection.BeginTx(queryContext, pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadWrite,
	})
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed := false
	defer func() {
		if !committed {
			rollbackContext, rollbackCancel := context.WithTimeout(
				context.Background(),
				currentIndexMetaCloseTimeout,
			)
			defer rollbackCancel()
			_ = transaction.Rollback(rollbackContext)
		}
	}()

	schema := pgx.Identifier{
		strconv.FormatInt(int64(target.SchemaID), 10),
	}.Sanitize()
	if _, err := transaction.Exec(
		queryContext,
		`SELECT pg_advisory_xact_lock($1::integer, 0)`,
		target.SchemaID,
	); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	existing, err := loadCurrentIndexMetaForUpdate(
		queryContext,
		transaction,
		schema,
		record.IndexName,
	)
	if err != nil {
		return err
	}
	if len(existing) != 0 {
		if err := planCurrentManualStopCleanup(record, existing); err != nil {
			return err
		}
		if _, err := transaction.Exec(
			queryContext,
			`DELETE FROM `+schema+`.langchain_pg_embedding
WHERE cmetadata->>'collection' = $1
  AND cmetadata->>'type' <> 'index_meta'`,
			record.IndexName,
		); err != nil {
			return currentIndexMetaWriteError(queryContext, err)
		}
	}
	if err := transaction.Commit(queryContext); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed = true
	closeContext, closeCancel := context.WithTimeout(
		context.Background(),
		currentIndexMetaCloseTimeout,
	)
	defer closeCancel()
	if err := connection.Close(closeContext); err != nil {
		return currentIndexMetaWriteError(closeContext, err)
	}
	closed = true
	return nil
}

func (w *CurrentIndexMetaWriter) MaterializeTaskID(
	ctx context.Context,
	target indexingapp.CurrentIndexMetaTarget,
	record indexingapp.CurrentTaskRestampIndexMeta,
) error {
	if w == nil || ctx == nil || w.queryTimeout <= 0 || w.gate == nil ||
		cap(w.gate) <= 0 ||
		target.SchemaID <= 0 || target.SchemaID != record.ToolkitID ||
		len(target.ConnectionString) == 0 ||
		len(target.ConnectionString) >
			indexingapp.MaxCurrentIndexMetaConnectionStringBytes ||
		record.Validate() != nil {
		return ErrCurrentIndexMetaWrite
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case w.gate <- struct{}{}:
		defer func() { <-w.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}

	dsn, ok := normalizeCurrentPgvectorDSN(target.ConnectionString)
	if !ok {
		return ErrCurrentIndexMetaWrite
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return ErrCurrentIndexMetaWrite
	}
	queryContext, cancel := context.WithTimeout(ctx, w.queryTimeout)
	defer cancel()
	connection, err := pgx.ConnectConfig(queryContext, config)
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	closed := false
	defer func() {
		if !closed {
			closeContext, closeCancel := context.WithTimeout(
				context.Background(),
				currentIndexMetaCloseTimeout,
			)
			defer closeCancel()
			_ = connection.Close(closeContext)
		}
	}()

	transaction, err := connection.BeginTx(queryContext, pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadWrite,
	})
	if err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed := false
	defer func() {
		if !committed {
			rollbackContext, rollbackCancel := context.WithTimeout(
				context.Background(),
				currentIndexMetaCloseTimeout,
			)
			defer rollbackCancel()
			_ = transaction.Rollback(rollbackContext)
		}
	}()

	schema := pgx.Identifier{
		strconv.FormatInt(int64(target.SchemaID), 10),
	}.Sanitize()
	if _, err := transaction.Exec(
		queryContext,
		`SELECT pg_advisory_xact_lock($1::integer, 0)`,
		target.SchemaID,
	); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	existing, err := loadCurrentIndexMetaForUpdate(
		queryContext,
		transaction,
		schema,
		record.IndexName,
	)
	if err != nil {
		return err
	}
	plan, err := planCurrentTaskRestampIndexMeta(record, existing)
	if err != nil {
		return err
	}
	if !plan.noop {
		tag, err := transaction.Exec(
			queryContext,
			`UPDATE `+schema+`.langchain_pg_embedding
SET cmetadata = $2::jsonb
WHERE id = $1`,
			plan.id,
			plan.metadata,
		)
		if err != nil {
			return currentIndexMetaWriteError(queryContext, err)
		}
		if tag.RowsAffected() != 1 {
			return indexingapp.ErrCurrentIndexMetaConflict
		}
	}
	if err := transaction.Commit(queryContext); err != nil {
		return currentIndexMetaWriteError(queryContext, err)
	}
	committed = true
	closeContext, closeCancel := context.WithTimeout(
		context.Background(),
		currentIndexMetaCloseTimeout,
	)
	defer closeCancel()
	if err := connection.Close(closeContext); err != nil {
		return currentIndexMetaWriteError(closeContext, err)
	}
	closed = true
	return nil
}

func currentIndexMetaSchemaStatements(schema string) []string {
	return []string{
		`CREATE SCHEMA IF NOT EXISTS ` + schema,
		`CREATE TABLE IF NOT EXISTS ` + schema + `.langchain_pg_collection (
uuid UUID NOT NULL PRIMARY KEY,
name VARCHAR NOT NULL UNIQUE,
cmetadata JSON
)`,
		`CREATE TABLE IF NOT EXISTS ` + schema + `.langchain_pg_embedding (
id VARCHAR NOT NULL PRIMARY KEY,
collection_id UUID REFERENCES ` + schema + `.langchain_pg_collection (uuid) ON DELETE CASCADE,
embedding vector,
document VARCHAR,
cmetadata JSONB
)`,
		`CREATE INDEX IF NOT EXISTS ix_cmetadata_gin
ON ` + schema + `.langchain_pg_embedding
USING gin (cmetadata jsonb_path_ops)`,
	}
}

type currentStoredIndexMeta struct {
	id       string
	document *string
	metadata map[string]any
}

func loadCurrentIndexMetaForUpdate(
	ctx context.Context,
	transaction pgx.Tx,
	schema string,
	indexName string,
) ([]currentStoredIndexMeta, error) {
	rows, err := transaction.Query(ctx, `
SELECT id,
       document,
       CASE
           WHEN octet_length(cmetadata::text) <= $2 THEN cmetadata
           ELSE NULL
       END,
       octet_length(cmetadata::text)
FROM `+schema+`.langchain_pg_embedding
WHERE cmetadata @> '{"type":"index_meta"}'::jsonb
  AND cmetadata->>'collection' = $1
ORDER BY id
LIMIT 2
FOR UPDATE`, indexName, indexingapp.MaxCurrentIndexMetaReadBytes)
	if err != nil {
		return nil, currentIndexMetaWriteError(ctx, err)
	}
	defer rows.Close()

	existing := make([]currentStoredIndexMeta, 0, 1)
	for rows.Next() {
		var stored currentStoredIndexMeta
		var raw []byte
		var storedBytes int32
		if err := rows.Scan(&stored.id, &stored.document, &raw, &storedBytes); err != nil {
			return nil, currentIndexMetaWriteError(ctx, err)
		}
		// The read ceiling is larger than the write cap on purpose. An
		// over-cap row must stay readable, because the write path repairs it.
		if stored.id == "" || storedBytes <= 0 ||
			int(storedBytes) > indexingapp.MaxCurrentIndexMetaReadBytes || len(raw) == 0 {
			return nil, indexingapp.ErrCurrentIndexMetaConflict
		}
		metadata, err := decodeCurrentIndexMetaJSON(raw)
		if err != nil {
			return nil, indexingapp.ErrCurrentIndexMetaConflict
		}
		stored.metadata = metadata
		existing = append(existing, stored)
	}
	if err := rows.Err(); err != nil {
		return nil, currentIndexMetaWriteError(ctx, err)
	}
	if len(existing) > 1 {
		return nil, indexingapp.ErrCurrentIndexMetaConflict
	}
	return existing, nil
}

type currentIndexMetaWritePlan struct {
	id       string
	document string
	metadata []byte
	insert   bool
	noop     bool
}

func planCurrentInitialIndexMeta(
	record indexingapp.CurrentInitialIndexMeta,
	existing []currentStoredIndexMeta,
) (currentIndexMetaWritePlan, error) {
	if err := record.Validate(); err != nil || len(existing) > 1 {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	initial, err := decodeCurrentIndexMetaJSON(record.InitialMetadata)
	if err != nil || !currentInitialIndexMetaMatchesRecord(initial, record) {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	if len(existing) == 0 {
		// Main owns pre-dispatch top-level visibility. The SDK owns the one
		// mutable history entry for each run, so Main creates only the
		// permanent, run-neutral marker here.
		metadata, err := encodeCurrentIndexMetaWithHistory(
			initial,
			[]any{currentCreatedIndexMetaMarker(initial)},
		)
		if err != nil {
			return currentIndexMetaWritePlan{}, err
		}
		return currentIndexMetaWritePlan{
			id:       record.MetaID,
			document: record.Document,
			metadata: metadata,
			insert:   true,
		}, nil
	}

	stored := existing[0]
	storedIndexGeneration, generationOK := currentIndexMetaLogicalGeneration(stored.metadata)
	if !generationOK {
		storedIndexGeneration, generationOK =
			currentIndexMetaAdoptionGeneration(stored, record)
		if !generationOK {
			return currentIndexMetaWritePlan{},
				indexingapp.ErrCurrentIndexMetaConflict
		}
	}
	storedMetaID, _ := stored.metadata["index_meta_id"].(string)
	if storedMetaID == record.MetaID {
		if storedIndexGeneration != int64(record.IndexGeneration) ||
			stored.document == nil || *stored.document != record.Document ||
			!currentIndexMetaRetryMatches(stored.metadata, initial) {
			return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
		}
		return currentIndexMetaWritePlan{noop: true}, nil
	}
	if storedIndexGeneration > int64(record.IndexGeneration) {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaSuperseded
	}
	if storedIndexGeneration == int64(record.IndexGeneration) {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	state, _ := stored.metadata["state"].(string)
	if !currentIndexMetaCanStartNextGeneration(state) {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}

	history, historyOK := decodeCurrentIndexMetaHistory(
		stored.metadata["history"],
	)
	if !historyOK {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaConflict
	}
	// The unchanged SDK appends this generation's active entry after it starts.
	metadata, err := encodeCurrentIndexMetaWithHistory(initial, history)
	if err != nil {
		return currentIndexMetaWritePlan{}, err
	}
	return currentIndexMetaWritePlan{
		id:       stored.id,
		document: record.Document,
		metadata: metadata,
	}, nil
}

func planCurrentTerminalIndexMeta(
	record indexingapp.CurrentTerminalIndexMeta,
	existing []currentStoredIndexMeta,
) (currentIndexMetaWritePlan, error) {
	if err := record.Validate(); err != nil || len(existing) != 1 {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	stored := existing[0]
	indexGeneration, indexGenerationOK := currentIndexMetaLogicalGeneration(stored.metadata)
	if indexGenerationOK && indexGeneration > int64(record.IndexGeneration) {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaSuperseded
	}
	executionGeneration, executionGenerationOK := currentIndexMetaInt64(stored.metadata["execution_generation"])
	if stored.metadata["index_meta_id"] != record.MetaID ||
		stored.metadata["execution_id"] != record.ExecutionID ||
		!indexGenerationOK || indexGeneration != int64(record.IndexGeneration) ||
		!executionGenerationOK || executionGeneration != int64(record.Generation) {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	state, stateOK := stored.metadata["state"].(string)
	if !stateOK {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	terminal := cloneCurrentIndexMetaObject(stored.metadata)
	delete(terminal, "history")
	terminal["state"] = string(record.State)
	terminal["index_generation"] = record.IndexGeneration
	terminal["updated_on"] = currentIndexMetaUnixSeconds(record.OccurredAt)
	switch record.State {
	case indexingapp.CurrentIndexMetaFailed:
		terminal["error"] = record.SafeError
	case indexingapp.CurrentIndexMetaCancelled:
		terminal["task_id"] = nil
		terminal["error"] = nil
	}
	if state == string(record.State) {
		history, historyOK := decodeCurrentIndexMetaHistory(
			stored.metadata["history"],
		)
		if !historyOK {
			return currentIndexMetaWritePlan{},
				indexingapp.ErrCurrentIndexMetaConflict
		}
		runIndex, err := currentIndexMetaHistoryRunIndex(history, record)
		if err != nil || runIndex != len(history)-1 ||
			!currentTerminalIndexMetaCompatible(
				stored.metadata,
				history,
				record,
			) {
			return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
		}
		if _, present := stored.metadata["index_generation"]; present {
			return currentIndexMetaWritePlan{noop: true}, nil
		}
		last := history[runIndex].(map[string]any)
		last["index_generation"] = record.IndexGeneration
		metadata, err := encodeCurrentIndexMetaWithHistory(terminal, history)
		if err != nil {
			return currentIndexMetaWritePlan{}, err
		}
		return currentIndexMetaWritePlan{id: stored.id, metadata: metadata}, nil
	}
	if state != "in_progress" && !currentIndexMetaCanStartNextGeneration(state) {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}

	history, historyOK := decodeCurrentIndexMetaHistory(
		stored.metadata["history"],
	)
	if !historyOK {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	runIndex, err := currentIndexMetaHistoryRunIndex(history, record)
	if err != nil {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaConflict
	}
	if runIndex >= 0 {
		// The SDK started and therefore owns the exact last run entry.
		active := history[runIndex].(map[string]any)
		if runIndex != len(history)-1 ||
			active["state"] != state ||
			!reflect.DeepEqual(
				active["created_on"],
				terminal["created_on"],
			) {
			return currentIndexMetaWritePlan{},
				indexingapp.ErrCurrentIndexMetaConflict
		}
		history[runIndex] = cloneCurrentIndexMetaValue(terminal)
	} else {
		// Main still owns terminalization when the SDK never started.
		if state != "in_progress" ||
			currentIndexMetaHistoryHasUnfencedActiveRun(history) {
			return currentIndexMetaWritePlan{},
				indexingapp.ErrCurrentIndexMetaConflict
		}
		history = append(history, cloneCurrentIndexMetaValue(terminal))
	}
	metadata, err := encodeCurrentIndexMetaWithHistory(terminal, history)
	if err != nil {
		return currentIndexMetaWritePlan{}, err
	}
	return currentIndexMetaWritePlan{id: stored.id, metadata: metadata}, nil
}

func planCurrentScheduledFailure(
	effect indexscheduleapp.FailureEffect,
	existing []currentStoredIndexMeta,
) (currentIndexMetaWritePlan, error) {
	if effect.Validate() != nil || len(existing) > 1 {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaConflict
	}
	// The current implementation only warns if the exact metadata row no
	// longer exists. Preserve that non-fatal outcome.
	if len(existing) == 0 {
		return currentIndexMetaWritePlan{noop: true}, nil
	}
	stored := existing[0]
	history, ok := decodeCurrentIndexMetaHistory(stored.metadata["history"])
	if !ok {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaConflict
	}
	for _, entry := range history {
		object, ok := entry.(map[string]any)
		if ok && object["schedule_effect_id"] == effect.EffectID {
			return currentIndexMetaWritePlan{noop: true}, nil
		}
	}
	failed := cloneCurrentIndexMetaObject(stored.metadata)
	delete(failed, "history")
	failed["state"] = "failed"
	failed["updated_on"] = currentIndexMetaUnixSeconds(effect.OccurredAt)
	failed["error"] = effect.SafeReason
	historyEntry := cloneCurrentIndexMetaObject(failed)
	historyEntry["schedule_effect_id"] = effect.EffectID
	history = append(history, historyEntry)
	metadata, err := encodeCurrentIndexMetaWithHistory(failed, history)
	if err != nil {
		return currentIndexMetaWritePlan{}, err
	}
	return currentIndexMetaWritePlan{id: stored.id, metadata: metadata}, nil
}

func planCurrentManualStopCleanup(
	record indexingapp.CurrentManualStopCleanup,
	existing []currentStoredIndexMeta,
) error {
	if record.Validate() != nil || len(existing) != 1 {
		return indexingapp.ErrCurrentIndexMetaConflict
	}
	stored := existing[0]
	indexGeneration, indexGenerationOK :=
		currentIndexMetaLogicalGeneration(stored.metadata)
	if indexGenerationOK &&
		indexGeneration > int64(record.IndexGeneration) {
		return indexingapp.ErrCurrentIndexMetaSuperseded
	}
	executionGeneration, executionGenerationOK :=
		currentIndexMetaInt64(stored.metadata["execution_generation"])
	toolkitID, toolkitIDOK :=
		currentIndexMetaInt64(stored.metadata["toolkit_id"])
	if stored.metadata["index_meta_id"] != record.MetaID ||
		stored.metadata["execution_id"] != record.ExecutionID ||
		!indexGenerationOK ||
		indexGeneration != int64(record.IndexGeneration) ||
		!executionGenerationOK ||
		executionGeneration != int64(record.Generation) ||
		!toolkitIDOK ||
		toolkitID != int64(record.ToolkitID) ||
		stored.metadata["state"] !=
			string(indexingapp.CurrentIndexMetaCancelled) ||
		stored.metadata["task_id"] != nil {
		return indexingapp.ErrCurrentIndexMetaConflict
	}
	history := currentIndexMetaHistory(stored.metadata["history"])
	if len(history) == 0 {
		return indexingapp.ErrCurrentIndexMetaConflict
	}
	last, ok := history[len(history)-1].(map[string]any)
	if !ok ||
		last["state"] != string(indexingapp.CurrentIndexMetaCancelled) ||
		last["task_id"] != nil ||
		last["index_meta_id"] != record.MetaID ||
		last["execution_id"] != record.ExecutionID {
		return indexingapp.ErrCurrentIndexMetaConflict
	}
	lastIndexGeneration, lastIndexGenerationOK :=
		currentIndexMetaLogicalGeneration(last)
	lastExecutionGeneration, lastExecutionGenerationOK :=
		currentIndexMetaInt64(last["execution_generation"])
	if !lastIndexGenerationOK ||
		lastIndexGeneration != int64(record.IndexGeneration) ||
		!lastExecutionGenerationOK ||
		lastExecutionGeneration != int64(record.Generation) {
		return indexingapp.ErrCurrentIndexMetaConflict
	}
	return nil
}

func planCurrentTaskRestampIndexMeta(
	record indexingapp.CurrentTaskRestampIndexMeta,
	existing []currentStoredIndexMeta,
) (currentIndexMetaWritePlan, error) {
	if err := record.Validate(); err != nil || len(existing) != 1 {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaConflict
	}
	stored := existing[0]
	indexGeneration, indexGenerationOK :=
		currentIndexMetaLogicalGeneration(stored.metadata)
	if indexGenerationOK && indexGeneration > int64(record.IndexGeneration) {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaSuperseded
	}
	executionGeneration, executionGenerationOK :=
		currentIndexMetaInt64(stored.metadata["execution_generation"])
	createdOn, createdOnOK :=
		currentIndexMetaFloat64(stored.metadata["created_on"])
	if stored.metadata["index_meta_id"] != record.MetaID ||
		stored.metadata["execution_id"] != record.ExecutionID ||
		!indexGenerationOK ||
		indexGeneration != int64(record.IndexGeneration) ||
		!executionGenerationOK ||
		executionGeneration != int64(record.Generation) ||
		!createdOnOK {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaConflict
	}
	if createdOn != record.CreatedOn {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaSuperseded
	}
	state, stateOK := stored.metadata["state"].(string)
	if !stateOK {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaConflict
	}
	if state == string(indexingapp.CurrentIndexMetaCancelled) {
		return currentIndexMetaWritePlan{},
			indexingapp.ErrCurrentIndexMetaSuperseded
	}
	switch taskID := stored.metadata["task_id"].(type) {
	case nil:
		metadata := cloneCurrentIndexMetaObject(stored.metadata)
		metadata["task_id"] = record.ExecutionID
		encoded, err := json.Marshal(metadata)
		if err != nil || len(encoded) == 0 ||
			len(encoded) > indexingapp.MaxCurrentInitialIndexMetaBytes {
			return currentIndexMetaWritePlan{},
				indexingapp.ErrCurrentIndexMetaConflict
		}
		return currentIndexMetaWritePlan{
			id:       stored.id,
			metadata: encoded,
		}, nil
	case string:
		if taskID == record.ExecutionID {
			return currentIndexMetaWritePlan{noop: true}, nil
		}
	}
	return currentIndexMetaWritePlan{},
		indexingapp.ErrCurrentIndexMetaConflict
}

func currentTerminalIndexMetaCompatible(
	metadata map[string]any,
	history []any,
	record indexingapp.CurrentTerminalIndexMeta,
) bool {
	if len(history) == 0 || metadata["state"] != string(record.State) {
		return false
	}
	last, ok := history[len(history)-1].(map[string]any)
	if !ok || last["state"] != string(record.State) {
		return false
	}
	if record.State == indexingapp.CurrentIndexMetaCancelled {
		return metadata["task_id"] == nil && last["task_id"] == nil
	}
	errorText, ok := metadata["error"].(string)
	if !ok || errorText == "" {
		return false
	}
	lastError, ok := last["error"].(string)
	return ok && lastError != ""
}

func currentIndexMetaUnixSeconds(value time.Time) json.Number {
	value = value.UTC()
	seconds := float64(value.Unix()) + float64(value.Nanosecond())/float64(time.Second)
	return json.Number(strconv.FormatFloat(seconds, 'f', -1, 64))
}

func currentIndexMetaCanStartNextGeneration(state string) bool {
	switch state {
	case "completed", "failed", "partly_indexed", "cancelled", "scheduled_reindex":
		return true
	default:
		return false
	}
}

type currentIndexMetaAdoptionFence struct {
	position            int
	indexGeneration     int64
	executionGeneration int64
	executionID         string
	metaID              string
	correlationID       string
	state               string
}

type currentIndexMetaAdoptionPhase uint8

const (
	currentIndexMetaAdoptionLegacy currentIndexMetaAdoptionPhase = iota
	currentIndexMetaAdoptionTyped
	currentIndexMetaAdoptionBaseline
)

type currentIndexMetaAdoptionIdentities struct {
	executionIDs   map[string]struct{}
	metaIDs        map[string]struct{}
	correlationIDs map[string]struct{}
}

type currentIndexMetaAdoptionBaselineEntry struct {
	configuration  map[string]any
	createdOn      float64
	updatedOn      float64
	taskID         string
	conversationID string
}

// currentIndexMetaAdoptionGeneration recovers the last complete Go fence only
// when an unchanged current-baseline writer replaced the top-level metadata.
// It deliberately does not repair partially present top-level fences.
func currentIndexMetaAdoptionGeneration(
	stored currentStoredIndexMeta,
	record indexingapp.CurrentInitialIndexMeta,
) (int64, bool) {
	if stored.id == "" || stored.document == nil ||
		*stored.document != record.Document ||
		!currentIndexMetaGoFenceFieldsAbsent(stored.metadata) ||
		!currentIndexMetaBaselineIdentityMatches(stored.metadata, record) {
		return 0, false
	}
	state, stateOK := stored.metadata["state"].(string)
	indexed, indexedOK := currentIndexMetaInt64(stored.metadata["indexed"])
	updated, updatedOK := currentIndexMetaInt64(stored.metadata["updated"])
	_, createdOnOK := currentIndexMetaFloat64(stored.metadata["created_on"])
	_, updatedOnOK := currentIndexMetaFloat64(stored.metadata["updated_on"])
	if !stateOK || !currentIndexMetaCanStartNextGeneration(state) ||
		!indexedOK || indexed < 0 || !updatedOK || updated < 0 ||
		!createdOnOK || !updatedOnOK {
		return 0, false
	}

	history, historyOK := decodeCurrentIndexMetaHistory(
		stored.metadata["history"],
	)
	if !historyOK || len(history) == 0 ||
		len(history) > maxCurrentIndexMetaAdoptionHistory {
		return 0, false
	}
	last, lastOK := history[len(history)-1].(map[string]any)
	top := cloneCurrentIndexMetaObject(stored.metadata)
	delete(top, "history")
	if !lastOK || !reflect.DeepEqual(last, top) {
		return 0, false
	}

	position := 0
	var createdMarker map[string]any
	first, firstOK := history[0].(map[string]any)
	if firstOK && first["state"] == "created" &&
		currentIndexMetaGoFenceFieldsAbsent(first) {
		if !currentIndexMetaAdoptionCreatedMarkerValid(first, record) {
			return 0, false
		}
		createdMarker = first
		position = 1
	}

	phase := currentIndexMetaAdoptionLegacy
	hadFencedHistory := false
	lastTypedGeneration := int64(0)
	var firstLifecycleEntry map[string]any
	currentFences := make([]currentIndexMetaAdoptionFence, 0, 2)
	baselineSuffix := make([]map[string]any, 0, 2)
	identities := currentIndexMetaAdoptionIdentities{
		executionIDs:   make(map[string]struct{}),
		metaIDs:        make(map[string]struct{}),
		correlationIDs: make(map[string]struct{}),
	}
	finishFences := func() bool {
		if len(currentFences) == 0 {
			return true
		}
		if !currentIndexMetaAdoptionFenceGroupIsTerminal(currentFences) ||
			!identities.claim(currentFences[0]) {
			return false
		}
		currentFences = currentFences[:0]
		return true
	}

	for ; position < len(history); position++ {
		raw := history[position]
		entry, ok := raw.(map[string]any)
		if !ok || !currentIndexMetaBaselineIdentityMatches(entry, record) {
			return 0, false
		}
		if firstLifecycleEntry == nil {
			firstLifecycleEntry = entry
		}
		if currentIndexMetaGoFenceFieldsAbsent(entry) {
			if !finishFences() {
				return 0, false
			}
			phase = currentIndexMetaAdoptionBaseline
			baselineSuffix = append(baselineSuffix, entry)
			continue
		}
		if phase == currentIndexMetaAdoptionBaseline {
			return 0, false
		}

		_, typed := entry["index_generation"]
		if !typed {
			if phase != currentIndexMetaAdoptionLegacy {
				return 0, false
			}
			fence, ok := currentIndexMetaLegacyAdoptionFence(
				entry,
				position,
			)
			if !ok {
				return 0, false
			}
			if len(currentFences) != 0 &&
				!currentIndexMetaAdoptionFenceIdentityEqual(
					currentFences[0],
					fence,
				) {
				if !finishFences() {
					return 0, false
				}
			}
			currentFences = append(currentFences, fence)
			hadFencedHistory = true
			continue
		}

		phase = currentIndexMetaAdoptionTyped
		fence, ok := currentIndexMetaAdoptionHistoryFence(
			entry,
			position,
		)
		if !ok {
			return 0, false
		}
		if fence.indexGeneration < lastTypedGeneration {
			return 0, false
		}
		if fence.indexGeneration > lastTypedGeneration {
			if !finishFences() {
				return 0, false
			}
			lastTypedGeneration = fence.indexGeneration
		} else if len(currentFences) != 0 &&
			!currentIndexMetaAdoptionFenceIdentityEqual(
				currentFences[0],
				fence,
			) {
			return 0, false
		}
		currentFences = append(currentFences, fence)
		hadFencedHistory = true
	}

	if !finishFences() ||
		!currentIndexMetaAdoptionBaselineSuffixValid(
			baselineSuffix,
			hadFencedHistory,
			createdMarker,
		) ||
		(createdMarker != nil &&
			!currentIndexMetaAdoptionMarkerMatchesFirstLifecycle(
				createdMarker,
				firstLifecycleEntry,
			)) {
		return 0, false
	}
	if lastTypedGeneration == 0 {
		// A source-shaped, pure current-baseline lifecycle can only establish
		// the first Go fence.
		return 0, !hadFencedHistory && record.IndexGeneration == 1
	}
	if !hadFencedHistory {
		return 0, false
	}
	return lastTypedGeneration, true
}

func currentIndexMetaGoFenceFieldsAbsent(metadata map[string]any) bool {
	for _, key := range []string{
		"execution_id",
		"execution_generation",
		"index_generation",
		"index_meta_id",
		"correlation_id",
	} {
		if _, present := metadata[key]; present {
			return false
		}
	}
	return true
}

func currentIndexMetaLegacyAdoptionFence(
	entry map[string]any,
	position int,
) (currentIndexMetaAdoptionFence, bool) {
	executionGeneration, executionGenerationOK :=
		currentIndexMetaInt64(entry["execution_generation"])
	executionID, executionIDOK := entry["execution_id"].(string)
	metaID, metaIDOK := entry["index_meta_id"].(string)
	correlationID, correlationIDOK := entry["correlation_id"].(string)
	state, stateOK := entry["state"].(string)
	if _, hasHistory := entry["history"]; hasHistory ||
		!executionGenerationOK || executionGeneration <= 0 ||
		!executionIDOK || executionID == "" ||
		!metaIDOK || metaID == "" ||
		!correlationIDOK || correlationID == "" ||
		!stateOK || (state != "in_progress" &&
		!currentIndexMetaCanStartNextGeneration(state)) {
		return currentIndexMetaAdoptionFence{}, false
	}
	return currentIndexMetaAdoptionFence{
		position:            position,
		executionGeneration: executionGeneration,
		executionID:         executionID,
		metaID:              metaID,
		correlationID:       correlationID,
		state:               state,
	}, true
}

func currentIndexMetaAdoptionCreatedMarkerValid(
	entry map[string]any,
	record indexingapp.CurrentInitialIndexMeta,
) bool {
	initial, err := decodeCurrentIndexMetaJSON(record.InitialMetadata)
	if err != nil {
		return false
	}
	canonical := currentCreatedIndexMetaMarker(initial)
	for _, historicalKey := range []string{
		"created_on",
		"updated_on",
		"index_configuration",
	} {
		value, present := entry[historicalKey]
		if !present {
			return false
		}
		canonical[historicalKey] = cloneCurrentIndexMetaValue(value)
	}
	// The current Python SDK marker has one additive field that the Go marker
	// does not author. Accept only its exact source value, not arbitrary marker
	// extensions.
	if errorValue, hasError := entry["error"]; hasError {
		if errorValue != nil {
			return false
		}
		canonical["error"] = nil
	}
	indexed, indexedOK := currentIndexMetaInt64(entry["indexed"])
	updated, updatedOK := currentIndexMetaInt64(entry["updated"])
	createdOn, createdOnOK := currentIndexMetaFloat64(entry["created_on"])
	updatedOn, updatedOnOK := currentIndexMetaFloat64(entry["updated_on"])
	_, configurationOK := currentIndexMetaAdoptionConfiguration(
		entry["index_configuration"],
	)
	_, configurationIsObject := entry["index_configuration"].(map[string]any)
	return currentIndexMetaBaselineIdentityMatches(entry, record) &&
		currentIndexMetaGoFenceFieldsAbsent(entry) &&
		reflect.DeepEqual(entry, canonical) &&
		entry["state"] == "created" &&
		indexedOK && indexed == 0 &&
		updatedOK && updated == 0 &&
		createdOnOK && createdOn > 0 &&
		updatedOnOK && createdOn == updatedOn &&
		configurationOK && configurationIsObject
}

func currentIndexMetaAdoptionBaselineEntryFields(
	entry map[string]any,
) (currentIndexMetaAdoptionBaselineEntry, bool) {
	indexed, indexedOK := currentIndexMetaInt64(entry["indexed"])
	updated, updatedOK := currentIndexMetaInt64(entry["updated"])
	createdOn, createdOnOK := currentIndexMetaFloat64(entry["created_on"])
	updatedOn, updatedOnOK := currentIndexMetaFloat64(entry["updated_on"])
	configuration, configurationOK := currentIndexMetaAdoptionConfiguration(
		entry["index_configuration"],
	)
	taskID, taskIDOK := currentIndexMetaAdoptionNullableString(
		entry,
		"task_id",
	)
	conversationID, conversationIDOK :=
		currentIndexMetaAdoptionNullableString(entry, "conversation_id")
	_, hasHistory := entry["history"]
	if !currentIndexMetaGoFenceFieldsAbsent(entry) ||
		!indexedOK || indexed < 0 ||
		!updatedOK || updated < 0 ||
		!createdOnOK || createdOn <= 0 ||
		!updatedOnOK || updatedOn < createdOn ||
		!configurationOK ||
		!taskIDOK || !conversationIDOK ||
		hasHistory {
		return currentIndexMetaAdoptionBaselineEntry{}, false
	}
	return currentIndexMetaAdoptionBaselineEntry{
		configuration:  configuration,
		createdOn:      createdOn,
		updatedOn:      updatedOn,
		taskID:         taskID,
		conversationID: conversationID,
	}, true
}

func currentIndexMetaAdoptionBaselineSuffixValid(
	suffix []map[string]any,
	hadFencedHistory bool,
	createdMarker map[string]any,
) bool {
	if hadFencedHistory {
		if len(suffix) != 2 || suffix[0]["state"] != "in_progress" ||
			!currentIndexMetaCanStartNextGeneration(
				currentIndexMetaString(suffix[1]["state"]),
			) {
			return false
		}
		active, activeOK :=
			currentIndexMetaAdoptionBaselineEntryFields(suffix[0])
		terminal, terminalOK :=
			currentIndexMetaAdoptionBaselineEntryFields(suffix[1])
		return activeOK && terminalOK &&
			active.createdOn == active.updatedOn &&
			terminal.createdOn >= active.createdOn &&
			terminal.updatedOn >= active.updatedOn &&
			reflect.DeepEqual(
				active.configuration,
				terminal.configuration,
			) &&
			(terminal.taskID == "" || terminal.taskID == active.taskID) &&
			(terminal.conversationID == "" ||
				terminal.conversationID == active.conversationID)
	}
	return len(suffix) == 1 &&
		currentIndexMetaAdoptionPureTerminalMatchesMarker(
			createdMarker,
			suffix[0],
		)
}

func currentIndexMetaAdoptionPureTerminalMatchesMarker(
	marker map[string]any,
	terminal map[string]any,
) bool {
	terminalFields, terminalOK :=
		currentIndexMetaAdoptionBaselineEntryFields(terminal)
	if marker == nil || !terminalOK ||
		!currentIndexMetaCanStartNextGeneration(
			currentIndexMetaString(terminal["state"]),
		) {
		return false
	}
	markerFields, markerOK :=
		currentIndexMetaAdoptionBaselineEntryFields(marker)
	return markerOK &&
		markerFields.createdOn == terminalFields.createdOn &&
		reflect.DeepEqual(
			markerFields.configuration,
			terminalFields.configuration,
		) &&
		terminalFields.taskID == "" &&
		terminalFields.conversationID == ""
}

func currentIndexMetaAdoptionMarkerMatchesFirstLifecycle(
	marker map[string]any,
	first map[string]any,
) bool {
	if marker == nil || first == nil {
		return false
	}
	markerCreatedOn, markerCreatedOnOK :=
		currentIndexMetaFloat64(marker["created_on"])
	firstCreatedOn, firstCreatedOnOK :=
		currentIndexMetaFloat64(first["created_on"])
	markerConfiguration, markerConfigurationOK :=
		currentIndexMetaAdoptionConfiguration(marker["index_configuration"])
	firstConfiguration, firstConfigurationOK :=
		currentIndexMetaAdoptionConfiguration(first["index_configuration"])
	return markerCreatedOnOK && firstCreatedOnOK &&
		markerCreatedOn == firstCreatedOn &&
		markerConfigurationOK && firstConfigurationOK &&
		reflect.DeepEqual(markerConfiguration, firstConfiguration)
}

func currentIndexMetaAdoptionConfiguration(
	value any,
) (map[string]any, bool) {
	switch value := value.(type) {
	case map[string]any:
		return cloneCurrentIndexMetaObject(value), true
	case string:
		if len(value) == 0 ||
			len(value) > indexingapp.MaxCurrentInitialIndexMetaBytes {
			return nil, false
		}
		configuration, err := decodeCurrentIndexMetaJSON([]byte(value))
		return configuration, err == nil
	default:
		return nil, false
	}
}

func currentIndexMetaAdoptionNullableString(
	entry map[string]any,
	key string,
) (string, bool) {
	value, present := entry[key]
	if !present {
		return "", false
	}
	if value == nil {
		return "", true
	}
	text, ok := value.(string)
	return text, ok && text != ""
}

func currentIndexMetaString(value any) string {
	text, _ := value.(string)
	return text
}

func currentIndexMetaAdoptionFenceIdentityEqual(
	first currentIndexMetaAdoptionFence,
	second currentIndexMetaAdoptionFence,
) bool {
	return first.executionGeneration == second.executionGeneration &&
		first.executionID == second.executionID &&
		first.metaID == second.metaID &&
		first.correlationID == second.correlationID
}

func (i currentIndexMetaAdoptionIdentities) claim(
	fence currentIndexMetaAdoptionFence,
) bool {
	if _, exists := i.executionIDs[fence.executionID]; exists {
		return false
	}
	if _, exists := i.metaIDs[fence.metaID]; exists {
		return false
	}
	if _, exists := i.correlationIDs[fence.correlationID]; exists {
		return false
	}
	i.executionIDs[fence.executionID] = struct{}{}
	i.metaIDs[fence.metaID] = struct{}{}
	i.correlationIDs[fence.correlationID] = struct{}{}
	return true
}

func currentIndexMetaBaselineIdentityMatches(
	metadata map[string]any,
	record indexingapp.CurrentInitialIndexMeta,
) bool {
	toolkitID, toolkitOK := currentIndexMetaInt64(metadata["toolkit_id"])
	return metadata["collection"] == record.IndexName &&
		metadata["type"] == "index_meta" &&
		toolkitOK && toolkitID == int64(record.ToolkitID)
}

func currentIndexMetaAdoptionHistoryFence(
	entry map[string]any,
	position int,
) (currentIndexMetaAdoptionFence, bool) {
	indexGeneration, indexGenerationOK :=
		currentIndexMetaInt64(entry["index_generation"])
	executionGeneration, executionGenerationOK :=
		currentIndexMetaInt64(entry["execution_generation"])
	executionID, executionIDOK := entry["execution_id"].(string)
	metaID, metaIDOK := entry["index_meta_id"].(string)
	correlationID, correlationIDOK := entry["correlation_id"].(string)
	state, stateOK := entry["state"].(string)
	stateValid := state == "in_progress" ||
		currentIndexMetaCanStartNextGeneration(state)
	if _, hasHistory := entry["history"]; hasHistory ||
		!indexGenerationOK || indexGeneration <= 0 ||
		!executionGenerationOK || executionGeneration <= 0 ||
		!executionIDOK || executionID == "" ||
		!metaIDOK || metaID == "" ||
		!correlationIDOK || correlationID == "" ||
		!stateOK || !stateValid {
		return currentIndexMetaAdoptionFence{}, false
	}
	return currentIndexMetaAdoptionFence{
		position:            position,
		indexGeneration:     indexGeneration,
		executionGeneration: executionGeneration,
		executionID:         executionID,
		metaID:              metaID,
		correlationID:       correlationID,
		state:               state,
	}, true
}

func currentIndexMetaAdoptionFenceGroupIsTerminal(
	fences []currentIndexMetaAdoptionFence,
) bool {
	switch len(fences) {
	case 1:
		return currentIndexMetaCanStartNextGeneration(fences[0].state)
	case 2:
		first, last := fences[0], fences[1]
		return first.position+1 == last.position &&
			first.state == "in_progress" &&
			currentIndexMetaCanStartNextGeneration(last.state) &&
			first.executionGeneration == last.executionGeneration &&
			first.executionID == last.executionID &&
			first.metaID == last.metaID &&
			first.correlationID == last.correlationID
	default:
		return false
	}
}

func currentInitialIndexMetaMatchesRecord(
	metadata map[string]any,
	record indexingapp.CurrentInitialIndexMeta,
) bool {
	generation, generationOK := currentIndexMetaInt64(metadata["execution_generation"])
	indexGeneration, indexGenerationOK := currentIndexMetaInt64(metadata["index_generation"])
	toolkitID, toolkitOK := currentIndexMetaInt64(metadata["toolkit_id"])
	indexed, indexedOK := currentIndexMetaInt64(metadata["indexed"])
	updated, updatedOK := currentIndexMetaInt64(metadata["updated"])
	_, hasHistory := metadata["history"]
	return !hasHistory &&
		metadata["collection"] == record.IndexName &&
		metadata["type"] == "index_meta" &&
		metadata["state"] == "in_progress" &&
		metadata["task_id"] == record.ExecutionID &&
		metadata["execution_id"] == record.ExecutionID &&
		metadata["index_meta_id"] == record.MetaID &&
		metadata["correlation_id"] == record.CorrelationID &&
		generationOK && generation == int64(record.Generation) &&
		indexGenerationOK && indexGeneration == int64(record.IndexGeneration) &&
		toolkitOK && toolkitID == int64(record.ToolkitID) &&
		indexedOK && indexed == 0 &&
		updatedOK && updated == 0 &&
		metadata["created_on"] != nil &&
		reflect.DeepEqual(metadata["created_on"], metadata["updated_on"])
}

func currentIndexMetaRetryMatches(stored, initial map[string]any) bool {
	if state, _ := stored["state"].(string); state != "in_progress" {
		return false
	}
	withoutHistory := cloneCurrentIndexMetaObject(stored)
	delete(withoutHistory, "history")
	if !reflect.DeepEqual(withoutHistory, initial) {
		return false
	}
	history, historyOK := decodeCurrentIndexMetaHistory(stored["history"])
	if !historyOK {
		return false
	}
	legacyRunEntry := -1
	for index, raw := range history {
		entry, ok := raw.(map[string]any)
		if !ok {
			return false
		}
		if !currentIndexMetaHistoryEntryClaimsInitialRun(entry, initial) {
			continue
		}
		if legacyRunEntry >= 0 ||
			index != len(history)-1 ||
			!reflect.DeepEqual(entry, initial) {
			return false
		}
		legacyRunEntry = index
	}
	return true
}

func currentCreatedIndexMetaMarker(initial map[string]any) map[string]any {
	marker := cloneCurrentIndexMetaObject(initial)
	marker["state"] = "created"
	marker["task_id"] = nil
	marker["conversation_id"] = nil
	for _, key := range []string{
		"execution_id",
		"execution_generation",
		"index_generation",
		"index_meta_id",
		"correlation_id",
	} {
		delete(marker, key)
	}
	return marker
}

func currentIndexMetaHistoryRunIndex(
	history []any,
	record indexingapp.CurrentTerminalIndexMeta,
) (int, error) {
	firstRunIndex := -1
	runIndex := -1
	runEntries := 0
	for index, raw := range history {
		entry, ok := raw.(map[string]any)
		if !ok {
			return -1, indexingapp.ErrCurrentIndexMetaConflict
		}
		if currentIndexMetaHistoryEntryMatchesRun(entry, record) {
			runEntries++
			if runEntries > 2 {
				return -1, indexingapp.ErrCurrentIndexMetaConflict
			}
			if firstRunIndex < 0 {
				firstRunIndex = index
			}
			runIndex = index
			continue
		}
		if currentIndexMetaHistoryEntryClaimsRun(entry, record) {
			return -1, indexingapp.ErrCurrentIndexMetaConflict
		}
	}
	if runEntries == 2 {
		bootstrap, ok := history[firstRunIndex].(map[string]any)
		if !ok || runIndex != firstRunIndex+1 ||
			!currentIndexMetaHistoryEntryIsLegacyBootstrap(bootstrap) {
			return -1, indexingapp.ErrCurrentIndexMetaConflict
		}
	}
	return runIndex, nil
}

func currentIndexMetaHistoryEntryIsLegacyBootstrap(
	entry map[string]any,
) bool {
	indexed, indexedOK := currentIndexMetaInt64(entry["indexed"])
	updated, updatedOK := currentIndexMetaInt64(entry["updated"])
	return entry["state"] == "in_progress" &&
		indexedOK && indexed == 0 &&
		updatedOK && updated == 0
}

func currentIndexMetaHistoryEntryMatchesRun(
	entry map[string]any,
	record indexingapp.CurrentTerminalIndexMeta,
) bool {
	indexGeneration, indexGenerationOK :=
		currentIndexMetaLogicalGeneration(entry)
	executionGeneration, executionGenerationOK :=
		currentIndexMetaInt64(entry["execution_generation"])
	return entry["index_meta_id"] == record.MetaID &&
		entry["execution_id"] == record.ExecutionID &&
		indexGenerationOK &&
		indexGeneration == int64(record.IndexGeneration) &&
		executionGenerationOK &&
		executionGeneration == int64(record.Generation)
}

func currentIndexMetaHistoryEntryClaimsRun(
	entry map[string]any,
	record indexingapp.CurrentTerminalIndexMeta,
) bool {
	if entry["index_meta_id"] == record.MetaID ||
		entry["execution_id"] == record.ExecutionID {
		return true
	}
	indexGeneration, indexGenerationOK :=
		currentIndexMetaLogicalGeneration(entry)
	return indexGenerationOK &&
		indexGeneration == int64(record.IndexGeneration)
}

func currentIndexMetaHistoryEntryClaimsInitialRun(
	entry map[string]any,
	initial map[string]any,
) bool {
	metaID, _ := initial["index_meta_id"].(string)
	executionID, _ := initial["execution_id"].(string)
	indexGeneration, indexGenerationOK :=
		currentIndexMetaLogicalGeneration(initial)
	if entry["index_meta_id"] == metaID ||
		entry["execution_id"] == executionID {
		return true
	}
	entryIndexGeneration, entryIndexGenerationOK :=
		currentIndexMetaLogicalGeneration(entry)
	return indexGenerationOK &&
		entryIndexGenerationOK &&
		entryIndexGeneration == indexGeneration
}

func currentIndexMetaHistoryHasUnfencedActiveRun(history []any) bool {
	if len(history) == 0 {
		return false
	}
	last, ok := history[len(history)-1].(map[string]any)
	return !ok || last["state"] == "in_progress"
}

// boundCurrentIndexMetaHistory keeps the newest history entries that satisfy
// the entry ceiling and the history byte budget. It discards the oldest
// entries first, because the run-history view reads the newest runs. It always
// keeps the newest entry, so the caller still records the run it writes now.
//
// It discards the oldest entries as one contiguous prefix, and it never keeps
// the "created" marker while it discards a later entry. The legacy adoption
// fence compares the marker with the first lifecycle entry, so a marker that
// outlived its own first run would fail that fence.
func boundCurrentIndexMetaHistory(history []any) ([]any, error) {
	if len(history) == 0 {
		return history, nil
	}
	if len(history) > indexingapp.MaxCurrentIndexMetaHistoryEntries {
		history = history[len(history)-indexingapp.MaxCurrentIndexMetaHistoryEntries:]
	}
	last := len(history) - 1
	// json.Marshal writes one byte for each bracket, and one byte for each
	// separator between two entries.
	total := len("[]")
	first := last
	for index := last; index >= 0; index-- {
		entry, err := json.Marshal(history[index])
		if err != nil {
			return nil, indexingapp.ErrCurrentIndexMetaConflict
		}
		next := total + len(entry)
		if index < last {
			next += len(",")
		}
		if index < last && next > maxCurrentIndexMetaHistoryBytes {
			break
		}
		total = next
		first = index
	}
	return history[first:], nil
}

func encodeCurrentIndexMetaWithHistory(initial map[string]any, history []any) ([]byte, error) {
	bounded, err := boundCurrentIndexMetaHistory(history)
	if err != nil {
		return nil, err
	}
	for {
		historyBytes, err := json.Marshal(bounded)
		if err != nil || len(historyBytes) == 0 ||
			len(historyBytes) > indexingapp.MaxCurrentInitialIndexMetaBytes {
			return nil, indexingapp.ErrCurrentIndexMetaConflict
		}
		metadata := cloneCurrentIndexMetaObject(initial)
		metadata["history"] = string(historyBytes)
		encoded, err := json.Marshal(metadata)
		if err != nil || len(encoded) == 0 {
			return nil, indexingapp.ErrCurrentIndexMetaConflict
		}
		if len(encoded) <= indexingapp.MaxCurrentInitialIndexMetaBytes {
			return encoded, nil
		}
		// The byte budget holds the history array under the cap. The top level
		// can still push the row over it. Discard one more entry and retry.
		if len(bounded) <= 1 {
			return nil, indexingapp.ErrCurrentIndexMetaConflict
		}
		bounded = bounded[1:]
	}
}

func currentIndexMetaHistory(value any) []any {
	history, ok := decodeCurrentIndexMetaHistory(value)
	if !ok {
		return []any{}
	}
	return history
}

func decodeCurrentIndexMetaHistory(value any) ([]any, bool) {
	switch value := value.(type) {
	case string:
		decoder := json.NewDecoder(bytes.NewBufferString(value))
		decoder.UseNumber()
		var history []any
		if err := decoder.Decode(&history); err != nil || history == nil {
			return nil, false
		}
		var trailing any
		if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
			return nil, false
		}
		return cloneCurrentIndexMetaValue(history).([]any), true
	case []any:
		return cloneCurrentIndexMetaValue(value).([]any), true
	default:
		return nil, false
	}
}

func decodeCurrentIndexMetaJSON(raw []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil || object == nil {
		return nil, indexingapp.ErrCurrentIndexMetaConflict
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, indexingapp.ErrCurrentIndexMetaConflict
	}
	return object, nil
}

func cloneCurrentIndexMetaObject(source map[string]any) map[string]any {
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = cloneCurrentIndexMetaValue(value)
	}
	return cloned
}

func cloneCurrentIndexMetaValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		return cloneCurrentIndexMetaObject(value)
	case []any:
		cloned := make([]any, len(value))
		for index := range value {
			cloned[index] = cloneCurrentIndexMetaValue(value[index])
		}
		return cloned
	default:
		return value
	}
}

func currentIndexMetaInt64(value any) (int64, bool) {
	switch value := value.(type) {
	case json.Number:
		parsed, err := strconv.ParseInt(string(value), 10, 64)
		return parsed, err == nil
	case int:
		return int64(value), true
	case int32:
		return int64(value), true
	case int64:
		return value, true
	default:
		return 0, false
	}
}

func currentIndexMetaFloat64(value any) (float64, bool) {
	var parsed float64
	var err error
	switch value := value.(type) {
	case json.Number:
		parsed, err = strconv.ParseFloat(string(value), 64)
	case float64:
		parsed = value
	default:
		return 0, false
	}
	return parsed, err == nil && !math.IsNaN(parsed) &&
		!math.IsInf(parsed, 0)
}

// currentIndexMetaLogicalGeneration uses the positive legacy execution
// generation only when the additive index_generation field is absent. A
// present but malformed field fails closed instead of weakening the fence.
func currentIndexMetaLogicalGeneration(metadata map[string]any) (int64, bool) {
	value, present := metadata["index_generation"]
	if present {
		generation, ok := currentIndexMetaInt64(value)
		return generation, ok && generation > 0
	}
	generation, ok := currentIndexMetaInt64(metadata["execution_generation"])
	return generation, ok && generation > 0
}

func currentIndexMetaWriteError(ctx context.Context, cause error) error {
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
	if errors.Is(cause, indexingapp.ErrCurrentIndexMetaConflict) {
		return indexingapp.ErrCurrentIndexMetaConflict
	}
	return ErrCurrentIndexMetaWrite
}

var _ indexingapp.CurrentIndexMetaWriter = (*CurrentIndexMetaWriter)(nil)
var _ indexingapp.CurrentIndexMetaTerminalWriter = (*CurrentIndexMetaWriter)(nil)
var _ indexingapp.CurrentManualStopCleanupWriter = (*CurrentIndexMetaWriter)(nil)
var _ indexingapp.CurrentIndexMetaTaskRestampWriter = (*CurrentIndexMetaWriter)(nil)
