package runtimecomposition

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

type frozenToolkitClaimerStub struct {
	content json.RawMessage
	err     error
}

func (s frozenToolkitClaimerStub) ClaimFrozenToolkitConfiguration(
	context.Context,
	indexingapp.FrozenToolkitConfigurationClaim,
) (json.RawMessage, error) {
	return append(json.RawMessage(nil), s.content...), s.err
}

func TestDurableIndexMetaFrozenToolkitClaimerClassifiesRejectedContent(
	t *testing.T,
) {
	claim := indexingapp.FrozenToolkitConfigurationClaim{
		ResourceProjectID:    1,
		ActorUserID:          2,
		ToolkitConfiguration: json.RawMessage(`{"id":3}`),
	}
	for _, test := range []struct {
		name string
		err  error
		want error
	}{
		{
			name: "rejected is permanent",
			err:  storage.ErrContentRejected,
			want: indexingapp.ErrCurrentIndexMetaInitializationInvalid,
		},
		{
			name: "unavailable remains retryable",
			err:  storage.ErrContentUnavailable,
			want: storage.ErrContentUnavailable,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			adapter := durableIndexMetaFrozenToolkitClaimer{
				delegate: frozenToolkitClaimerStub{err: test.err},
			}
			if _, err := adapter.ClaimFrozenToolkitConfiguration(
				context.Background(),
				claim,
			); !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
}
