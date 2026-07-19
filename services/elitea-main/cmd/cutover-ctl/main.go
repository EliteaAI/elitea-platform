package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"text/tabwriter"
	"time"
)

const defaultBaseURL = "http://localhost:8080"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	baseURL := envOr("ELITEA_URL", defaultBaseURL)
	client := &http.Client{Timeout: 10 * time.Second}

	cmd := os.Args[1]
	switch cmd {
	case "status":
		cmdStatus(client, baseURL)
	case "summary":
		cmdSummary(client, baseURL)
	case "promote":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "usage: cutover-ctl promote <endpoint-pattern> [--force]")
			os.Exit(1)
		}
		force := len(os.Args) > 3 && os.Args[3] == "--force"
		cmdPromote(client, baseURL, os.Args[2], force)
	case "rollback":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "usage: cutover-ctl rollback <endpoint-pattern>")
			os.Exit(1)
		}
		cmdRollback(client, baseURL, os.Args[2])
	case "promote-all":
		force := len(os.Args) > 2 && os.Args[2] == "--force"
		cmdPromoteAll(client, baseURL, force)
	case "decommission-check":
		cmdDecommissionCheck(client, baseURL)
	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `cutover-ctl — EliteA migration endpoint promotion tool

Commands:
  status               List all endpoint states
  summary              Show counts per state
  promote <pattern>    Advance endpoint to next state (legacy→shadow→canary→go)
  promote-all          Advance ALL eligible endpoints to next state
  rollback <pattern>   Move endpoint back one state (go→canary→shadow→legacy)
  decommission-check   Verify all endpoints are in "go" state for decommission

Options:
  --force              Skip readiness gate checks

Environment:
  ELITEA_URL           Base URL of elitea-main (default: http://localhost:8080)
  ELITEA_SHADOW_URL    Shadow stats endpoint (default: ELITEA_URL/internal/shadow)
`)
}

type endpointState struct {
	Path      string    `json:"path"`
	Backend   string    `json:"backend"`
	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by"`
}

func cmdStatus(client *http.Client, baseURL string) {
	endpoints := fetchEndpoints(client, baseURL)
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintf(w, "ENDPOINT\tSTATE\tUPDATED\tBY\n")
	for _, ep := range endpoints {
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", ep.Path, ep.Backend, ep.UpdatedAt.Format(time.RFC3339), ep.UpdatedBy)
	}
	_ = w.Flush()
}

func cmdSummary(client *http.Client, baseURL string) {
	resp, err := client.Get(baseURL + "/internal/cutover/summary")
	if err != nil {
		fatal("failed to fetch summary: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var counts map[string]int
	if err := json.NewDecoder(resp.Body).Decode(&counts); err != nil {
		fatal("failed to decode summary: %v", err)
	}

	total := 0
	for _, v := range counts {
		total += v
	}

	fmt.Printf("Cutover Summary (%d endpoints):\n", total)
	fmt.Printf("  legacy:  %d\n", counts["legacy"])
	fmt.Printf("  shadow:  %d\n", counts["shadow"])
	fmt.Printf("  canary:  %d\n", counts["canary"])
	fmt.Printf("  go:      %d\n", counts["go"])

	if total > 0 {
		pct := float64(counts["go"]) / float64(total) * 100
		fmt.Printf("\nMigration progress: %.1f%%\n", pct)
	}
}

func cmdPromote(client *http.Client, baseURL, pattern string, force bool) {
	endpoints := fetchEndpoints(client, baseURL)

	matched := filterEndpoints(endpoints, pattern)
	if len(matched) == 0 {
		fatal("no endpoints match pattern: %s", pattern)
	}

	for _, ep := range matched {
		nextState := nextPromotionState(ep.Backend)
		if nextState == "" {
			fmt.Printf("  %s: already at 'go', nothing to promote\n", ep.Path)
			continue
		}

		if !force {
			if err := checkReadinessGate(client, baseURL, ep.Path, nextState); err != nil {
				fmt.Printf("  %s: BLOCKED — %v (use --force to override)\n", ep.Path, err)
				continue
			}
		}

		if err := setEndpointState(client, baseURL, ep.Path, nextState); err != nil {
			fmt.Printf("  %s: ERROR — %v\n", ep.Path, err)
			continue
		}
		fmt.Printf("  %s: %s → %s ✓\n", ep.Path, ep.Backend, nextState)
	}
}

func cmdPromoteAll(client *http.Client, baseURL string, force bool) {
	endpoints := fetchEndpoints(client, baseURL)
	promoted := 0
	blocked := 0

	for _, ep := range endpoints {
		nextState := nextPromotionState(ep.Backend)
		if nextState == "" {
			continue
		}

		if !force {
			if err := checkReadinessGate(client, baseURL, ep.Path, nextState); err != nil {
				fmt.Printf("  %s: BLOCKED — %v\n", ep.Path, err)
				blocked++
				continue
			}
		}

		if err := setEndpointState(client, baseURL, ep.Path, nextState); err != nil {
			fmt.Printf("  %s: ERROR — %v\n", ep.Path, err)
			continue
		}
		fmt.Printf("  %s: %s → %s ✓\n", ep.Path, ep.Backend, nextState)
		promoted++
	}

	fmt.Printf("\nPromoted: %d, Blocked: %d\n", promoted, blocked)
}

func cmdRollback(client *http.Client, baseURL, pattern string) {
	endpoints := fetchEndpoints(client, baseURL)
	matched := filterEndpoints(endpoints, pattern)
	if len(matched) == 0 {
		fatal("no endpoints match pattern: %s", pattern)
	}

	for _, ep := range matched {
		prevState := prevState(ep.Backend)
		if prevState == "" {
			fmt.Printf("  %s: already at 'legacy', nothing to rollback\n", ep.Path)
			continue
		}

		if err := setEndpointState(client, baseURL, ep.Path, prevState); err != nil {
			fmt.Printf("  %s: ERROR — %v\n", ep.Path, err)
			continue
		}
		fmt.Printf("  %s: %s → %s (rolled back) ✓\n", ep.Path, ep.Backend, prevState)
	}
}

func cmdDecommissionCheck(client *http.Client, baseURL string) {
	endpoints := fetchEndpoints(client, baseURL)
	allGo := true
	notGo := []string{}

	for _, ep := range endpoints {
		if ep.Backend != "go" {
			allGo = false
			notGo = append(notGo, fmt.Sprintf("  %s (%s)", ep.Path, ep.Backend))
		}
	}

	if allGo {
		fmt.Println("✓ All endpoints are in 'go' state. Safe to decommission legacy.")
		fmt.Println("\nDecommission steps:")
		fmt.Println("  1. Remove LEGACY_URL env var from elitea-main")
		fmt.Println("  2. Scale pylon_main replicas to 0")
		fmt.Println("  3. Monitor error rates for 24h")
		fmt.Println("  4. Delete pylon_main deployment")
		fmt.Println("  5. Clean up Redis cutover keys: DEL elitea:cutover:endpoints")
	} else {
		fmt.Printf("✗ %d endpoint(s) not yet migrated:\n", len(notGo))
		for _, s := range notGo {
			fmt.Println(s)
		}
		os.Exit(1)
	}
}

func nextPromotionState(current string) string {
	switch current {
	case "legacy":
		return "shadow"
	case "shadow":
		return "canary"
	case "canary":
		return "go"
	default:
		return ""
	}
}

func prevState(current string) string {
	switch current {
	case "go":
		return "canary"
	case "canary":
		return "shadow"
	case "shadow":
		return "legacy"
	default:
		return ""
	}
}

func checkReadinessGate(client *http.Client, baseURL, endpoint, targetState string) error {
	// Gate 1: health check
	resp, err := client.Get(baseURL + "/readyz")
	if err != nil || resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check failed")
	}
	_ = resp.Body.Close()

	// Gate 2: shadow match rate (for promoting to canary or go)
	if targetState == "canary" || targetState == "go" {
		shadowURL := envOr("ELITEA_SHADOW_URL", baseURL+"/internal/shadow")
		resp, err := client.Get(shadowURL + "/stats")
		if err == nil && resp.StatusCode == http.StatusOK {
			var stats struct {
				MatchRate float64 `json:"match_rate"`
				Total     int     `json:"total"`
			}
			_ = json.NewDecoder(resp.Body).Decode(&stats)
			_ = resp.Body.Close()

			if stats.Total > 10 && stats.MatchRate < 0.95 {
				return fmt.Errorf("shadow match rate %.1f%% < 95%% (need more parity)", stats.MatchRate*100)
			}
		}
	}

	return nil
}

func fetchEndpoints(client *http.Client, baseURL string) []endpointState {
	resp, err := client.Get(baseURL + "/internal/cutover/")
	if err != nil {
		fatal("failed to fetch endpoints: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var result struct {
		Endpoints []endpointState `json:"endpoints"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		fatal("failed to decode endpoints: %v", err)
	}
	return result.Endpoints
}

func setEndpointState(client *http.Client, baseURL, path, backend string) error {
	body := fmt.Sprintf(`{"path":%q,"backend":%q,"updated_by":"cutover-ctl"}`, path, backend)
	req, _ := http.NewRequest("PUT", baseURL+"/internal/cutover/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	return nil
}

func filterEndpoints(endpoints []endpointState, pattern string) []endpointState {
	var matched []endpointState
	for _, ep := range endpoints {
		if strings.Contains(ep.Path, pattern) || pattern == "*" || pattern == "all" {
			matched = append(matched, ep)
		}
	}
	return matched
}

func fatal(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "ERROR: "+format+"\n", args...)
	os.Exit(1)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
