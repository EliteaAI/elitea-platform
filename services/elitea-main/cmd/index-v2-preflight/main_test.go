package main

import (
	"context"
	"io"
	"strings"
	"testing"
)

func TestParseArgumentsRequiresOneOrMoreExplicitSpoolRoots(t *testing.T) {
	roots, ok := parseArguments([]string{
		"--spool-root", "/var/lib/elitea-worker-0/output-spool",
		"--spool-root=/var/lib/elitea-worker-1/output-spool",
	})
	if !ok || len(roots) != 2 ||
		roots[0] != "/var/lib/elitea-worker-0/output-spool" ||
		roots[1] != "/var/lib/elitea-worker-1/output-spool" {
		t.Fatalf("roots=%v ok=%v", roots, ok)
	}
	for _, arguments := range [][]string{
		nil,
		{"--spool-root"},
		{"--spool-root", "/tmp/spool", "unexpected"},
	} {
		if roots, ok := parseArguments(arguments); ok || roots != nil {
			t.Fatalf("invalid arguments=%v roots=%v ok=%v", arguments, roots, ok)
		}
	}
}

func TestRunRejectsInvalidUsageBeforeReadingEnvironment(t *testing.T) {
	var stderr strings.Builder
	calls := 0
	status := run(
		context.Background(),
		nil,
		func(string) (string, bool) {
			calls++
			return "", false
		},
		io.Discard,
		&stderr,
	)
	if status != exitInvalidUsage || calls != 0 ||
		!strings.Contains(stderr.String(), "usage: index-v2-preflight") {
		t.Fatalf("status=%d calls=%d stderr=%q", status, calls, stderr.String())
	}
}
