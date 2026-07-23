package configurations

import (
	"context"
	"testing"
)

func TestCurrentLocalDataNormalizerOwnsLocalCreatesAndDelegatesUpdates(t *testing.T) {
	fallback := &currentSDKFallbackNormalizer{result: CurrentConfigurationNormalizationResult{
		Data: map[string]any{"delegated": true}, Complete: true,
	}}
	normalizer := NewCurrentLocalDataNormalizer(fallback)
	created, err := normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Operation: CurrentConfigurationNormalizationCreate,
		Type:      "environment_settings",
		Data:      map[string]any{},
	})
	if err != nil || !created.Complete || created.Data["system_sender_name"] != "Elitea" || fallback.calls != 0 {
		t.Fatalf("local create result=%#v fallback_calls=%d err=%v", created, fallback.calls, err)
	}
	updated, err := normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Operation: CurrentConfigurationNormalizationUpdate,
		Type:      "environment_settings",
		Data:      map[string]any{"system_sender_name": "Changed"},
	})
	if err != nil || !updated.Complete || updated.Data["delegated"] != true || fallback.calls != 1 {
		t.Fatalf("delegated update result=%#v fallback_calls=%d err=%v", updated, fallback.calls, err)
	}
}
