package pgvector

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
	"github.com/jackc/pgx/v5"
)

func TestCurrentIndexMetaRemoverRealPgvectorParity(t *testing.T) {
	databaseURL := os.Getenv("ELITEA_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set ELITEA_TEST_DATABASE_URL to run the current index metadata delete test")
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

	schemaID := int32(1_000_000_000 + time.Now().UnixNano()%500_000_000)
	schema := pgx.Identifier{
		strconv.FormatInt(int64(schemaID), 10),
	}.Sanitize()
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(
			context.Background(),
			10*time.Second,
		)
		defer cleanupCancel()
		_, _ = connection.Exec(
			cleanupContext,
			"DROP SCHEMA "+schema+" CASCADE",
		)
	})
	if _, err := connection.Exec(ctx, `
CREATE SCHEMA `+schema+`;
CREATE TABLE `+schema+`.langchain_pg_embedding (
    id TEXT PRIMARY KEY,
    document TEXT,
    cmetadata JSONB
);
INSERT INTO `+schema+`.langchain_pg_embedding (id, document, cmetadata)
VALUES
    ('malicious-chunk', 'chunk',
     '{"type":"document","collection":"Docs"}'::jsonb),
    ('docs-meta', 'index_meta_Docs',
     '{"type":"index_meta","collection":"Docs"}'::jsonb),
    ('docs-chunk', 'chunk',
     '{"type":"document","collection":"Docs"}'::jsonb),
    ('other-meta', 'index_meta_Other',
     '{"type":"index_meta","collection":"Other"}'::jsonb),
    ('other-chunk', 'chunk',
     '{"type":"document","collection":"Other"}'::jsonb)`); err != nil {
		t.Fatal(err)
	}

	target := indexmetaapp.ResolvedTarget{
		ConnectionString: databaseURL,
		SchemaID:         schemaID,
	}
	remover := NewCurrentIndexMetaRemover()

	// Approved security correction: an arbitrary document row ID cannot select
	// and delete its whole collection.
	if _, err := remover.Delete(
		ctx,
		target,
		"malicious-chunk",
	); !errors.Is(err, indexmetaapp.ErrCurrentIndexMetaNotFound) {
		t.Fatalf("malicious row error=%v", err)
	}
	assertCurrentIndexCollectionRows(
		t,
		ctx,
		connection,
		schema,
		"Docs",
		3,
	)

	indexName, err := remover.Delete(ctx, target, "docs-meta")
	if err != nil || indexName != "Docs" {
		t.Fatalf("delete index=%q err=%v", indexName, err)
	}
	assertCurrentIndexCollectionRows(
		t,
		ctx,
		connection,
		schema,
		"Docs",
		0,
	)
	assertCurrentIndexCollectionRows(
		t,
		ctx,
		connection,
		schema,
		"Other",
		2,
	)

	if _, err := remover.Delete(
		ctx,
		target,
		"docs-meta",
	); !errors.Is(err, indexmetaapp.ErrCurrentIndexMetaNotFound) {
		t.Fatalf("second delete error=%v", err)
	}

	missingTarget := target
	missingTarget.SchemaID--
	if _, err := remover.Delete(
		ctx,
		missingTarget,
		"docs-meta",
	); !errors.Is(err, ErrCurrentIndexMetaDelete) {
		t.Fatalf("missing table error=%v", err)
	}
}

func assertCurrentIndexCollectionRows(
	t *testing.T,
	ctx context.Context,
	connection *pgx.Conn,
	schema, collection string,
	want int,
) {
	t.Helper()
	var count int
	if err := connection.QueryRow(ctx, `
SELECT count(*)
FROM `+schema+`.langchain_pg_embedding
WHERE cmetadata->>'collection' = $1`,
		collection,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("collection %q rows=%d want=%d", collection, count, want)
	}
}
