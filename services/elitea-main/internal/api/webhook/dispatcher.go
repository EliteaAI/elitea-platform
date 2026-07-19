package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/redis"
)

type Dispatcher struct {
	repo   Repository
	client *http.Client
}

func NewDispatcher(repo Repository) *Dispatcher {
	return &Dispatcher{
		repo: repo,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (d *Dispatcher) HandleEvent(ctx context.Context, event redis.Event) error {
	var meta struct {
		ProjectID string `json:"project_id"`
	}
	if err := json.Unmarshal(event.Payload, &meta); err != nil {
		return nil
	}
	if meta.ProjectID == "" {
		return nil
	}

	webhooks, err := d.repo.ListByEvent(ctx, meta.ProjectID, event.Type)
	if err != nil {
		return err
	}

	body, _ := json.Marshal(map[string]any{
		"type":      event.Type,
		"source":    event.Source,
		"payload":   json.RawMessage(event.Payload),
		"timestamp": event.Timestamp,
	})

	for _, wh := range webhooks {
		if !wh.Active {
			continue
		}
		go d.deliver(wh, body)
	}
	return nil
}

func (d *Dispatcher) deliver(wh Webhook, body []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, wh.URL, bytes.NewReader(body))
	if err != nil {
		slog.Error("webhook: build request", "err", err, "url", wh.URL)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "EliteA-Webhook/1.0")

	if wh.Secret != "" {
		mac := hmac.New(sha256.New, []byte(wh.Secret))
		mac.Write(body)
		sig := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-Webhook-Signature", "sha256="+sig)
	}

	resp, err := d.client.Do(req)
	if err != nil {
		slog.Warn("webhook: delivery failed", "err", err, "url", wh.URL)
		return
	}
	_ = resp.Body.Close()

	if resp.StatusCode >= 400 {
		slog.Warn("webhook: non-success response", "status", resp.StatusCode, "url", wh.URL)
	}
}
