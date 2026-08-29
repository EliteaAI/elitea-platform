package runtimecomposition

import (
	"context"
	"errors"
	"testing"
)

func TestAbsentCurrentAgentDynamicToolkitSchemasReportsCapabilityGapAsNotFound(t *testing.T) {
	source := absentCurrentAgentDynamicToolkitSchemas{}
	schema, found, err := source.FindCurrentActorVisibleToolkitSchema(
		context.Background(),
		7,
		11,
		"wikis_Wikis",
	)
	if err != nil || found || schema.Properties != nil {
		t.Fatalf("schema=%#v found=%v error=%v", schema, found, err)
	}

	// A nil context is exactly what the guard under test refuses; the variable
	// spelling keeps the deliberate nil out of SA1012's literal-nil rule.
	var nilContext context.Context
	if _, _, err := source.FindCurrentActorVisibleToolkitSchema(
		nilContext,
		7,
		11,
		"wikis_Wikis",
	); !errors.Is(err, ErrCurrentToolkitSchemaLookupInvalid) {
		t.Fatalf("nil context error=%v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := source.FindCurrentActorVisibleToolkitSchema(
		ctx,
		7,
		11,
		"wikis_Wikis",
	); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled context error=%v", err)
	}
}
