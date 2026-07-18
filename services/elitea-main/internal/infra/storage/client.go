package storage

// This file is intentionally minimal. The Backend factory logic lives in
// cmd/elitea-main/main.go to avoid import cycles (backends import this
// package for the interface types; this package cannot import them back).
//
// See storage.Backend interface in storage.go and ConfigFromEnv() in config.go.
