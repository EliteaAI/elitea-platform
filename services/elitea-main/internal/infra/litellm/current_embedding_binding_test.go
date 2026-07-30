package litellm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestCurrentEmbeddingRuntimeGroupUsesOnlyBoundedGroupExistenceLookup(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if calls.Add(1) != 1 {
			t.Errorf("unexpected request %s", request.URL.String())
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		if request.URL.Path != "/model_group/info" ||
			request.URL.Query().Get("model_group") != "7_text-embedding-3-small" {
			t.Errorf("group request=%s", request.URL.String())
		}
		_, _ = io.WriteString(writer, `{"data":[{"model_group":"7_text-embedding-3-small","providers":["openai"]}]}`)
	}))
	defer server.Close()

	client := newTestClient(
		t,
		server.URL,
		&testMasterKeyProvider{key: "master-key"},
		server.Client(),
		ClientConfig{},
	)
	group, found, err := client.GetCurrentEmbeddingRuntimeGroup(
		context.Background(),
		"7_text-embedding-3-small",
	)
	if err != nil || !found {
		t.Fatalf("group=%#v found=%t err=%v", group, found, err)
	}
	if group.Name != "7_text-embedding-3-small" {
		t.Fatalf("group=%#v", group)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls=%d", calls.Load())
	}
}

func TestCurrentEmbeddingRuntimeGroupReturnsMissingWithoutDeploymentScan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `{"data":[]}`)
	}))
	defer server.Close()
	client := newTestClient(t, server.URL, &testMasterKeyProvider{key: "master-key"}, server.Client(), ClientConfig{})

	if group, found, err := client.GetCurrentEmbeddingRuntimeGroup(
		context.Background(),
		"7_embedding",
	); err != nil || found || group.Name != "" {
		t.Fatalf("group=%#v found=%t error=%v", group, found, err)
	}
}
