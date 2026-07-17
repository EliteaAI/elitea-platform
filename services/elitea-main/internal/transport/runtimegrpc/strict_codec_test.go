package runtimegrpc

import (
	"errors"
	"testing"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

func TestStrictProtoCodecRejectsDuplicateUnknownAndConflictingOneofBeforeDecode(t *testing.T) {
	codec, err := NewStrictProtoCodec(64 * 1024)
	if err != nil {
		t.Fatal(err)
	}
	frame := &runtimev1.ExecutionOutputFrameV1{
		OutputSchemaRevision: "elitea.runtime.execution-output.v1",
		StreamId:             "execution-1:1",
		Identity: &runtimev1.ExecutionIdentityV1{
			TenantId: "tenant-1", ExecutionId: "execution-1", Generation: 1,
		},
		Payload: &runtimev1.ExecutionOutputFrameV1_ConfigurationValidation{
			ConfigurationValidation: &runtimev1.ConfigurationValidationResultV1{ConfigurationRevisionId: "revision-1"},
		},
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		mutate func([]byte) []byte
	}{
		{name: "duplicate singular", mutate: func(encoded []byte) []byte {
			encoded = protowire.AppendTag(encoded, 2, protowire.BytesType)
			return protowire.AppendString(encoded, "execution-2:1")
		}},
		{name: "unknown reserved", mutate: func(encoded []byte) []byte {
			encoded = protowire.AppendTag(encoded, 31, protowire.VarintType)
			return protowire.AppendVarint(encoded, 1)
		}},
		{name: "conflicting payload oneof", mutate: func(encoded []byte) []byte {
			failure, marshalErr := proto.Marshal(&runtimev1.RuntimeErrorV1{
				Code: runtimev1.RuntimeErrorCodeV1_RUNTIME_ERROR_CODE_V1_INTERNAL,
			})
			if marshalErr != nil {
				t.Fatal(marshalErr)
			}
			encoded = protowire.AppendTag(encoded, 21, protowire.BytesType)
			return protowire.AppendBytes(encoded, failure)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var target runtimev1.ExecutionOutputFrameV1
			if err := codec.Unmarshal(test.mutate(append([]byte(nil), raw...)), &target); !errors.Is(err, ErrStrictProto) {
				t.Fatalf("strict wire mutation was decoded: %v", err)
			}
		})
	}
}

func TestStrictProtoCodecEnforcesListenerBoundBeforeDecode(t *testing.T) {
	codec, err := NewStrictProtoCodec(8)
	if err != nil {
		t.Fatal(err)
	}
	var target runtimev1.ExecutionOutputFrameV1
	if err := codec.Unmarshal(make([]byte, 9), &target); !errors.Is(err, ErrStrictProto) {
		t.Fatalf("oversize protobuf reached decode: %v", err)
	}
}
