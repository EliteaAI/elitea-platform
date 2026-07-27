package manifest

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var (
	idRe     = regexp.MustCompile(`^[A-Z]{3,8}-\d{3}$`)
	commitRe = regexp.MustCompile(`^[0-9a-f]{40}$`)
	dateRe   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	sourceRe = regexp.MustCompile(`^apps/elitea-ui/(.+):(\d+)(?:-(\d+))?$`)
	acceptRe = regexp.MustCompile(`^(GIVEN|WHEN|THEN|AND) `)
)

var domains = set("shell", "chat", "agents", "pipelines", "skills", "toolkits",
	"mcps", "apps", "credentials", "artifacts", "indexes", "secrets", "users",
	"tokens", "notifications", "analytics", "public", "admin")

var kinds = set("route", "behaviour", "integration", "permission", "shell", "visual")

var priorities = set("must", "should", "waived")

var statuses = set("todo", "in-progress", "implemented", "verified", "waived")

var verifyTypes = set("vitest", "playwright", "command")

var units = set(
	"F1", "F2", "F3", "F4", "F5", "P1", "T1", "T2", "W1", "W2", "W3",
	"S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8",
	"R1", "R2", "R3", "M1", "E1",
	"C1", "C2", "C3", "C4", "C5", "C6",
	"A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10",
	"A11", "A12", "A13", "A14", "A15",
	"W-shell", "V1", "V2", "V3", "V4", "X4", "X5", "X6",
)

// Tokens that flag implementation detail inside acceptance criteria.
// Acceptance must describe observable behaviour, not source structure.
var implDetailTokens = []string{"src/", ".jsx", ".tsx", ".test.", "useState", "useEffect", "Redux", "RTK "}

func set(ss ...string) map[string]bool {
	m := make(map[string]bool, len(ss))
	for _, s := range ss {
		m[s] = true
	}
	return m
}

// Validate applies every §8.3 schema rule plus evidence resolution against
// the pinned baseline checkout. It returns a list of problems; empty = valid.
func Validate(m *Manifest, baseline string) []string {
	var problems []string
	bad := func(format string, args ...any) {
		problems = append(problems, fmt.Sprintf(format, args...))
	}

	if m.Schema != "./manifest.schema.json" {
		bad("header: $schema must be ./manifest.schema.json, got %q", m.Schema)
	}
	if m.Version != 1 {
		bad("header: version must be 1, got %d", m.Version)
	}
	if m.GeneratedFrom.Repo != "apps/elitea-ui" {
		bad("header: generatedFrom.repo must be apps/elitea-ui, got %q", m.GeneratedFrom.Repo)
	}
	if !commitRe.MatchString(m.GeneratedFrom.Commit) {
		bad("header: generatedFrom.commit must be a 40-char sha, got %q", m.GeneratedFrom.Commit)
	}
	if !dateRe.MatchString(m.GeneratedFrom.Date) {
		bad("header: generatedFrom.date must be YYYY-MM-DD, got %q", m.GeneratedFrom.Date)
	}
	if len(m.Items) == 0 {
		bad("items: empty")
	}

	lineCounts := map[string]int{}
	seen := map[string]bool{}

	for _, it := range m.Items {
		id := it.ID
		if !idRe.MatchString(id) {
			bad("%s: id does not match ^[A-Z]{3,8}-\\d{3}$", id)
		}
		if seen[id] {
			bad("%s: duplicate id", id)
		}
		seen[id] = true
		if !domains[it.Domain] {
			bad("%s: unknown domain %q", id, it.Domain)
		}
		if !kinds[it.Kind] {
			bad("%s: unknown kind %q", id, it.Kind)
		}
		if !priorities[it.Priority] {
			bad("%s: unknown priority %q", id, it.Priority)
		}
		if len(it.Title) < 8 {
			bad("%s: title too short", id)
		}

		// evidence: non-empty, resolving file:line in the pinned baseline
		if len(it.Source) == 0 {
			bad("%s: source is empty — an item with no evidence is rejected", id)
		}
		for _, s := range it.Source {
			mm := sourceRe.FindStringSubmatch(s)
			if mm == nil {
				bad("%s: source %q is not apps/elitea-ui/<file>:<line>[-<line>]", id, s)
				continue
			}
			rel, lineS, endS := mm[1], mm[2], mm[3]
			n, ok := lineCounts[rel]
			if !ok {
				data, err := os.ReadFile(filepath.Join(baseline, filepath.FromSlash(rel)))
				if err != nil {
					lineCounts[rel] = -1
					n = -1
				} else {
					n = bytes.Count(data, []byte("\n")) + 1
					lineCounts[rel] = n
				}
			}
			if n < 0 {
				bad("%s: source file %q does not exist in baseline %s", id, rel, baseline)
				continue
			}
			line, _ := strconv.Atoi(lineS)
			end := line
			if endS != "" {
				end, _ = strconv.Atoi(endS)
			}
			if line < 1 || end < line || end > n {
				bad("%s: source %q lines out of range (file has %d lines)", id, s, n)
			}
		}

		// acceptance: GIVEN/WHEN/THEN, >=3 lines, no implementation detail
		if len(it.Acceptance) < 3 {
			bad("%s: acceptance has %d lines, need >=3", id, len(it.Acceptance))
		}
		hasWhen, hasThen := false, false
		for i, a := range it.Acceptance {
			if !acceptRe.MatchString(a) {
				bad("%s: acceptance line %d does not start with GIVEN/WHEN/THEN/AND", id, i+1)
			}
			if strings.HasPrefix(a, "WHEN ") {
				hasWhen = true
			}
			if strings.HasPrefix(a, "THEN ") {
				hasThen = true
			}
			for _, tok := range implDetailTokens {
				if strings.Contains(a, tok) {
					bad("%s: acceptance line %d contains implementation detail (%q)", id, i+1, tok)
				}
			}
		}
		if len(it.Acceptance) > 0 && !strings.HasPrefix(it.Acceptance[0], "GIVEN ") {
			bad("%s: acceptance must start with a GIVEN line", id)
		}
		if !hasWhen || !hasThen {
			bad("%s: acceptance must contain a WHEN line and a THEN line", id)
		}

		if !verifyTypes[it.Verify.Type] {
			bad("%s: unknown verify.type %q", id, it.Verify.Type)
		}
		if len(it.Verify.Command) < 4 {
			bad("%s: verify.command missing", id)
		}
		if len(it.Verify.TestID) < 3 {
			bad("%s: verify.testId missing", id)
		}
		if !units[it.Unit] {
			bad("%s: unknown unit %q (must be a §9.3 unit id)", id, it.Unit)
		}
		if !statuses[it.Status] {
			bad("%s: unknown status %q", id, it.Status)
		}
		if it.Coverage.File == "" {
			bad("%s: coverage.file missing", id)
		}
		if it.Coverage.Min < 0 || it.Coverage.Min > 100 {
			bad("%s: coverage.min %d out of range", id, it.Coverage.Min)
		}

		// waiver rules: priority waived <=> non-null waiver with all fields
		if it.Priority == "waived" {
			if it.Waiver == nil {
				bad("%s: priority waived requires a non-null waiver", id)
			}
		} else if it.Waiver != nil {
			bad("%s: waiver must be null unless priority is waived", id)
		}
		if it.Waiver != nil {
			w := it.Waiver
			if w.Reason == "" || w.DecidedBy == "" || w.ReplacesBehaviour == "" || !dateRe.MatchString(w.Date) {
				bad("%s: waiver object incomplete (need reason, decidedBy, date YYYY-MM-DD, replacesBehaviour)", id)
			}
		}
		if it.Status == "waived" && it.Priority != "waived" {
			bad("%s: status waived requires priority waived", id)
		}
	}
	return problems
}
