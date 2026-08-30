package agentexecution

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// THE SEQUENCING CONSTRAINT THIS GUARDS.
//
// services/elitea-worker-rust/src/agents/context_management.rs
// `ContextManagementPlan::admit_current` admits ONLY the disabled state. Any
// `context_settings` carrying `enabled: true` — or carrying an `enabled` key at
// all, since an absent one is treated as "on" — is refused with
// `UnsupportedCapability`, and that refusal fails the whole turn. Its doc
// comment says so deliberately: the Rust side is waiting on Main to freeze this
// settings contract before it composes ADK's compaction primitives.
//
// Persisting and serving the contract, which is what the change around this
// test does, is safe. SENDING it is not, and would break every agent turn on
// every deployment the moment it shipped. The two builders below are the only
// places elitea-main fills `AgentExecutionInputV1.ContextSettings`, and both
// send the empty object; this test pins that, so the day someone wires the
// resolved strategy through, they have to come here and read why they must not
// until the Rust side admits it.
//
// WHY IT READS SOURCE. The alternative is a behavioural test over
// buildAgentExecutionInput, which needs a database, a resolved LLM binding, a
// conversation and a participant graph — and would still only cover the paths
// the fixture happened to take. What has to hold is stronger and simpler than
// any one path: no assignment of this field anywhere in this package says
// anything but `{}`. This repository already asserts a file as data for the
// same reason (the ci-python.yml parity test).
func TestContextSettingsStayEmptyForTheWorker(t *testing.T) {
	// Every builder that fills the field, and the literal each must carry.
	builders := []string{"start.go", "adhoc.go"}

	assignment := regexp.MustCompile(`ContextSettings:\s*(\[\]byte\(` + "`" + `[^` + "`" + `]*` + "`" + `\)|[^,\n]+)`)

	for _, name := range builders {
		source, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		matches := assignment.FindAllStringSubmatch(string(source), -1)
		if len(matches) == 0 {
			t.Fatalf("%s no longer assigns ContextSettings; either the payload moved "+
				"or the field was dropped — this guard has to move with it", name)
		}
		for _, match := range matches {
			if got := strings.TrimSpace(match[1]); got != "[]byte(`{}`)" {
				t.Errorf("%s sends ContextSettings as %s, want []byte(`{}`).\n"+
					"The Rust worker refuses any non-disabled context settings "+
					"(elitea-worker-rust/src/agents/context_management.rs, admit_current), "+
					"and that refusal fails the agent turn. Do not send the resolved "+
					"strategy until the worker admits it, or gate it behind a flag "+
					"that defaults off.", name, got)
			}
		}
	}
}

// The field is filled in exactly these two builders. A third one appearing
// without a decision about what it sends is the failure mode this catches.
func TestContextSettingsHasNoOtherProducer(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package directory: %v", err)
	}
	producers := []string{}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		source, readErr := os.ReadFile(name)
		if readErr != nil {
			t.Fatalf("read %s: %v", name, readErr)
		}
		if strings.Contains(string(source), "ContextSettings:") {
			producers = append(producers, name)
		}
	}
	want := map[string]bool{"start.go": true, "adhoc.go": true}
	for _, producer := range producers {
		if !want[producer] {
			t.Errorf("%s also sends ContextSettings to the worker; see "+
				"TestContextSettingsStayEmptyForTheWorker for why that has to stay `{}`", producer)
		}
		delete(want, producer)
	}
	for missing := range want {
		t.Errorf("%s no longer sends ContextSettings — this guard has to follow the payload", missing)
	}
}
