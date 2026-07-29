package configurations

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"
)

func TestCurrentConfigurationLifecycleProductionCodecFeedsProcessor(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]any
		dataJSON string
	}{
		{name: "nil", data: nil, dataJSON: "null"},
		{name: "empty", data: map[string]any{}, dataJSON: "{}"},
		{
			name:     "nonempty",
			data:     map[string]any{"base_url": "https://api.github.com", "read_only": true},
			dataJSON: `{"base_url":"https://api.github.com","read_only":true}`,
		},
	}

	events := make([]CurrentConfigurationLifecycleEvent, 0, len(tests))
	wantBytes := make(map[string][]byte, len(tests))
	wantData := make(map[string]map[string]any, len(tests))
	for index, test := range tests {
		eventID := "event-" + test.name
		configurationUUID := "configuration-" + test.name
		configurationID := int32(40 + index)
		intent := CurrentConfigurationLifecycleIntent{
			ID:        eventID,
			Operation: CurrentConfigurationCreated,
			ActorID:   17,
			After: &CurrentConfigurationLifecycleSnapshot{
				ID:          configurationID,
				UUID:        configurationUUID,
				ProjectID:   7,
				EliteaTitle: "config_" + test.name,
				Type:        "github",
				Section:     "credentials",
				Source:      CurrentConfigurationSourceUser,
				Data:        test.data,
			},
		}
		encoded, err := EncodeCurrentConfigurationLifecycleIntent(intent)
		if err != nil {
			t.Fatalf("%s: encode lifecycle intent: %v", test.name, err)
		}
		expected := fmt.Sprintf(
			`{"schema_version":1,"operation":"configuration_created","actor_id":17,"after":{"id":%d,"uuid":%q,"project_id":7,"elitea_title":%q,"type":"github","section":"credentials","label":null,"shared":false,"status_ok":false,"source":"user","author_id":null,"data_available":%t,"data":%s}}`,
			configurationID,
			configurationUUID,
			"config_"+test.name,
			test.data != nil,
			test.dataJSON,
		)
		if !bytes.Equal(encoded, []byte(expected)) {
			t.Fatalf("%s: encoded lifecycle intent\n got: %s\nwant: %s", test.name, encoded, expected)
		}

		wantBytes[eventID] = bytes.Clone(encoded)
		wantData[eventID] = test.data
		events = append(events, CurrentConfigurationLifecycleEvent{
			EventID:           eventID,
			ProjectID:         7,
			ConfigurationUUID: configurationUUID,
			Revision:          1,
			Operation:         CurrentConfigurationCreated,
			ActorID:           17,
			Snapshot:          encoded,
			SnapshotDigest:    sha256.Sum256(encoded),
			AttemptCount:      1,
		})
	}

	store := &currentLifecycleStoreStub{events: events}
	reconciler := &currentLifecycleContractRecorder{
		records: make(map[string]currentLifecycleContractRecord, len(tests)),
	}
	processor, err := NewCurrentConfigurationLifecycleProcessor(
		store,
		reconciler,
		func() (string, error) { return "contract-lease", nil },
		CurrentConfigurationLifecycleProcessorConfig{
			PollInterval:  100 * time.Millisecond,
			LeaseTTL:      30 * time.Second,
			RetryBase:     time.Second,
			BatchSize:     len(tests),
			MaxConcurrent: 1,
			MaxAttempts:   5,
			ReportFailure: func(error) {},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := processor.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}

	sort.Strings(store.delivered)
	wantDelivered := []string{
		"event-empty@contract-lease",
		"event-nil@contract-lease",
		"event-nonempty@contract-lease",
	}
	if !reflect.DeepEqual(store.delivered, wantDelivered) {
		t.Fatalf("delivered=%#v want=%#v", store.delivered, wantDelivered)
	}
	if len(store.dead) != 0 || len(store.retried) != 0 {
		t.Fatalf("dead=%#v retried=%#v", store.dead, store.retried)
	}
	for eventID, expectedBytes := range wantBytes {
		record, ok := reconciler.records[eventID]
		if !ok {
			t.Fatalf("reconciler record %q is missing", eventID)
		}
		if !bytes.Equal(record.snapshot, expectedBytes) {
			t.Fatalf("%s: processor snapshot=%s want=%s", eventID, record.snapshot, expectedBytes)
		}
		if record.digest != sha256.Sum256(expectedBytes) {
			t.Fatalf("%s: processor digest does not match exact encoded bytes", eventID)
		}
		if record.intent.After == nil || !reflect.DeepEqual(record.intent.After.Data, wantData[eventID]) {
			t.Fatalf("%s: reconciled data=%#v want=%#v", eventID, record.intent.After, wantData[eventID])
		}
	}
}

type currentLifecycleContractRecord struct {
	snapshot []byte
	digest   [32]byte
	intent   CurrentConfigurationLifecycleIntent
}

type currentLifecycleContractRecorder struct {
	mu      sync.Mutex
	records map[string]currentLifecycleContractRecord
}

func (r *currentLifecycleContractRecorder) ReconcileCurrentConfigurationLifecycle(
	_ context.Context,
	event CurrentConfigurationLifecycleEvent,
	intent CurrentConfigurationLifecycleIntent,
) (CurrentConfigurationLifecycleReconcileResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.records[event.EventID] = currentLifecycleContractRecord{
		snapshot: bytes.Clone(event.Snapshot),
		digest:   event.SnapshotDigest,
		intent:   intent,
	}
	return CurrentConfigurationLifecycleReconcileResult{
		Disposition: CurrentConfigurationLifecycleReconciled,
	}, nil
}
