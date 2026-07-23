package main

import (
	"os"
	"path/filepath"
	"testing"
)

// compliantFixture: a budget/quota call site that already treats 402 identically
// to 429. auditContent MUST NOT flag it.
const compliantFixture = `package handler

func handleBudget(status int) error {
	// Budget exhaustion may arrive as 402 (gateway) or legacy 429 (LiteLLM).
	if status == 402 || status == 429 {
		return errBudgetExceeded // insufficient_quota
	}
	return nil
}
`

// offendingFixture: a budget call site that branches on 429 ALONE. auditContent
// MUST flag exactly the 429 line.
const offendingFixture = `package handler

func handleBudget(status int) error {
	// Budget exhausted?
	if status == 429 {
		return errBudgetExceeded
	}
	return nil
}
`

// rateLimitFixture: a pure rate-limit 429 with no budget/quota keyword nearby.
// It is legitimately allowed to stay 429 and MUST NOT be flagged.
const rateLimitFixture = `package handler

func handleThrottle(status int) error {
	if status == 429 {
		return errTooManyRequests // request throughput
	}
	return nil
}
`

func TestBudgetAuditContent_Compliant(t *testing.T) {
	if got := auditContent(compliantFixture); len(got) != 0 {
		t.Fatalf("compliant fixture flagged %d site(s): %+v", len(got), got)
	}
}

func TestBudgetAuditContent_Offending(t *testing.T) {
	got := auditContent(offendingFixture)
	if len(got) != 1 {
		t.Fatalf("offending fixture: want 1 finding, got %d: %+v", len(got), got)
	}
	if got[0].Line != 5 {
		t.Fatalf("offending fixture: want finding on line 5, got line %d", got[0].Line)
	}
}

func TestBudgetAuditContent_RateLimitIgnored(t *testing.T) {
	if got := auditContent(rateLimitFixture); len(got) != 0 {
		t.Fatalf("pure rate-limit 429 wrongly flagged: %+v", got)
	}
}

func TestBudgetAuditContent_NoStatusCodes(t *testing.T) {
	if got := auditContent("package x\n\nfunc noop() {}\n"); len(got) != 0 {
		t.Fatalf("unrelated content flagged: %+v", got)
	}
}

func TestBudgetAuditContent_402IsStandaloneToken(t *testing.T) {
	// "4029" must not satisfy the 402 companion check for a budget-429 site.
	src := "package x\n\n// budget\nif s == 429 { fail() } // code 4029\n"
	if got := auditContent(src); len(got) != 1 {
		t.Fatalf("substring 4029 wrongly counted as a 402 companion: got %d findings", len(got))
	}
}

func TestBudgetAuditPaths_MixedTree(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "good.go"), compliantFixture)
	writeFile(t, filepath.Join(dir, "bad.py"), offendingFixture)
	writeFile(t, filepath.Join(dir, "throttle.go"), rateLimitFixture)
	// Test files and vendored/testdata trees are excluded.
	writeFile(t, filepath.Join(dir, "bad_test.go"), offendingFixture)
	writeFile(t, filepath.Join(dir, "vendor", "dep.go"), offendingFixture)
	writeFile(t, filepath.Join(dir, "testdata", "fixture.go"), offendingFixture)
	// Non-source files are ignored.
	writeFile(t, filepath.Join(dir, "notes.txt"), offendingFixture)

	findings, err := auditPaths([]string{dir})
	if err != nil {
		t.Fatalf("auditPaths: %v", err)
	}
	if len(findings) != 1 {
		t.Fatalf("want exactly 1 finding (bad.py), got %d: %+v", len(findings), findings)
	}
	if filepath.Base(findings[0].File) != "bad.py" {
		t.Fatalf("want finding in bad.py, got %s", findings[0].File)
	}
}

func TestBudgetAuditPaths_SingleFile(t *testing.T) {
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.go")
	writeFile(t, bad, offendingFixture)
	// A sibling offending file that must NOT be scanned when a single file is
	// passed as the root.
	writeFile(t, filepath.Join(dir, "sibling.go"), offendingFixture)

	findings, err := auditPaths([]string{bad})
	if err != nil {
		t.Fatalf("auditPaths: %v", err)
	}
	if len(findings) != 1 || findings[0].File != bad {
		t.Fatalf("single-file audit: want 1 finding in %s, got %+v", bad, findings)
	}
}

func TestBudgetAuditPaths_CommaSeparatedRoots(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	writeFile(t, filepath.Join(dirA, "a.go"), offendingFixture)
	writeFile(t, filepath.Join(dirB, "b.go"), compliantFixture)

	findings, err := auditPaths([]string{dirA, " " + dirB})
	if err != nil {
		t.Fatalf("auditPaths: %v", err)
	}
	if len(findings) != 1 {
		t.Fatalf("want 1 finding across two roots, got %d: %+v", len(findings), findings)
	}
}

func TestBudgetAuditPaths_MissingRoot(t *testing.T) {
	if _, err := auditPaths([]string{filepath.Join(t.TempDir(), "does-not-exist")}); err == nil {
		t.Fatal("want error for missing root, got nil")
	}
}

func TestBudgetAuditPaths_EmptyRootSkipped(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "good.go"), compliantFixture)
	findings, err := auditPaths([]string{"", dir})
	if err != nil {
		t.Fatalf("auditPaths: %v", err)
	}
	if len(findings) != 0 {
		t.Fatalf("want 0 findings, got %+v", findings)
	}
}

func TestIsTestFile(t *testing.T) {
	cases := map[string]bool{
		"audit_test.go":  true,
		"test_budget.py": true,
		"budget_test.py": true,
		"foo.test.ts":    true,
		"foo.spec.jsx":   true,
		"handler.go":     false,
		"budget.py":      false,
		"component.tsx":  false,
	}
	for name, want := range cases {
		if got := isTestFile(name); got != want {
			t.Errorf("isTestFile(%q) = %v, want %v", name, got, want)
		}
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
