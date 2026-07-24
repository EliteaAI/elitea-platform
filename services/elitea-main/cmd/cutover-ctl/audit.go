package main

import (
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// budget-status-audit (spec §4.1, task BF0.8):
//
// Before the big-bang cutover, every budget/quota call site in the consumer
// codebases MUST treat HTTP 402 (budget_exceeded / insufficient_quota)
// identically to 429. LiteLLM returned 429 for BOTH rate-limit and budget
// exhaustion; the gateway splits them — budget exhaustion becomes 402, while
// request-throughput rate limiting stays 429. Any call site that still branches
// on 429 ALONE for budget exhaustion will silently mishandle the gateway's 402.
//
// This audit is a heuristic static scan. A "budget-429 site" is a source line
// referencing the status code 429 whose surrounding window also mentions a
// budget/quota keyword. Such a site is compliant only when a 402 also appears in
// the same window (i.e. the branch accepts both codes). A pure rate-limit 429
// branch — one with no budget/quota keyword nearby — is intentionally ignored,
// because rate limiting legitimately keeps returning 429.

// auditWindow is the number of lines on each side of a 429 match that are
// considered "the same call site" when looking for a budget/quota keyword and a
// companion 402.
const auditWindow = 5

var (
	// code429 / code402 match the status code as a standalone number token so
	// that "4290" or "1429" do not spuriously match.
	code429 = regexp.MustCompile(`\b429\b`)
	code402 = regexp.MustCompile(`\b402\b`)

	// budgetKeyword flags a window as budget/quota-related. Deliberately broad:
	// "budget" and "quota" together cover insufficient_quota, budget_exceeded,
	// over_budget, quota_exceeded, etc. Case-insensitive.
	budgetKeyword = regexp.MustCompile(`(?i)budget|quota`)
)

// auditableExtensions is the set of source file extensions the audit scans.
var auditableExtensions = map[string]bool{
	".go":  true,
	".py":  true,
	".js":  true,
	".jsx": true,
	".ts":  true,
	".tsx": true,
	".mjs": true,
	".cjs": true,
}

// skipDirs are directory names never descended into during the walk.
var skipDirs = map[string]bool{
	".git":         true,
	"vendor":       true,
	"node_modules": true,
	"testdata":     true,
	"dist":         true,
	"build":        true,
	".next":        true,
	"coverage":     true,
	"__pycache__":  true,
}

type auditFinding struct {
	File    string
	Line    int
	Snippet string
}

// isTestFile reports whether path is a test file. Test files are excluded from
// the audit: they routinely embed intentionally-non-compliant budget fixtures
// (a 429 branch with no companion 402, including this tool's own audit_test.go),
// and the contract change targets production call sites, not test scaffolding.
func isTestFile(path string) bool {
	base := filepath.Base(path)
	switch {
	case strings.HasSuffix(base, "_test.go"):
		return true
	case strings.HasSuffix(base, "_test.py"), strings.HasPrefix(base, "test_"):
		return true
	case strings.HasSuffix(base, ".test.js"), strings.HasSuffix(base, ".test.ts"),
		strings.HasSuffix(base, ".test.jsx"), strings.HasSuffix(base, ".test.tsx"):
		return true
	case strings.HasSuffix(base, ".spec.js"), strings.HasSuffix(base, ".spec.ts"),
		strings.HasSuffix(base, ".spec.jsx"), strings.HasSuffix(base, ".spec.tsx"):
		return true
	}
	return false
}

// auditContent scans one file's contents and returns the offending budget-429
// sites: lines referencing 429 whose window is budget/quota-related but has no
// companion 402. The returned findings carry only Line and Snippet; the caller
// fills in File.
func auditContent(content string) []auditFinding {
	lines := strings.Split(content, "\n")
	var findings []auditFinding

	for i, line := range lines {
		if !code429.MatchString(line) {
			continue
		}

		lo := i - auditWindow
		if lo < 0 {
			lo = 0
		}
		hi := i + auditWindow + 1
		if hi > len(lines) {
			hi = len(lines)
		}
		window := strings.Join(lines[lo:hi], "\n")

		// Only a budget/quota-context 429 is in scope; a bare rate-limit 429 is
		// allowed to stay 429.
		if !budgetKeyword.MatchString(window) {
			continue
		}
		// Compliant when the same site also handles 402.
		if code402.MatchString(window) {
			continue
		}

		findings = append(findings, auditFinding{
			Line:    i + 1,
			Snippet: strings.TrimSpace(line),
		})
	}

	return findings
}

// auditPaths walks each root and returns every offending site found in scanned
// source files — a budget/quota context handling 429 with no companion 402.
func auditPaths(roots []string) ([]auditFinding, error) {
	var findings []auditFinding

	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}

		info, err := os.Stat(root)
		if err != nil {
			return nil, fmt.Errorf("path %q: %w", root, err)
		}

		walkRoot := root
		if !info.IsDir() {
			// A single file was passed directly.
			walkRoot = filepath.Dir(root)
		}

		err = filepath.WalkDir(walkRoot, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				if skipDirs[d.Name()] {
					return fs.SkipDir
				}
				return nil
			}
			// When a single file was requested, restrict to exactly that file.
			if !info.IsDir() && path != root {
				return nil
			}
			if !auditableExtensions[strings.ToLower(filepath.Ext(path))] {
				return nil
			}
			if isTestFile(path) {
				return nil
			}

			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return fmt.Errorf("read %q: %w", path, readErr)
			}

			for _, f := range auditContent(string(data)) {
				f.File = path
				findings = append(findings, f)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	sort.Slice(findings, func(i, j int) bool {
		if findings[i].File == findings[j].File {
			return findings[i].Line < findings[j].Line
		}
		return findings[i].File < findings[j].File
	})
	return findings, nil
}

// cmdBudgetStatusAudit is the `cutover-ctl budget-status-audit` entrypoint. It
// exits 0 only when every budget/quota call site under --paths treats 402
// identically to 429; otherwise it lists the offending sites and exits 1.
func cmdBudgetStatusAudit(args []string) {
	fs := flag.NewFlagSet("budget-status-audit", flag.ExitOnError)
	pathsFlag := fs.String("paths", "", "comma-separated roots to scan (e.g. services/elitea-main,elitea-sdk)")
	_ = fs.Parse(args)

	if strings.TrimSpace(*pathsFlag) == "" {
		fmt.Fprintln(os.Stderr, "usage: cutover-ctl budget-status-audit --paths <root>[,<root>...]")
		os.Exit(2)
	}

	roots := strings.Split(*pathsFlag, ",")
	findings, err := auditPaths(roots)
	if err != nil {
		fatal("budget-status-audit: %v", err)
	}

	if len(findings) == 0 {
		fmt.Printf("✓ budget-status-audit clean: every budget/quota call site under %s treats 402 identically to 429\n", *pathsFlag)
		return
	}

	// Group offending sites by file for a readable report.
	byFile := map[string][]auditFinding{}
	order := []string{}
	for _, f := range findings {
		if _, seen := byFile[f.File]; !seen {
			order = append(order, f.File)
		}
		byFile[f.File] = append(byFile[f.File], f)
	}

	fmt.Fprintf(os.Stderr, "✗ budget-status-audit found %d budget-429 site(s) with no companion 402 in %d file(s):\n",
		len(findings), len(order))
	for _, file := range order {
		for _, f := range byFile[file] {
			fmt.Fprintf(os.Stderr, "  %s:%d: %s\n", f.File, f.Line, f.Snippet)
		}
	}
	fmt.Fprintln(os.Stderr, "\nEach site must treat HTTP 402 (budget_exceeded/insufficient_quota) identically to 429 (spec §4.1).")
	os.Exit(1)
}
