package pgvector

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
	"github.com/jackc/pgx/v5"
)

// TestCurrentIndexMetaReaderRealPostgres crosses a direct pgx connection and a
// real PostgreSQL JSONB table. It does not exercise toolkit/configuration/vault
// resolution, HTTP authorization/routing, PgVector provisioning, or the UI.
func TestCurrentIndexMetaReaderRealPostgres(t *testing.T) {
	databaseURL := os.Getenv("ELITEA_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set ELITEA_TEST_DATABASE_URL to run the external index-meta reader test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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

	schemaID := int32(1_500_000_000 + time.Now().UnixNano()%500_000_000)
	schema := pgx.Identifier{strconv.FormatInt(int64(schemaID), 10)}.Sanitize()
	if _, err := connection.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = connection.Exec(cleanupContext, "DROP SCHEMA "+schema+" CASCADE")
	})
	if _, err := connection.Exec(ctx, `CREATE TABLE `+schema+`.langchain_pg_embedding (
id text PRIMARY KEY,
cmetadata jsonb
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := connection.Exec(ctx, `INSERT INTO `+schema+`.langchain_pg_embedding (id, cmetadata) VALUES
('older', '{"type":"index_meta","updated_on":10,"state":"completed"}'::jsonb),
('newer', '{"type":"index_meta","updated_on":20,"state":"in_progress"}'::jsonb),
('document', '{"type":"document","updated_on":30}'::jsonb)`); err != nil {
		t.Fatal(err)
	}

	reader := NewCurrentIndexMetaReader()
	records, err := reader.List(ctx, indexmetaapp.ResolvedTarget{
		ConnectionString: databaseURL,
		SchemaID:         schemaID,
		MaxRows:          10,
		MaxMetadataBytes: indexmetaapp.MaxCurrentIndexMetaMetadataBytes,
		MaxTotalBytes:    indexmetaapp.MaxCurrentIndexMetaTotalBytes,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(records) != 2 || records[0].ID != "newer" || records[1].ID != "older" {
		t.Fatalf("List() records = %+v", records)
	}
	var metadata map[string]any
	if err := json.Unmarshal(records[0].Metadata, &metadata); err != nil || metadata["type"] != "index_meta" {
		t.Fatalf("first metadata = %s, %v", records[0].Metadata, err)
	}

	missingSchemaID := schemaID - 1
	records, err = reader.List(ctx, indexmetaapp.ResolvedTarget{
		ConnectionString: databaseURL,
		SchemaID:         missingSchemaID,
		MaxRows:          10,
		MaxMetadataBytes: indexmetaapp.MaxCurrentIndexMetaMetadataBytes,
		MaxTotalBytes:    indexmetaapp.MaxCurrentIndexMetaTotalBytes,
	})
	if err != nil || len(records) != 0 {
		t.Fatalf("missing table List() = %+v, %v", records, err)
	}

	if strings.Contains(fmt.Sprint(records), config.Password) && config.Password != "" {
		t.Fatal("reader result exposed the connection password")
	}
}
