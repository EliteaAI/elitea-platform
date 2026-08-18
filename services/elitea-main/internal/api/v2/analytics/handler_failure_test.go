package analytics

// The test that fails against the shipped behaviour (issue #303).
//
// Before this change every route here answered 200 whatever the repository did,
// because the error was discarded (`summary, _ := h.repo.GetUsageSummary(...)`)
// and the KPI block was a literal of zeros. So the obvious test — "GET
// /analytics returns 200" — passed against a handler whose every query raised
// undefined_table, and would have gone on passing forever. Status alone cannot
// discriminate here; these cases assert what the response SAYS.
//
// Two properties are pinned:
//   1. A repository error must not produce a 2xx. Restore the `_` and every
//      case in TestUsageSurfacesRepositoryFailure goes red.
//   2. A successful read must not carry counts nobody computed. Put the
//      hardcoded `"unique_users": 0, "tool_runs": 0, ...` block back and
//      TestSuccessfulResponseCarriesNoUncomputedCounts goes red.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	domain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/analytics"
)

// stubRepo answers every method with the same outcome, so one case covers the
// route under test without hiding which method it exercised.
type stubRepo struct {
	err     error
	summary domain.UsageSummary
}

func (s stubRepo) GetUsageSummary(_ context.Context, _ domain.QueryParams) (domain.UsageSummary, error) {
	return s.summary, s.err
}

func (s stubRepo) GetAgentAnalytics(_ context.Context, _ domain.QueryParams) ([]domain.AgentAnalytics, error) {
	return nil, s.err
}

func (s stubRepo) GetToolAnalytics(_ context.Context, _ domain.QueryParams) ([]domain.ToolAnalytics, error) {
	return nil, s.err
}

func (s stubRepo) GetUserActivity(_ context.Context, _ domain.QueryParams) ([]domain.UserActivity, error) {
	return nil, s.err
}

func do(t *testing.T, repo Repository, target string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	NewHandler(repo).Routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON (%q): %v", rec.Body.String(), err)
	}
	return rec, body
}

func TestUsageSurfacesRepositoryFailure(t *testing.T) {
	t.Parallel()

	routes := []string{
		"/",
		"/agents",
		"/agents?application_id=7", // the detail branch, which used to answer
		"/tools",                   // before consulting the repository at all
		"/tools?toolkit_id=3",
		"/users",
		"/users?user_id=9",
	}

	for _, route := range routes {
		t.Run(route, func(t *testing.T) {
			t.Parallel()
			repo := stubRepo{err: fmt.Errorf("connection refused")}
			rec, body := do(t, repo, route)

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status %d for a failed repository read, want 500", rec.Code)
			}
			// Not merely a non-200: the body must not present the failure as
			// data. A zero KPI or an empty item list here is the original
			// defect wearing a different status code.
			if _, ok := body["kpis"]; ok {
				t.Fatalf("failure response carries a kpis block: %v", body)
			}
			if _, ok := body["items"]; ok {
				t.Fatalf("failure response carries an items list: %v", body)
			}
			if body["error"] == nil || body["error"] == "" {
				t.Fatalf("failure response has no error message: %v", body)
			}
		})
	}
}

// A figure with no producer must be reported as such, not as a transient
// failure an operator will retry forever.
func TestNoSourceFailureSaysSo(t *testing.T) {
	t.Parallel()

	repo := stubRepo{err: domain.NoSourceError("usage summary", "total_tokens has no producer")}
	rec, body := do(t, repo, "/")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500", rec.Code)
	}
	detail, _ := body["detail"].(string)
	if detail == "" {
		t.Fatalf("no-source failure carries no detail: %v", body)
	}
	// The reason has to reach the response, because the browser is the only
	// place this endpoint's failure has ever been observable from.
	if !errors.Is(domain.NoSourceError("x", "y"), domain.ErrNoSource) {
		t.Fatal("NoSourceError does not wrap ErrNoSource")
	}
	if got := body["error"]; got == "failed to query analytics" {
		t.Fatalf("a permanent absence is reported as a transient query failure: %v", got)
	}
}

// The other half: when the repository DOES answer, the response must contain
// only figures that came from it.
func TestSuccessfulResponseCarriesNoUncomputedCounts(t *testing.T) {
	t.Parallel()

	repo := stubRepo{summary: domain.UsageSummary{TotalRuns: 12, TotalTokens: 3400, TotalCost: 1.25}}
	rec, body := do(t, repo, "/")

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	kpis, ok := body["kpis"].(map[string]any)
	if !ok {
		t.Fatalf("no kpis block: %v", body)
	}

	// Every key that used to be hardcoded to 0. None of them had a query behind
	// it, and "absent" is the only honest report of a figure nothing measured —
	// present-and-zero is a count.
	for _, fabricated := range []string{
		"unique_users", "total_project_users", "ai_active_users",
		"adoption_rate", "tool_runs", "chat_msgs",
	} {
		if v, present := kpis[fabricated]; present {
			t.Errorf("kpis.%s is present as %v, but nothing computes it — an absent key is detectable, a zero is a claim", fabricated, v)
		}
	}

	// And what IS present must be the repository's own numbers, so the block
	// cannot drift back into literals.
	if kpis["llm_calls"] != float64(12) || kpis["total_tokens"] != float64(3400) || kpis["total_cost"] != 1.25 {
		t.Fatalf("kpis do not carry the repository's values: %v", kpis)
	}
}

// The detail branches used to answer with an eight-field zero KPI block before
// touching the repository. Their success path must not resurrect it.
func TestDetailBranchesCarryNoZeroKpiBlock(t *testing.T) {
	t.Parallel()

	for _, route := range []string{"/agents?application_id=7", "/tools?toolkit_id=3", "/users?user_id=9"} {
		t.Run(route, func(t *testing.T) {
			t.Parallel()
			rec, body := do(t, stubRepo{}, route)
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d, want 200", rec.Code)
			}
			if kpis, present := body["kpis"]; present {
				t.Fatalf("detail response still carries an uncomputed kpis block: %v", kpis)
			}
		})
	}
}
