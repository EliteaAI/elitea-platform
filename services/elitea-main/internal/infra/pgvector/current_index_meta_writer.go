package pgvector

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
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
		metadata, err := encodeCurrentIndexMetaWithHistory(initial, []any{cloneCurrentIndexMetaValue(initial)})
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

	history := currentIndexMetaHistory(stored.metadata["history"])
	history = append(history, cloneCurrentIndexMetaValue(initial))
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
		history := currentIndexMetaHistory(stored.metadata["history"])
		if !currentTerminalIndexMetaCompatible(stored.metadata, history, record) {
			return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
		}
		if _, present := stored.metadata["index_generation"]; present {
			return currentIndexMetaWritePlan{noop: true}, nil
		}
		last, ok := history[len(history)-1].(map[string]any)
		if !ok {
			return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
		}
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

	history := currentIndexMetaHistory(stored.metadata["history"])
	if len(history) == 0 {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	active, ok := history[len(history)-1].(map[string]any)
	if !ok || active["state"] != state ||
		!reflect.DeepEqual(active["created_on"], terminal["created_on"]) {
		return currentIndexMetaWritePlan{}, indexingapp.ErrCurrentIndexMetaConflict
	}
	history[len(history)-1] = cloneCurrentIndexMetaValue(terminal)
	metadata, err := encodeCurrentIndexMetaWithHistory(terminal, history)
	if err != nil {
		return currentIndexMetaWritePlan{}, err
	}
	return currentIndexMetaWritePlan{id: stored.id, metadata: metadata}, nil
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
	history := currentIndexMetaHistory(stored["history"])
	if len(history) == 0 {
		return false
	}
	last, ok := history[len(history)-1].(map[string]any)
	return ok && reflect.DeepEqual(last, initial)
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
	switch value := value.(type) {
	case string:
		decoder := json.NewDecoder(bytes.NewBufferString(value))
		decoder.UseNumber()
		var history []any
		if err := decoder.Decode(&history); err != nil || history == nil {
			return []any{}
		}
		var trailing any
		if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
			return []any{}
		}
		return cloneCurrentIndexMetaValue(history).([]any)
	case []any:
		return cloneCurrentIndexMetaValue(value).([]any)
	default:
		return []any{}
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
