package spi

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Runner is the one thing a sub-application supplies to the host (ADR-0023
// decision 2): given an admitted toolkit and tool and the request body, it
// returns the terminal body a poll hands back, or an error the host
// classifies into the contract. A runner may be in-process Go or a bridge to
// a sidecar in another language; the host does not know which.
type Runner interface {
	// Name is what /health reports as the active runner.
	Name() string
	// Invoke runs one tool. It is called with the admitted family and the
	// raw request body (configuration + parameters, as the facade sent it).
	Invoke(ctx context.Context, call Invoke, tc *Context) (map[string]any, error)
}

// Invoke is one admitted call.
type Invoke struct {
	Family  Family
	Toolkit string
	Tool    string
	Request map[string]any
	// Identity is the verified caller — empty on a hop that carried no
	// signature (a dev stack), never the raw headers: the gate strips those
	// before anything downstream can read them.
	Identity Identity
}

// Completed builds a terminal body of status Completed over result objects.
func Completed(invocationID string, objects ...ResultObject) map[string]any {
	if objects == nil {
		objects = []ResultObject{}
	}
	encoded, _ := json.Marshal(objects)
	return map[string]any{
		"invocation_id": invocationID,
		"status":        "Completed",
		"result":        string(encoded),
		"result_type":   "String",
	}
}

// UnavailableRunner is the default: it refuses every tool with a
// resource_not_found error a caller can read. A host with no runner wired
// must look broken, not idle — the SPI is served, and every invocation
// terminates with an error rather than an empty success nothing downstream
// can be built against.
type UnavailableRunner struct{}

func (UnavailableRunner) Name() string { return "unavailable" }

func (UnavailableRunner) Invoke(_ context.Context, call Invoke, _ *Context) (map[string]any, error) {
	return nil, Failf(KindNotFound, "No tool runner is configured, so '%s' cannot run. Wire a runner into the host to serve it.", call.Tool)
}

// EchoRunner is the trivial second runner ADR-0023's verification names: it
// emits paced progress and answers with a message that echoes the request,
// so a stack can exercise the whole invoke → poll → cancel path with no
// engine at all. Its Step is the pause between progress events; zero for
// tests, a second on a stack a browser watches.
type EchoRunner struct {
	Step  time.Duration
	Steps []string
}

func (EchoRunner) Name() string { return "echo" }

// Invoke walks its steps, checkpointing between them, then echoes the
// parameters back as one message.
func (r EchoRunner) Invoke(ctx context.Context, call Invoke, tc *Context) (map[string]any, error) {
	steps := r.Steps
	if len(steps) == 0 {
		steps = []string{"Received " + call.Tool, "Working", "Done"}
	}
	for _, step := range steps {
		if err := tc.Checkpoint(); err != nil {
			return nil, err
		}
		if err := tc.Thinking(ctx, step); err != nil {
			return nil, err
		}
		if r.Step > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(r.Step):
			}
		}
	}
	parameters, _ := json.Marshal(call.Request["parameters"])
	return Completed(tc.InvocationID(), Message(fmt.Sprintf("%s/%s echoed %s", call.Toolkit, call.Tool, string(parameters)))), nil
}
