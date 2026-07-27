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
	"github.com/jackc/pgx/v5"
)

const (
	defaultCurrentIndexMetaWriteTimeout = 30 * time.Second
	defaultCurrentIndexMetaWrites       = 16
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
FOR UPDATE`, indexName, indexingapp.MaxCurrentInitialIndexMetaBytes)
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
		if stored.id == "" || storedBytes <= 0 ||
			int(storedBytes) > indexingapp.MaxCurrentInitialIndexMetaBytes || len(raw) == 0 {
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
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
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

func encodeCurrentIndexMetaWithHistory(initial map[string]any, history []any) ([]byte, error) {
	historyBytes, err := json.Marshal(history)
	if err != nil || len(historyBytes) == 0 || len(historyBytes) > indexingapp.MaxCurrentInitialIndexMetaBytes {
		return nil, indexingapp.ErrCurrentIndexMetaConflict
	}
	metadata := cloneCurrentIndexMetaObject(initial)
	metadata["history"] = string(historyBytes)
	encoded, err := json.Marshal(metadata)
	if err != nil || len(encoded) == 0 || len(encoded) > indexingapp.MaxCurrentInitialIndexMetaBytes {
		return nil, indexingapp.ErrCurrentIndexMetaConflict
	}
	return encoded, nil
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
