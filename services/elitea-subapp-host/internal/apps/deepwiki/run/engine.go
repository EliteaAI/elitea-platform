package run

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/spi"
)

// The engine sidecar (ADR-0023 H2). The analysis engine — the copied
// Python tool layer with its ~1.1 GB dependency closure — stays in Python
// and listens on a Unix socket next to this host. This host keeps the SPI,
// the parameter merge, the egress check, composition and upload; the
// sidecar runs one tool at a time for it:
//
//	POST /engine/invoke                 {invocation_id, tool, arguments}
//	  → NDJSON: {"thinking": "…"}* then {"result": {…}} | {"error": {…}}
//	POST /engine/invocations/{id}/stop  requests a cooperative stop
//
// Progress lines become the invocation's thinking events as they arrive;
// the host's own stop checkpoint is watched while the stream is open, and a
// stop is forwarded to the sidecar — which terminates the engine's worker
// subprocess — before this side gives up on the stream.

// EngineTools are the tools the sidecar serves; everything else is refused
// at the door, as the fixture table does.
var EngineTools = []string{"generate_wiki", "ask", "deep_research"}

// engineLine is one NDJSON line of the sidecar's stream.
type engineLine struct {
	Thinking *string        `json:"thinking,omitempty"`
	Result   map[string]any `json:"result,omitempty"`
	Error    *engineError   `json:"error,omitempty"`
}

type engineError struct {
	Message       string `json:"message"`
	ErrorType     string `json:"error_type"`
	ErrorCategory string `json:"error_category"`
}

// EngineClient speaks the sidecar protocol over a Unix socket.
type EngineClient struct {
	Socket     string
	HTTP       *http.Client
	StopPeriod time.Duration
}

// NewEngineClient dials the socket for every request; the URL host is a
// placeholder the transport ignores.
func NewEngineClient(socket string) *EngineClient {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socket)
		},
		// A generation can run for an hour; nothing here may time it out.
		ResponseHeaderTimeout: 0,
	}
	return &EngineClient{Socket: socket, HTTP: &http.Client{Transport: transport}, StopPeriod: 250 * time.Millisecond}
}

// Invoke runs one tool and streams its progress into the invocation. It
// returns the engine's result dict — success or not; the runner maps a
// failed result through EngineError — or an error for a transport failure,
// a refusal the sidecar reported, or a stop.
func (c *EngineClient) Invoke(ctx context.Context, tool string, arguments map[string]any, tc *spi.Context) (map[string]any, error) {
	body, err := json.Marshal(map[string]any{"invocation_id": tc.InvocationID(), "tool": tool, "arguments": arguments})
	if err != nil {
		return nil, spi.Failf(spi.KindRuntime, "encode the engine request: %v", err)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://engine/engine/invoke", bytes.NewReader(body))
	if err != nil {
		return nil, spi.Failf(spi.KindRuntime, "%v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, spi.Failf(spi.KindRuntime, "The DeepWiki engine is not reachable at %s: %v", c.Socket, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		text, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return nil, spi.Failf(spi.KindRuntime, "The DeepWiki engine refused the invocation: HTTP %d %s", response.StatusCode, strings.TrimSpace(string(text)))
	}

	// The stop watcher: the host's checkpoint is the only place a stop is
	// visible; the sidecar must hear about it to kill the worker.
	stopped := make(chan struct{})
	watcherDone := make(chan struct{})
	go func() {
		defer close(watcherDone)
		ticker := time.NewTicker(c.StopPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if tc.Checkpoint() != nil {
					c.stop(tc.InvocationID())
					close(stopped)
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-watcherDone }()

	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 64*1024*1024)
	for scanner.Scan() {
		raw := bytes.TrimSpace(scanner.Bytes())
		if len(raw) == 0 {
			continue
		}
		var line engineLine
		if err := json.Unmarshal(raw, &line); err != nil {
			return nil, spi.Failf(spi.KindRuntime, "The DeepWiki engine sent a line this host cannot read: %.120s", raw)
		}
		switch {
		case line.Thinking != nil:
			if err := tc.Thinking(ctx, *line.Thinking); err != nil {
				return nil, err
			}
		case line.Error != nil:
			return nil, spi.Failf(kindOf(line.Error.ErrorType), "%s", line.Error.Message)
		case line.Result != nil:
			return line.Result, nil
		}
	}
	select {
	case <-stopped:
		return nil, spi.ErrCancelled
	default:
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, context.Canceled) {
		return nil, spi.Failf(spi.KindRuntime, "The DeepWiki engine's stream ended in error: %v", err)
	}
	if tc.Checkpoint() != nil {
		return nil, spi.ErrCancelled
	}
	return nil, spi.Failf(spi.KindRuntime, "The DeepWiki engine closed the stream without a result")
}

// stop asks the sidecar to stop one invocation. Best effort: the stream
// is cancelled either way, and the sidecar terminates its worker on its
// own checkpoint.
func (c *EngineClient) stop(invocationID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://engine/engine/invocations/"+invocationID+"/stop", nil)
	if err != nil {
		return
	}
	if response, err := c.HTTP.Do(request); err == nil {
		_ = response.Body.Close()
	}
}

// kindOf maps the sidecar's error_type — the Python exception class name —
// onto the host's kinds; the classifier does the rest.
func kindOf(errorType string) spi.Kind {
	switch errorType {
	case "FileNotFoundError":
		return spi.KindNotFound
	case "ValueError":
		return spi.KindValue
	case "MemoryError":
		return spi.KindMemory
	case "KeyError":
		return spi.KindKey
	case "RuntimeError", "":
		return spi.KindRuntime
	default:
		return spi.KindGeneric
	}
}

// NewEngineRunner is the shared runner over the sidecar's tools, with the
// host's egress policy and callback CA.
func NewEngineRunner(settings spi.Settings) *Runner {
	client := NewEngineClient(settings.EngineSocket)
	tools := map[string]Tool{}
	for _, name := range EngineTools {
		tool := name
		tools[tool] = func(ctx context.Context, arguments map[string]any, tc *spi.Context) (map[string]any, error) {
			return client.Invoke(ctx, tool, arguments, tc)
		}
	}
	return &Runner{
		RunnerName: "legacy",
		Tools:      tools,
		Egress:     spi.ParseEgressPolicy(settings.GitAllowlist),
		Artifacts:  ArtifactClientFrom(settings.TLSCAFile),
	}
}
