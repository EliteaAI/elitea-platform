package contract_test

import (
	"encoding/hex"
	"testing"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// This fixture is produced by the checked Python protobuf binding in
// services/elitea-worker-python/tests/integration/test_index_search_protocol_contract.py.
// It proves wire compatibility only; it does not claim a mounted worker path.
func TestIndexSearchCommandPythonWireFixture(t *testing.T) {
	encoded, err := hex.DecodeString("08011207746f6f6c6b69741a06706172616d7322096c6c6d2d6d6f64656c2a0a6c6c6d2d636f6e666967320a6d63702d746f6b656e73")
	if err != nil {
		t.Fatal(err)
	}
	command := &runtimev1.IndexSearchCommandV1{}
	if err := proto.Unmarshal(encoded, command); err != nil {
		t.Fatal(err)
	}
	if command.GetOperation() != runtimev1.IndexSearchOperationV1_INDEX_SEARCH_OPERATION_V1_SEARCH_INDEX || command.GetToolkitConfigurationEntryId() != "toolkit" || command.GetToolParametersEntryId() != "params" || command.GetLlmModelEntryId() != "llm-model" || command.GetLlmConfigurationEntryId() != "llm-config" || command.GetMcpTokensEntryId() != "mcp-tokens" {
		t.Fatalf("unexpected Python command fixture: %+v", command)
	}
}
