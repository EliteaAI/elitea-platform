package runtimecomposition

import (
	"context"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/jackc/pgx/v5/pgxpool"
)

type composedIndexDeleteToolkitReader struct{}

func (composedIndexDeleteToolkitReader) GetCurrentToolkit(
	context.Context,
	int32,
	int32,
	int32,
) (indexingapp.CurrentToolkitSnapshot, bool, error) {
	return indexingapp.CurrentToolkitSnapshot{}, false, nil
}

type composedIndexDeleteSettingsResolver struct{}

func (composedIndexDeleteSettingsResolver) Resolve(
	context.Context,
	configurationapp.CurrentToolkitSettingsRequest,
) (map[string]any, error) {
	return nil, nil
}

func TestConfiguredCurrentIndexMetaDeleteComposedIffIndexDispatchEnabled(
	t *testing.T,
) {
	disabled, err := newConfiguredCurrentIndexMetaDeleteService(
		false,
		nil,
		nil,
		nil,
	)
	if err != nil || disabled != nil {
		t.Fatalf("disabled service=%v error=%v", disabled, err)
	}

	enabled, err := newConfiguredCurrentIndexMetaDeleteService(
		true,
		&pgxpool.Pool{},
		composedIndexDeleteToolkitReader{},
		composedIndexDeleteSettingsResolver{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if enabled == nil {
		t.Fatal("enabled current index metadata delete service is nil")
	}
}

func TestConfiguredCurrentIndexMetaDeleteFailsClosed(t *testing.T) {
	pool := &pgxpool.Pool{}
	toolkits := composedIndexDeleteToolkitReader{}
	settings := composedIndexDeleteSettingsResolver{}

	for _, test := range []struct {
		name     string
		pool     *pgxpool.Pool
		toolkits indexingapp.CurrentToolkitReader
		settings indexingapp.CurrentToolkitSettingsValidator
	}{
		{
			name:     "missing project database",
			toolkits: toolkits,
			settings: settings,
		},
		{
			name:     "missing project toolkit resolver",
			pool:     pool,
			settings: settings,
		},
		{
			name:     "missing configurations settings resolver",
			pool:     pool,
			toolkits: toolkits,
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			service, err := newConfiguredCurrentIndexMetaDeleteService(
				true,
				test.pool,
				test.toolkits,
				test.settings,
			)
			if err == nil || service != nil {
				t.Fatalf("service=%v error=%v", service, err)
			}
		})
	}
}
