package runtimecomposition

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/security/securefile"
)

const maxCurrentLiteLLMMasterKeyBytes = 4096

type currentLiteLLMMasterKey struct {
	mu     sync.RWMutex
	value  []byte
	closed bool
}

func loadCurrentLiteLLMMasterKey(path string) (*currentLiteLLMMasterKey, error) {
	value, err := securefile.Read(path, maxCurrentLiteLLMMasterKeyBytes+2, securefile.PrivateMaterial)
	if err != nil {
		return nil, errors.New("load LiteLLM master key")
	}
	value = bytes.TrimSuffix(value, []byte{'\n'})
	value = bytes.TrimSuffix(value, []byte{'\r'})
	if len(value) == 0 || len(value) > maxCurrentLiteLLMMasterKeyBytes || !utf8.Valid(value) ||
		strings.TrimSpace(string(value)) != string(value) {
		clear(value)
		return nil, errors.New("LiteLLM master key file is invalid")
	}
	for _, character := range string(value) {
		if unicode.IsControl(character) {
			clear(value)
			return nil, errors.New("LiteLLM master key file is invalid")
		}
	}
	return &currentLiteLLMMasterKey{value: value}, nil
}

func (key *currentLiteLLMMasterKey) MasterKey(ctx context.Context) (string, error) {
	if ctx == nil {
		return "", errors.New("LiteLLM master key context is required")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	key.mu.RLock()
	defer key.mu.RUnlock()
	if key.closed || len(key.value) == 0 {
		return "", errors.New("LiteLLM master key is unavailable")
	}
	return string(key.value), nil
}

func (key *currentLiteLLMMasterKey) Close() {
	if key == nil {
		return
	}
	key.mu.Lock()
	defer key.mu.Unlock()
	clear(key.value)
	key.value = nil
	key.closed = true
}
