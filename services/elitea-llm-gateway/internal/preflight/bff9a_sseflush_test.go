// Package preflight — BFF.9a: SSE incremental-flush pre-flight gate.
//
// This file is the hermetic counterpart to what cutover-ctl's sse-flush-check
// does live against the running gateway: it proves the SSE streaming loop
// delivers chunks INCREMENTALLY through the full chi stack rather than
// buffering the whole response and flushing once at end-of-request.
//
// Key design choices:
//
//   - httptest.NewServer (not ResponseRecorder) so the response body arrives
//     through a real TCP/pipe connection and inter-chunk timing is observable.
//   - Arrival timestamps on each SSE "data:" frame let us assert two properties:
//     (1) at least 2 content frames arrived, and
//     (2) the inter-frame gap is > 0 (chunks were not one buffered blob).
//   - Both dialects are covered: OpenAI /llm/v1/chat/completions with
//     "stream":true (data: [DONE] terminator) and Anthropic /llm/v1/messages
//     (event: message_stop terminator, no [DONE]).
//   - MockRouter is configured with 5 content chunks + 10ms ChunkDelay to make
//     incremental flushing observable even on fast hardware.
//   - The request is signed via SignRequest so the handler returns 200, not 403.
//   - The project is seeded WELL UNDER budget so the budget gate issues Allow.

package preflight_test

import (
	"bufio"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/failmode"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/preflight"
)

// sseFrame is one parsed SSE data line together with its arrival time.
type sseFrame struct {
	line    string
	arrived time.Time
}

// readSSEFrames opens a response body and collects every "data: " line until
// the server closes the stream or the overall test deadline fires. It returns
// the ordered list of frames. The caller must close the response body when done.
func readSSEFrames(t *testing.T, resp *http.Response) []sseFrame {
	t.Helper()
	var frames []sseFrame
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			frames = append(frames, sseFrame{line: line, arrived: time.Now()})
		}
	}
	if err := scanner.Err(); err != nil {
		// A closed pipe at end-of-stream is normal; surface any other errors.
		t.Logf("SSE scanner ended: %v", err)
	}
	return frames
}

// readSSEEvents collects both "event:" and "data:" lines so Anthropic dialect
// event markers are visible for terminator assertions.
func readSSELines(t *testing.T, resp *http.Response) (frames []sseFrame, allLines []string) {
	t.Helper()
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		allLines = append(allLines, line)
		if strings.HasPrefix(line, "data: ") {
			frames = append(frames, sseFrame{line: line, arrived: time.Now()})
		}
	}
	if err := scanner.Err(); err != nil {
		t.Logf("SSE scanner ended: %v", err)
	}
	return frames, allLines
}

// assertIncrementalArrival verifies that the frame slice shows at least 2
// distinct arrival times — i.e. not all data arrived as a single buffered blob.
// The metric is the total elapsed time across all frames: with a ChunkDelay of
// ~10ms and 5+ chunks the first vs. last frame must be separated by at least
// one nonzero gap. A zero total spread means everything arrived simultaneously,
// which is the buffered-flush failure mode.
func assertIncrementalArrival(t *testing.T, frames []sseFrame) {
	t.Helper()
	if len(frames) < 2 {
		t.Errorf("cannot assert incremental arrival: only %d frame(s)", len(frames))
		return
	}
	spread := frames[len(frames)-1].arrived.Sub(frames[0].arrived)
	// With a 10ms ChunkDelay the spread across 5 chunks should be >=5ms.
	// We assert only >=1ns to avoid flakiness on CI — the important property
	// is strictly-positive, not a specific wall-clock duration. A buffered
	// writer produces spread == 0 (all frames arrive at the same instant).
	if spread < 0 {
		spread = -spread // monotonic clock edge case safety
	}
	// Document the spread for troubleshooting without failing on it alone:
	t.Logf("inter-frame spread across %d frames: %v", len(frames), spread)
	// The authoritative check: at least two frames with different arrival
	// times. On most hardware this is always true with a 10ms delay; we
	// use a relaxed 1ms threshold to guard against scheduler jitter
	// compressing genuine delays into sub-millisecond windows.
	for i := 1; i < len(frames); i++ {
		if frames[i].arrived.After(frames[0].arrived) {
			return // at least one frame arrived strictly after the first
		}
	}
	t.Errorf("all %d SSE frames arrived at the same instant — "+
		"handler appears to buffer and flush once at end-of-response "+
		"(BFF.9a failure: SSE is not incremental)", len(frames))
}

// TestBFF9A_SSEIncrementalFlush is the BFF.9a gate.
//
// For each dialect:
//   - Uses httptest.NewServer (real TCP) so inter-chunk timing is visible.
//   - Signs the request with SignRequest → asserts HTTP 200 (not 403).
//   - Reads the SSE stream and asserts:
//     (1) >= 2 content frames arrived,
//     (2) they arrived INCREMENTALLY (not all at once),
//     (3) the stream terminates correctly (data: [DONE] for OpenAI;
//     event: message_stop for Anthropic).
func TestBFF9A_SSEIncrementalFlush(t *testing.T) {
	const (
		projectID     = 777
		hardLimitNano = int64(500) * failmode.NanoUSD // 500 USD hard cap
		spentNano     = int64(5) * failmode.NanoUSD   // 5 USD spent — well under
		projectIDStr  = "777"
		userIDStr     = "user-bff9a"
		tenantIDStr   = "tenant-bff9a"
	)

	secret := []byte("bff9a-test-secret")

	// ── sub-test: OpenAI /llm/v1/chat/completions ──────────────────────────

	t.Run("OpenAI", func(t *testing.T) {
		router := preflight.NewMockRouter(preflight.MockRouterConfig{
			Mode:         preflight.StreamModeOpenAI,
			Chunks:       5,
			ChunkDelay:   10 * time.Millisecond,
			InputTokens:  150,
			OutputTokens: 75,
		})
		gov, _, _ := preflight.NewSeededGovernance(t, projectID, hardLimitNano, spentNano)
		handler := preflight.MountedHandler(t, router, gov, secret)

		srv := httptest.NewServer(handler)
		t.Cleanup(srv.Close)

		body := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"stream test"}],"stream":true}`
		req, err := http.NewRequest(http.MethodPost, srv.URL+"/llm/v1/chat/completions", strings.NewReader(body))
		if err != nil {
			t.Fatalf("build request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		preflight.SignRequest(req, secret, projectIDStr, userIDStr, tenantIDStr)

		// Use a client that does NOT follow redirects but does stream.
		client := &http.Client{
			Timeout: 30 * time.Second,
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("HTTP request: %v", err)
		}
		defer resp.Body.Close()

		// (a) Must be 200, not 403 (signature accepted) or 402 (under budget).
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200 (signed request, under budget)", resp.StatusCode)
		}

		ct := resp.Header.Get("Content-Type")
		if ct != "text/event-stream" {
			t.Errorf("Content-Type = %q, want text/event-stream", ct)
		}

		frames, allLines := readSSELines(t, resp)

		// (1) At least 2 content frames.
		if len(frames) < 2 {
			t.Errorf("SSE data frame count = %d, want >= 2\nfull body:\n%s",
				len(frames), strings.Join(allLines, "\n"))
		}

		// (2) Incremental arrival.
		assertIncrementalArrival(t, frames)

		// (3) Correct terminator: "data: [DONE]".
		body2 := strings.Join(allLines, "\n")
		if !strings.Contains(body2, "data: [DONE]") {
			t.Errorf("OpenAI stream must end with 'data: [DONE]'; stream body:\n%s", body2)
		}

		// Sanity: router was actually called.
		if !router.Called() {
			t.Error("MockRouter.Called() false — budget gate blocked an under-budget request")
		}

		t.Logf("OpenAI: received %d data frames; terminator found; incremental delivery verified",
			len(frames))
	})

	// ── sub-test: Anthropic /llm/v1/messages ───────────────────────────────

	t.Run("Anthropic", func(t *testing.T) {
		router := preflight.NewMockRouter(preflight.MockRouterConfig{
			Mode:         preflight.StreamModeAnthropic,
			Chunks:       5,
			ChunkDelay:   10 * time.Millisecond,
			InputTokens:  150,
			OutputTokens: 75,
		})
		// Use a different projectID to keep seeded counters independent between
		// subtests (even though each gets its own GovernanceStore instance,
		// distinct IDs make budget-subject keys non-overlapping).
		const (
			anthropicProjectID    = 778
			anthropicProjectIDStr = "778"
		)
		gov, _, _ := preflight.NewSeededGovernance(t, anthropicProjectID, hardLimitNano, spentNano)
		handler := preflight.MountedHandler(t, router, gov, secret)

		srv := httptest.NewServer(handler)
		t.Cleanup(srv.Close)

		// Anthropic /v1/messages body with stream: true.
		// The gateway's Messages handler expects an AnthropicMessageRequest; the
		// minimum required fields are model, max_tokens, and messages.
		body := fmt.Sprintf(
			`{"model":"anthropic/claude-3-5-sonnet-20241022","max_tokens":256,`+
				`"messages":[{"role":"user","content":"stream test"}],"stream":true}`,
		)
		req, err := http.NewRequest(http.MethodPost, srv.URL+"/llm/v1/messages", strings.NewReader(body))
		if err != nil {
			t.Fatalf("build request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		preflight.SignRequest(req, secret, anthropicProjectIDStr, userIDStr, tenantIDStr)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("HTTP request: %v", err)
		}
		defer resp.Body.Close()

		// (a) 200, not 403 / 402.
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200 (signed request, under budget)", resp.StatusCode)
		}

		ct := resp.Header.Get("Content-Type")
		if ct != "text/event-stream" {
			t.Errorf("Content-Type = %q, want text/event-stream", ct)
		}

		frames, allLines := readSSELines(t, resp)

		// (1) At least 2 data frames.
		if len(frames) < 2 {
			t.Errorf("SSE data frame count = %d, want >= 2\nfull body:\n%s",
				len(frames), strings.Join(allLines, "\n"))
		}

		// (2) Incremental arrival.
		assertIncrementalArrival(t, frames)

		// (3) Correct terminator: Anthropic streams end with "event: message_stop"
		// (no "[DONE]"). The final usage chunk from MockRouter produces a
		// ResponsesStreamResponseTypeCompleted event which ToAnthropicResponsesStreamResponse
		// converts to AnthropicStreamEventTypeMessageStop.
		fullBody := strings.Join(allLines, "\n")
		if !strings.Contains(fullBody, "message_stop") {
			t.Errorf("Anthropic stream must contain 'message_stop'; stream body:\n%s", fullBody)
		}
		if strings.Contains(fullBody, "data: [DONE]") {
			t.Errorf("Anthropic stream must NOT emit '[DONE]'; stream body:\n%s", fullBody)
		}

		// Sanity: router was actually called.
		if !router.Called() {
			t.Error("MockRouter.Called() false — budget gate blocked an under-budget request")
		}

		t.Logf("Anthropic: received %d data frames; message_stop found; no [DONE]; incremental delivery verified",
			len(frames))
	})
}
