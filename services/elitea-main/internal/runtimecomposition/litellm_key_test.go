package runtimecomposition

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCurrentLiteLLMMasterKeyLoadsOnceAndClearsOnClose(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "litellm-master-key")
	if err := os.WriteFile(path, []byte("sk-current\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	key, err := loadCurrentLiteLLMMasterKey(path)
	if err != nil {
		t.Fatal(err)
	}
	value, err := key.MasterKey(context.Background())
	if err != nil || value != "sk-current" {
		t.Fatalf("key=%q err=%v", value, err)
	}
	key.Close()
	if value, err := key.MasterKey(context.Background()); value != "" || err == nil {
		t.Fatalf("closed key=%q err=%v", value, err)
	}
}

func TestCurrentLiteLLMMasterKeyRejectsUnsafeMaterial(t *testing.T) {
	for name, value := range map[string]string{
		"blank":       "\n",
		"embedded lf": "sk-current\nsecond",
		"space":       " sk-current",
	} {
		t.Run(name, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, "litellm-master-key")
			if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := loadCurrentLiteLLMMasterKey(path); err == nil {
				t.Fatal("unsafe key was accepted")
			}
		})
	}

	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "group-readable")
	if err := os.WriteFile(path, []byte("sk-current"), 0o640); err != nil {
		t.Fatal(err)
	}
	if _, err := loadCurrentLiteLLMMasterKey(path); err == nil {
		t.Fatal("group-readable key was accepted")
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	key := &currentLiteLLMMasterKey{value: []byte("sk-current")}
	if _, err := key.MasterKey(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error=%v", err)
	}
}
