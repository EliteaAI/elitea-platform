package configurations

// Bounds on POST /check_connections.
//
// DEFECT. BatchCheckConnections looped over every item of a 1 MiB body, one
// sequential gateway round trip per item, with no item cap and no request
// deadline. The item is ~50 bytes, so one request could ask for ~20,000
// provider round trips at up to 12 s each. cmd/elitea-main/http_server.go sets
// no WriteTimeout on purpose, and no middleware.Timeout wraps the route, so
// nothing cut the handler short: one authenticated caller holding
// `configurations.configuration.create` — which every project editor holds,
// including in a personal project — could hold a worker and a connection for
// hours and drive ~20,000 outbound requests at the gateway and the provider.
//
// The fix keeps the documented contract: always HTTP 200, one object per input
// item, in input order. An item the handler does not check reports
// success:false with the "could not verify" message, so an oversized or slow
// list degrades per row instead of failing the whole page. The web app marks
// EVERY credential invalid when this request fails, so a 400 would paint a
// healthy project all red.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// countingChecker records its calls and can block until the caller's context
// ends. It is safe for the worker pool to call from several goroutines.
type countingChecker struct {
	mutex sync.Mutex
	calls int
	block bool
}

func (c *countingChecker) Check(ctx context.Context, _ string, _ map[string]any) (ConnectionCheckResult, error) {
	c.mutex.Lock()
	c.calls++
	c.mutex.Unlock()
	if c.block {
		<-ctx.Done()
		return ConnectionCheckResult{}, ctx.Err()
	}
	return ConnectionCheckResult{Success: true, Message: "Connection successful"}, nil
}

func (c *countingChecker) callCount() int {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.calls
}

func batchItems(count int) []byte {
	items := make([]map[string]any, 0, count)
	for index := 0; index < count; index++ {
		items = append(items, map[string]any{
			"id":   fmt.Sprintf("cfg-%d", index),
			"type": "open_ai",
			"data": map[string]any{"api_base": "https://api.openai.com/v1", "api_key": "sk-test"},
		})
	}
	body, err := json.Marshal(items)
	if err != nil {
		panic(err)
	}
	return body
}

func postBatch(t *testing.T, checker ConnectionChecker, body []byte) []map[string]any {
	t.Helper()
	handler := NewHandler(nil, WithConnectionChecker(checker))
	request := httptest.NewRequest(http.MethodPost, "/check_connections/7", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.BatchCheckConnections(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
	}
	var results []map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &results); err != nil {
		t.Fatalf("body %q: %v", recorder.Body.String(), err)
	}
	return results
}

// TestBatchCheckConnectionsCapsTheItemCount is the fan-out bound.
func TestBatchCheckConnectionsCapsTheItemCount(t *testing.T) {
	const items = maxBatchConnectionChecks + 50
	checker := &countingChecker{}

	results := postBatch(t, checker, batchItems(items))

	if len(results) != items {
		t.Fatalf("results = %d, want one per input item (%d)", len(results), items)
	}
	if calls := checker.callCount(); calls != maxBatchConnectionChecks {
		t.Fatalf("checker calls = %d, want the cap %d", calls, maxBatchConnectionChecks)
	}
	// Input order survives, and every item above the cap is answered.
	for index, result := range results {
		if result["id"] != fmt.Sprintf("cfg-%d", index) {
			t.Fatalf("result %d = %v, want id cfg-%d", index, result, index)
		}
		if index < maxBatchConnectionChecks {
			continue
		}
		if success, _ := result["success"].(bool); success {
			t.Fatalf("item %d above the cap reports success: %v", index, result)
		}
		if result["message"] != "Could not verify the connection right now. Please try again." {
			t.Fatalf("item %d above the cap = %v", index, result)
		}
	}
}

// TestBatchCheckConnectionsStopsAtTheDeadline is the wall-clock bound. Every
// checker call blocks, which is what a host that accepts a connection and
// never answers does.
func TestBatchCheckConnectionsStopsAtTheDeadline(t *testing.T) {
	previous := batchConnectionCheckBudget
	batchConnectionCheckBudget = 150 * time.Millisecond
	t.Cleanup(func() { batchConnectionCheckBudget = previous })

	const items = 60
	checker := &countingChecker{block: true}

	start := time.Now()
	results := postBatch(t, checker, batchItems(items))
	elapsed := time.Since(start)

	if elapsed > 5*time.Second {
		t.Fatalf("the request ran for %s, past the %s budget", elapsed, batchConnectionCheckBudget)
	}
	if len(results) != items {
		t.Fatalf("results = %d, want one per input item (%d)", len(results), items)
	}
	for index, result := range results {
		if success, _ := result["success"].(bool); success {
			t.Fatalf("item %d reports success from a checker that never answered: %v", index, result)
		}
	}
	// After the budget ends, a remaining item costs no call at all.
	if calls := checker.callCount(); calls > batchConnectionCheckWorkers {
		t.Fatalf("checker calls = %d after the deadline, want at most the worker count %d",
			calls, batchConnectionCheckWorkers)
	}
}

// TestCheckBatchItemSpendsNoCallOnAnEndedBudget pins the per-item guard.
func TestCheckBatchItemSpendsNoCallOnAnEndedBudget(t *testing.T) {
	checker := &countingChecker{}
	handler := NewHandler(nil, WithConnectionChecker(checker))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	result := handler.checkBatchItem(ctx, "7", map[string]any{
		"id":   "cfg-1",
		"type": "open_ai",
		"data": map[string]any{"api_base": "https://api.openai.com/v1"},
	})

	if success, _ := result["success"].(bool); success {
		t.Fatalf("an unchecked item reports success: %v", result)
	}
	if calls := checker.callCount(); calls != 0 {
		t.Fatalf("checker calls = %d on an ended budget, want 0", calls)
	}
}
