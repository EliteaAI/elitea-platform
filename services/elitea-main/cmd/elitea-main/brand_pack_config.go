package main

import (
	"errors"
	"strings"
)

// brandPackConfig is the FILE layer of the brand pack (ADR-0024 decision 1):
// the path an operator mounts a deployment pack at. Empty means no file
// layer; the admin-authored database layer and the product default still
// resolve without it.
type brandPackConfig struct {
	Path string
}

// brandPackConfigFromEnv reads BRAND_PACK_PATH. The read used to sit inline in
// internal/api/router.go, the one flag not declared beside the others here;
// the value is a path, so the only rule is that a set value is not blank.
func brandPackConfigFromEnv(lookup func(string) (string, bool)) (brandPackConfig, error) {
	if lookup == nil {
		return brandPackConfig{}, errors.New("brand pack environment lookup is required")
	}
	raw, ok := lookup("BRAND_PACK_PATH")
	if !ok {
		return brandPackConfig{}, nil
	}
	return brandPackConfig{Path: strings.TrimSpace(raw)}, nil
}
