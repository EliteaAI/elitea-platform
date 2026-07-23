package runtimecomposition

import (
	"context"
	"encoding/json"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

type currentIndexContentMaterializerStub struct {
	authorization storage.ContentAuthorization
	source        []byte
	maxBytes      int64
	result        []byte
	calls         int
}

func (s *currentIndexContentMaterializerStub) MaterializeContent(
	_ context.Context,
	authorization storage.ContentAuthorization,
	source []byte,
	maxBytes int64,
) ([]byte, error) {
	s.calls++
	s.authorization = authorization
	s.source = append([]byte(nil), source...)
	s.maxBytes = maxBytes
	return append([]byte(nil), s.result...), nil
}

func TestCurrentFrozenToolkitConfigurationClaimerUsesGenericMaterializer(t *testing.T) {
	source := json.RawMessage(`{"id":19,"type":"github","settings":{}}`)
	result := json.RawMessage(`{"id":19,"type":"github","settings":{"pgvector_configuration":{"connection_string":"secret"}}}`)
	materializer := &currentIndexContentMaterializerStub{result: result}
	claimer, err := newCurrentFrozenToolkitConfigurationClaimer(materializer)
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := claimer.ClaimFrozenToolkitConfiguration(context.Background(), indexingapp.FrozenToolkitConfigurationClaim{
		ResourceProjectID:    7,
		ActorUserID:          13,
		ToolkitConfiguration: source,
	})
	if err != nil {
		t.Fatal(err)
	}
	if materializer.calls != 1 ||
		materializer.authorization.ResourceProjectID != "7" ||
		materializer.authorization.ActorID != "13" ||
		materializer.authorization.CapabilityID != "index.ingest.v1" ||
		materializer.authorization.SemanticRole != "index.toolkit_configuration" ||
		string(materializer.source) != string(source) ||
		materializer.maxBytes <= 0 ||
		string(claimed) != string(result) {
		t.Fatalf(
			"authorization=%+v source=%s max=%d claimed=%s calls=%d",
			materializer.authorization,
			materializer.source,
			materializer.maxBytes,
			claimed,
			materializer.calls,
		)
	}
	claimed[0] = '['
	if materializer.result[0] != '{' {
		t.Fatal("claimer returned an alias into the generic materializer")
	}
}
