package storage

import (
	"context"
	"errors"
	"testing"
)

func TestCurrentProjectLLMKeyReadsOnlySelectedProjectRegularSecret(t *testing.T) {
	loader := &fakeSecretVaultLoader{
		projects: map[int64]SecretVault{
			7: &fakeSecretVault{
				regular: map[string]string{currentProjectLLMKeyName: "project-seven-key"},
				hidden:  map[string]string{currentProjectLLMKeyName: "hidden-must-not-win"},
			},
		},
		projectLoads: map[int64]int{},
	}
	resolver, err := NewCurrentProjectLLMKeyResolver(loader)
	if err != nil {
		t.Fatal(err)
	}

	key, err := resolver.CurrentProjectLLMKey(context.Background(), 7)
	if err != nil || key != "project-seven-key" || loader.projectLoads[7] != 1 {
		t.Fatalf("key=%q err=%v loads=%v", key, err, loader.projectLoads)
	}
}

func TestCurrentProjectLLMKeyFailsClosedWithoutRegularProjectKey(t *testing.T) {
	for name, loader := range map[string]SecretVaultLoader{
		"missing vault": &fakeSecretVaultLoader{projects: map[int64]SecretVault{}},
		"hidden only": &fakeSecretVaultLoader{projects: map[int64]SecretVault{
			7: &fakeSecretVault{hidden: map[string]string{currentProjectLLMKeyName: "hidden"}},
		}},
	} {
		t.Run(name, func(t *testing.T) {
			resolver, err := NewCurrentProjectLLMKeyResolver(loader)
			if err != nil {
				t.Fatal(err)
			}
			if key, err := resolver.CurrentProjectLLMKey(context.Background(), 7); key != "" || !errors.Is(err, ErrCurrentProjectLLMKeyUnavailable) {
				t.Fatalf("key=%q err=%v", key, err)
			}
		})
	}

	if _, err := NewCurrentProjectLLMKeyResolver(nil); err == nil {
		t.Fatal("nil loader was accepted")
	}
	resolver, _ := NewCurrentProjectLLMKeyResolver(&fakeSecretVaultLoader{})
	if _, err := resolver.CurrentProjectLLMKey(context.Background(), 0); !errors.Is(err, ErrCurrentProjectLLMKeyUnavailable) {
		t.Fatalf("invalid project error = %v", err)
	}
}
