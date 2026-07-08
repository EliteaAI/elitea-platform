// Package rpclib provides shared RPC client utilities for inter-service
// communication within the Elitea platform.
package rpclib

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// ClientConfig holds settings for an HTTP RPC client.
type ClientConfig struct {
	BaseURL string
	Timeout time.Duration
	// APIKey is forwarded as a Bearer token for service-to-service auth.
	APIKey string
}

// Client is a simple HTTP client for calling internal Elitea services.
type Client struct {
	cfg    ClientConfig
	client *http.Client
}

// New creates a new RPC Client.
func New(cfg ClientConfig) *Client {
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	return &Client{
		cfg:    cfg,
		client: &http.Client{Timeout: timeout},
	}
}

// Get performs a GET request to the service at path.
func (c *Client) Get(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.BaseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("rpclib: build request: %w", err)
	}
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("rpclib: do request: %w", err)
	}
	return resp, nil
}
