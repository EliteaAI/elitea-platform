package pgvector

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
)

func TestCurrentIndexMetaRemoverGateIsCancellationAwareBeforeConnect(
	t *testing.T,
) {
	t.Parallel()
	remover := &CurrentIndexMetaRemover{
		queryTimeout: time.Second,
		gate:         make(chan struct{}, 1),
	}
	remover.gate <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := remover.Delete(
		ctx,
		indexmetaapp.ResolvedTarget{
			ConnectionString: "postgresql://must-not-connect.invalid/database",
			SchemaID:         1,
		},
		"meta-1",
	)
	if !errors.Is(err, context.Canceled) || len(remover.gate) != 1 {
		t.Fatalf("error=%v gate=%d", err, len(remover.gate))
	}
}

func TestCurrentIndexMetaRemoverRejectsInvalidTargetsWithoutLeakingDSN(
	t *testing.T,
) {
	t.Parallel()
	remover := NewCurrentIndexMetaRemover()
	_, err := remover.Delete(
		context.Background(),
		indexmetaapp.ResolvedTarget{
			ConnectionString: "https://not-postgres.invalid/secret-canary",
			SchemaID:         1,
		},
		"meta-1",
	)
	if !errors.Is(err, ErrCurrentIndexMetaDelete) ||
		strings.Contains(err.Error(), "secret-canary") {
		t.Fatalf("error=%v", err)
	}

	_, err = remover.Delete(
		context.Background(),
		indexmetaapp.ResolvedTarget{
			ConnectionString: "postgresql://project/vector",
			SchemaID:         0,
		},
		"meta-1",
	)
	if !errors.Is(err, ErrCurrentIndexMetaDelete) {
		t.Fatalf("invalid schema error=%v", err)
	}
}
