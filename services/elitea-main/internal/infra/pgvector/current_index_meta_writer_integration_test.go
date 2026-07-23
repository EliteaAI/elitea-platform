package pgvector

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/jackc/pgx/v5"
)

// TestCurrentIndexMetaWriterRealPgvector crosses the production pgx adapter,
// PostgreSQL DDL/JSONB transactions, the vector type, history compatibility,
// idempotent recovery, and the same-index conflict guard. It does not exercise
// the runtime admission database, Configurations/vault lookup, Redis, or a
// worker.
func TestCurrentIndexMetaWriterRealPgvector(t *testing.T) {
	databaseURL := os.Getenv("ELITEA_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set ELITEA_TEST_DATABASE_URL to run the current index-meta writer test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	normalized, ok := normalizeCurrentPgvectorDSN(databaseURL)
	if !ok {
		t.Fatal("ELITEA_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	config, err := pgx.ParseConfig(normalized)
	if err != nil {
		t.Fatal("ELITEA_TEST_DATABASE_URL is invalid")
	}
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("connect to ELITEA_TEST_DATABASE_URL")
	}
	t.Cleanup(func() { _ = connection.Close(context.Background()) })

	var vectorAvailable bool
	if err := connection.QueryRow(ctx, `SELECT EXISTS (
SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'vector'
)`).Scan(&vectorAvailable); err != nil {
		t.Fatal(err)
	}
	if !vectorAvailable {
		t.Skip("the ELITEA_TEST_DATABASE_URL server does not provide the vector extension")
	}
	if _, err := connection.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS vector`); err != nil {
		t.Skipf("ELITEA_TEST_DATABASE_URL cannot install the vector extension: %v", err)
	}

	schemaID := int32(1_500_000_000 + time.Now().UnixNano()%500_000_000)
	schema := pgx.Identifier{strconv.FormatInt(int64(schemaID), 10)}.Sanitize()
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = connection.Exec(cleanupContext, "DROP SCHEMA "+schema+" CASCADE")
	})
	target := indexingapp.CurrentIndexMetaTarget{
		ConnectionString: databaseURL,
		SchemaID:         schemaID,
	}
	first := currentIndexMetaIntegrationRecord(t, schemaID, "meta-1", "execution-1", "message-1")
	writer := NewCurrentIndexMetaWriter()
	if err := writer.MaterializeInitial(ctx, target, first); err != nil {
		t.Fatalf("create metadata: %v", err)
	}
	assertCurrentIndexMetaIntegrationRow(t, ctx, connection, schema, "meta-1", "meta-1", "execution-1", 1)

	// Simulate a process crash after the external commit but before the runtime
	// database gate transition. The exact retry must not append history.
	if err := writer.MaterializeInitial(ctx, target, first); err != nil {
		t.Fatalf("recover committed metadata: %v", err)
	}
	assertCurrentIndexMetaIntegrationRow(t, ctx, connection, schema, "meta-1", "meta-1", "execution-1", 1)

	conflicting := currentIndexMetaIntegrationRecord(t, schemaID, "meta-2", "execution-2", "message-2")
	if err := writer.MaterializeInitial(ctx, target, conflicting); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("active same-index conflict=%v", err)
	}
	assertCurrentIndexMetaIntegrationRow(t, ctx, connection, schema, "meta-1", "meta-1", "execution-1", 1)

	if _, err := connection.Exec(ctx, `
UPDATE `+schema+`.langchain_pg_embedding
SET cmetadata = jsonb_set(cmetadata, '{state}', '"completed"'::jsonb)
WHERE id = 'meta-1'`); err != nil {
		t.Fatal(err)
	}
	if err := writer.MaterializeInitial(ctx, target, conflicting); err != nil {
		t.Fatalf("start reindex generation: %v", err)
	}
	assertCurrentIndexMetaIntegrationRow(t, ctx, connection, schema, "meta-1", "meta-2", "execution-2", 2)
}

func currentIndexMetaIntegrationRecord(
	t *testing.T,
	toolkitID int32,
	metaID string,
	executionID string,
	correlationID string,
) indexingapp.CurrentInitialIndexMeta {
	t.Helper()
	metadata, err := json.Marshal(map[string]any{
		"collection":           "Docs",
		"type":                 "index_meta",
		"indexed":              0,
		"updated":              0,
		"state":                "in_progress",
		"index_configuration":  map[string]any{"index_name": "Docs"},
		"created_on":           1_700_000_000.25,
		"updated_on":           1_700_000_000.25,
		"task_id":              executionID,
		"conversation_id":      nil,
		"toolkit_id":           toolkitID,
		"execution_id":         executionID,
		"execution_generation": 1,
		"index_meta_id":        metaID,
		"correlation_id":       correlationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return indexingapp.CurrentInitialIndexMeta{
		MetaID:          metaID,
		ExecutionID:     executionID,
		CorrelationID:   correlationID,
		Generation:      1,
		IndexName:       "Docs",
		ToolkitID:       toolkitID,
		Document:        "index_meta_Docs",
		InitialMetadata: metadata,
	}
}

func assertCurrentIndexMetaIntegrationRow(
	t *testing.T,
	ctx context.Context,
	connection *pgx.Conn,
	schema string,
	physicalID string,
	metaID string,
	executionID string,
	historyLength int,
) {
	t.Helper()
	var storedID, document string
	var raw []byte
	if err := connection.QueryRow(ctx, `
SELECT id, document, cmetadata
FROM `+schema+`.langchain_pg_embedding
WHERE cmetadata @> '{"type":"index_meta","collection":"Docs"}'::jsonb`,
	).Scan(&storedID, &document, &raw); err != nil {
		t.Fatal(err)
	}
	metadata := mustDecodeCurrentIndexMeta(t, raw)
	history, ok := metadata["history"].(string)
	if !ok {
		t.Fatalf("history type=%T", metadata["history"])
	}
	if storedID != physicalID || document != "index_meta_Docs" ||
		metadata["index_meta_id"] != metaID ||
		metadata["execution_id"] != executionID ||
		metadata["state"] != "in_progress" ||
		len(currentIndexMetaHistory(history)) != historyLength {
		t.Fatalf("id=%q document=%q metadata=%#v", storedID, document, metadata)
	}
}
