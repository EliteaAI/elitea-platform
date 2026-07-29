package indexing

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestStartRequestValidateAndClone(t *testing.T) {
	model := "gpt-test"
	request := StartRequest{
		ProjectID:            7,
		ActorUserID:          11,
		ToolkitID:            19,
		ToolParameters:       []byte(`{"index_name":"docs"}`),
		RequestedLLMModel:    &model,
		RequestedLLMSettings: []byte(`{"temperature":0.1}`),
		StreamID:             "stream-1",
		MessageID:            "message-1",
	}
	if err := request.Validate(); err != nil {
		t.Fatal(err)
	}

	clone := request.Clone()
	clone.ToolParameters[2] = 'X'
	clone.RequestedLLMSettings[2] = 'X'
	*clone.RequestedLLMModel = "changed"
	if bytes.Equal(clone.ToolParameters, request.ToolParameters) ||
		bytes.Equal(clone.RequestedLLMSettings, request.RequestedLLMSettings) ||
		*request.RequestedLLMModel != "gpt-test" {
		t.Fatal("clone retained caller-owned aliases")
	}
}

func TestStartRequestRejectsUnboundedOrNonObjectInputs(t *testing.T) {
	valid := StartRequest{
		ProjectID:            1,
		ActorUserID:          2,
		ToolkitID:            3,
		ToolParameters:       []byte(`{"index_name":"docs"}`),
		RequestedLLMSettings: []byte(`{}`),
	}
	tests := []StartRequest{
		func() StartRequest { value := valid; value.ProjectID = 0; return value }(),
		func() StartRequest { value := valid; value.ToolParameters = []byte(`{}`); return value }(),
		func() StartRequest { value := valid; value.ToolParameters = []byte(`[]`); return value }(),
		func() StartRequest { value := valid; value.RequestedLLMSettings = []byte(`null`); return value }(),
		func() StartRequest {
			value := valid
			value.ToolParameters = bytes.Repeat([]byte("x"), MaxToolParametersBytes+1)
			return value
		}(),
		func() StartRequest {
			value := valid
			value.StreamID = strings.Repeat("x", MaxClientCorrelationBytes+1)
			return value
		}(),
		func() StartRequest {
			value := valid
			value.ToolParameters = []byte(`{"index_name":"` + strings.Repeat("x", MaxCurrentIndexNameRunes+1) + `"}`)
			return value
		}(),
		func() StartRequest {
			value := valid
			value.ToolParameters = []byte(`{"index_name":"   "}`)
			return value
		}(),
	}
	for index, request := range tests {
		if err := request.Validate(); !errors.Is(err, ErrInvalidIndexStart) {
			t.Fatalf("case %d error = %v, want %v", index, err, ErrInvalidIndexStart)
		}
	}
}

func TestStartRequestAcceptsCurrentOneToThirtyTwoRuneIndexNames(t *testing.T) {
	valid := StartRequest{
		ProjectID:            1,
		ActorUserID:          2,
		ToolkitID:            3,
		RequestedLLMSettings: []byte(`{}`),
	}
	for _, name := range []string{"a", strings.Repeat("x", MaxCurrentIndexNameRunes), "індекс"} {
		request := valid
		request.ToolParameters = []byte(`{"index_name":"` + name + `"}`)
		if err := request.Validate(); err != nil {
			t.Fatalf("index name %q was rejected: %v", name, err)
		}
	}
}
