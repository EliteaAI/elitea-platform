package pgvector

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
)

func TestNormalizeCurrentPgvectorDSN(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		value string
		want  string
		ok    bool
	}{
		{name: "SQLAlchemy psycopg", value: "postgresql+psycopg://user:password@host/database", want: "postgresql://user:password@host/database", ok: true},
		{name: "PostgreSQL", value: "postgresql://host/database", want: "postgresql://host/database", ok: true},
		{name: "Postgres", value: "postgres://host/database", want: "postgres://host/database", ok: true},
		{name: "reject HTTP", value: "https://host/database"},
		{name: "reject newline", value: "postgresql://host/data\nbase"},
		{name: "reject oversized", value: "postgresql://" + strings.Repeat("x", indexmetaapp.MaxCurrentPgvectorDSNBytes)},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, ok := normalizeCurrentPgvectorDSN(test.value)
			if got != test.want || ok != test.ok {
				t.Fatalf("normalizeCurrentPgvectorDSN() = %q, %t", got, ok)
			}
		})
	}
}

func TestCurrentIndexMetaReaderGateIsCancellationAwareBeforeConnect(t *testing.T) {
	t.Parallel()

	reader := &CurrentIndexMetaReader{
		queryTimeout: time.Second,
		gate:         make(chan struct{}, 1),
	}
	reader.gate <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := reader.List(ctx, indexmetaapp.ResolvedTarget{
		ConnectionString: "postgresql://must-not-connect.invalid/database",
		SchemaID:         1,
		MaxRows:          indexmetaapp.MaxCurrentIndexMetaRows,
		MaxMetadataBytes: indexmetaapp.MaxCurrentIndexMetaMetadataBytes,
		MaxTotalBytes:    indexmetaapp.MaxCurrentIndexMetaTotalBytes,
	})
	if !errors.Is(err, context.Canceled) || len(reader.gate) != 1 {
		t.Fatalf("List() error=%v gate=%d", err, len(reader.gate))
	}
}

func TestCurrentIndexMetaReaderRejectsCallerControlledTargetsBeforeConnect(t *testing.T) {
	t.Parallel()

	reader := NewCurrentIndexMetaReader()
	valid := indexmetaapp.ResolvedTarget{
		ConnectionString: "https://not-postgres.invalid/secret-canary",
		SchemaID:         1,
		MaxRows:          indexmetaapp.MaxCurrentIndexMetaRows,
		MaxMetadataBytes: indexmetaapp.MaxCurrentIndexMetaMetadataBytes,
		MaxTotalBytes:    indexmetaapp.MaxCurrentIndexMetaTotalBytes,
	}
	_, err := reader.List(context.Background(), valid)
	if !errors.Is(err, ErrCurrentIndexMetaRead) || strings.Contains(err.Error(), "secret-canary") {
		t.Fatalf("List() error = %v", err)
	}

	valid.ConnectionString = "postgresql://localhost/database"
	valid.SchemaID = 0
	_, err = reader.List(context.Background(), valid)
	if !errors.Is(err, ErrCurrentIndexMetaRead) {
		t.Fatalf("invalid schema error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	valid.SchemaID = 1
	_, err = reader.List(ctx, valid)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled error = %v", err)
	}
}
