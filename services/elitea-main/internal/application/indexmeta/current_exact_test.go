package indexmeta

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

type currentExactReaderStub struct {
	target     ResolvedTarget
	collection string
	record     RawRecord
	found      bool
	err        error
}

func (stub *currentExactReaderStub) FindExact(
	_ context.Context,
	target ResolvedTarget,
	collection string,
) (RawRecord, bool, error) {
	stub.target = target
	stub.collection = collection
	return stub.record, stub.found, stub.err
}

func TestExactServiceResolvesBoundedTargetAndNormalizesConfiguration(t *testing.T) {
	t.Parallel()

	toolkits := &currentToolkitStub{
		found: true,
		toolkit: indexingapp.CurrentToolkitSnapshot{
			ID: 42, Type: "github",
			Settings: map[string]any{
				"pgvector_configuration": map[string]any{
					"elitea_title": "project-vectorstore",
					"private":      false,
				},
				"github_configuration": map[string]any{
					"elitea_title": "must-not-expand",
				},
			},
		},
	}
	settings := &currentSettingsStub{result: map[string]any{
		"pgvector_configuration": map[string]any{
			"connection_string": "postgresql://secret-canary@pg/project",
		},
	}}
	reader := &currentExactReaderStub{
		found: true,
		record: RawRecord{
			ID: "meta-1",
			Metadata: json.RawMessage(
				`{"type":"index_meta","collection":"docs","state":"completed","index_configuration":"{\"index_name\":\"docs\"}"}`,
			),
		},
	}
	service, err := NewExactService(toolkits, settings, reader)
	if err != nil {
		t.Fatal(err)
	}

	item, found, err := service.Find(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
		"docs",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !found || item.ID != "meta-1" ||
		reader.collection != "docs" ||
		reader.target.SchemaID != 42 ||
		reader.target.MaxRows != 2 {
		t.Fatalf(
			"item=%+v found=%v collection=%q target=%+v",
			item,
			found,
			reader.collection,
			reader.target,
		)
	}
	configuration, ok := item.Metadata["index_configuration"].(map[string]any)
	if !ok || configuration["index_name"] != "docs" {
		t.Fatalf("configuration=%#v", item.Metadata["index_configuration"])
	}
	if len(settings.request.Settings) != 1 ||
		settings.request.Settings["pgvector_configuration"] == nil {
		t.Fatalf("expanded unrelated settings: %#v", settings.request.Settings)
	}
}

func TestExactServiceUsesProvidedToolkitSnapshotWithoutReload(t *testing.T) {
	t.Parallel()

	toolkits := &currentToolkitStub{}
	settings := &currentSettingsStub{result: map[string]any{
		"pgvector_configuration": map[string]any{
			"connection_string": "postgresql://pg/snapshot",
		},
	}}
	reader := &currentExactReaderStub{
		found: true,
		record: RawRecord{
			ID:       "meta",
			Metadata: json.RawMessage(`{"collection":"docs","state":"completed"}`),
		},
	}
	service, err := NewExactService(toolkits, settings, reader)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := indexingapp.CurrentToolkitSnapshot{
		ID: 42, Type: "github",
		Settings: map[string]any{
			"pgvector_configuration": map[string]any{
				"elitea_title": "snapshot-vectorstore",
				"private":      false,
			},
		},
	}

	_, found, err := service.FindSnapshot(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
		"docs",
		snapshot,
	)
	if err != nil || !found {
		t.Fatalf("found=%v error=%v", found, err)
	}
	if toolkits.projectID != 0 || toolkits.userID != 0 ||
		toolkits.toolkitID != 0 {
		t.Fatalf(
			"toolkit was unexpectedly reloaded: project=%d user=%d toolkit=%d",
			toolkits.projectID,
			toolkits.userID,
			toolkits.toolkitID,
		)
	}
	if settings.request.Settings["pgvector_configuration"] == nil ||
		reader.target.ConnectionString != "postgresql://pg/snapshot" {
		t.Fatalf(
			"settings=%#v target=%+v",
			settings.request.Settings,
			reader.target,
		)
	}
}

func TestExactServiceFailsClosedOnMismatchedOrUnavailableRecord(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		record  RawRecord
		found   bool
		readErr error
		want    error
	}{
		{name: "missing"},
		{
			name:  "mismatched collection",
			found: true,
			record: RawRecord{
				ID:       "meta",
				Metadata: json.RawMessage(`{"collection":"other"}`),
			},
			want: ErrCurrentIndexMetaInvalid,
		},
		{
			name:    "reader unavailable",
			readErr: errors.New("DSN secret canary"),
			want:    ErrCurrentIndexMetaUnavailable,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			toolkits := &currentToolkitStub{
				found: true,
				toolkit: indexingapp.CurrentToolkitSnapshot{
					ID: 42, Type: "github",
					Settings: map[string]any{
						"pgvector_configuration": map[string]any{
							"elitea_title": "vectorstore",
						},
					},
				},
			}
			settings := &currentSettingsStub{result: map[string]any{
				"pgvector_configuration": map[string]any{
					"connection_string": "postgresql://pg/project",
				},
			}}
			reader := &currentExactReaderStub{
				record: test.record,
				found:  test.found,
				err:    test.readErr,
			}
			service, err := NewExactService(toolkits, settings, reader)
			if err != nil {
				t.Fatal(err)
			}

			_, found, err := service.Find(
				context.Background(),
				Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
				"docs",
			)
			if test.want == nil {
				if err != nil || found {
					t.Fatalf("found=%v error=%v", found, err)
				}
				return
			}
			if !errors.Is(err, test.want) ||
				containsSensitiveText(err, "canary") {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
}

func containsSensitiveText(err error, value string) bool {
	return err != nil && strings.Contains(err.Error(), value)
}
