package skillpublish

// The parts of the publish gate that are pure functions of their inputs. They
// are tested without a database so `task test` exercises them on every run —
// the behaviour suite next door needs ELITEA_TEST_DATABASE_URL and skips
// without it.

import "testing"

func passingRow() skillVersionRow {
	return skillVersionRow{
		VersionID:        11,
		SkillID:          3,
		SkillName:        "pr-reviewer",
		SkillDescription: "Helps reviewers analyze pull request diffs and generates a concise risk summary.",
		Instructions:     "Review the pull request diff, summarise the risky changes, and propose concrete follow-up actions for the reviewer before merging.",
		Tags:             []string{"review"},
	}
}

func TestDeterministicChecksPassAGoodSkill(t *testing.T) {
	result := runDeterministicChecks(passingRow(), "v1.0-initial", "Development", false)
	if result.Status != "PASS" {
		t.Fatalf("status = %s, want PASS (critical %v, warnings %v)", result.Status, result.CriticalIssues, result.Warnings)
	}
	if result.AIValidationRun {
		t.Error("ai_validation_available is true, but no AI validation runs in this stack")
	}
}

func TestDeterministicChecksFailOnBlockingContent(t *testing.T) {
	cases := []struct {
		name        string
		mutate      func(*skillVersionRow)
		versionName string
		category    string
		nameTaken   bool
		wantField   string
	}{
		{"missing instructions", func(r *skillVersionRow) { r.Instructions = "" }, "v1.0-initial", "", false, "instructions"},
		{"short instructions", func(r *skillVersionRow) { r.Instructions = "do stuff" }, "v1.0-initial", "", false, "instructions"},
		{"placeholder instructions", func(r *skillVersionRow) { r.Instructions += " TODO finish this" }, "v1.0-initial", "", false, "instructions"},
		{"short description", func(r *skillVersionRow) { r.SkillDescription = "helps" }, "v1.0-initial", "", false, "description"},
		{"no tags", func(r *skillVersionRow) { r.Tags = nil }, "v1.0-initial", "", false, "tags"},
		{"unknown category", func(*skillVersionRow) {}, "v1.0-initial", "Nonsense", false, "category"},
		{"empty version name", func(*skillVersionRow) {}, "", "", false, "version_name"},
		{"illegal version name", func(*skillVersionRow) {}, "v1 initial!", "", false, "version_name"},
		{"duplicate version name", func(*skillVersionRow) {}, "v1.0-initial", "", true, "version_name"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			row := passingRow()
			testCase.mutate(&row)
			result := runDeterministicChecks(row, testCase.versionName, testCase.category, testCase.nameTaken)
			if result.Status != "FAIL" {
				t.Fatalf("status = %s, want FAIL", result.Status)
			}
			found := false
			for _, item := range result.CriticalIssues {
				if item.Field == testCase.wantField {
					found = true
				}
			}
			if !found {
				t.Errorf("no critical issue on %q; got %v", testCase.wantField, result.CriticalIssues)
			}
			if result.Counts["critical"] != len(result.CriticalIssues) {
				t.Errorf("counts.critical = %d, want %d", result.Counts["critical"], len(result.CriticalIssues))
			}
		})
	}
}

// A secret in the instructions warns but does not block — matching the
// reference, which treats it as a quality signal rather than a gate.
func TestSecretInInstructionsWarns(t *testing.T) {
	row := passingRow()
	row.Instructions += " Use api_key: sk-abcdefghijklmnopqrstuvwxyz012345 when calling the service."
	result := runDeterministicChecks(row, "v1.0-initial", "", false)
	if result.Status != "WARN" {
		t.Fatalf("status = %s, want WARN (critical %v)", result.Status, result.CriticalIssues)
	}
	if len(result.Warnings) == 0 || result.Warnings[0].Field != "instructions" {
		t.Errorf("warnings = %v, want one on instructions", result.Warnings)
	}
}

func TestValidationTokenPinsTheContentItApproved(t *testing.T) {
	handler := NewHandler(nil)
	hash := contentHash("pr-reviewer", "description", "instructions")
	token := handler.issueValidationToken("11", hash)

	if !handler.verifyValidationToken(token, "11", hash) {
		t.Fatal("a freshly issued token did not verify")
	}
	if handler.verifyValidationToken(token, "12", hash) {
		t.Error("a token issued for version 11 verified against version 12")
	}
	if handler.verifyValidationToken(token, "11", contentHash("pr-reviewer", "description", "edited instructions")) {
		t.Error("a token verified after the content it approved changed")
	}
	if handler.verifyValidationToken("", "11", hash) {
		t.Error("an empty token verified")
	}
	// Another process's token must not be accepted here.
	if NewHandler(nil).verifyValidationToken(token, "11", hash) {
		t.Error("a token minted with a different secret verified")
	}
}

func TestApplyCategoryToTags(t *testing.T) {
	cases := []struct {
		name     string
		tags     []string
		category string
		want     []string
	}{
		{"named category is appended", []string{"review"}, "Development", []string{"review", "Development"}},
		{"category replaces an existing one", []string{"review", "DevOps"}, "Development", []string{"review", "Development"}},
		{"case-insensitive names canonicalise", []string{"review"}, "development", []string{"review", "Development"}},
		{"no category keeps the existing one", []string{"review", "DevOps"}, "", []string{"review", "DevOps"}},
		{"no category at all falls back", []string{"review"}, "", []string{"review", "Other"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := applyCategoryToTags(testCase.tags, testCase.category)
			if len(got) != len(testCase.want) {
				t.Fatalf("got %v, want %v", got, testCase.want)
			}
			for index := range got {
				if got[index] != testCase.want[index] {
					t.Fatalf("got %v, want %v", got, testCase.want)
				}
			}
		})
	}
}

func TestProjectSchemaRejectsNonNumericSegments(t *testing.T) {
	for _, raw := range []string{`1"; DROP SCHEMA public; --`, "abc", "-1", "0", "", "1 OR 1=1"} {
		if _, ok := projectSchema(raw); ok {
			t.Errorf("projectSchema(%q) was accepted; a non-numeric id must never reach an interpolated identifier", raw)
		}
	}
	if schema, ok := projectSchema("42"); !ok || schema != "p_42" {
		t.Errorf("projectSchema(\"42\") = %q, %v; want p_42, true", schema, ok)
	}
}
