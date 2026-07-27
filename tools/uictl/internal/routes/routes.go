// Package routes extracts the OLD app's mounted route patterns from the
// pinned apps/elitea-ui baseline (routes.js + ProtectedRoutes.jsx +
// router.jsx) and diffs them against the parity manifest's ROUTE items.
//
// The new-app side of the comparison is a second input (--new-routes, a JSON
// []string export produced by the new router once unit R1 exists) — it is
// deliberately not hardcoded here.
package routes

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Extraction struct {
	// Mounted is the set of reachable route patterns, normalised the same
	// way the manifest titles are ("/", "/settings (index)", "/*", "*", ...).
	Mounted map[string]bool
	// DeclaredOnly maps RouteDefinitions patterns that are declared but never
	// mounted (the §8.1 latent-anomaly surface) to their definition key.
	DeclaredOnly map[string]string
}

var (
	defRe         = regexp.MustCompile(`^\s*(\w+):\s*'([^']*)',?\s*(//.*)?$`)
	mountKeyRe    = regexp.MustCompile(`path:\s*RouteDefinitions\.(\w+)`)
	mountAttrRe   = regexp.MustCompile(`path=\{RouteDefinitions\.(\w+)\}`)
	literalAttrRe = regexp.MustCompile(`path=(?:"([^"]+)"|\{'([^']+)'\})`)
)

// Declared-only patterns exempt from needing an anomaly manifest item,
// because a mounted pattern already covers their path space per §8.1 notes:
//   - AppsApplications /apps/applications and AppsCatalog /apps/catalog are
//     covered by ROUTE-039 (/apps/:tab, "covers /apps/applications and
//     /apps/catalog");
//   - EditConfiguration /settings/edit-configuration/:uid is superseded by
//     the mounted /settings/edit-configuration/:credential_uid (ROUTE-065:
//     "the mounted route wins").
var declaredOnlyExempt = map[string]bool{
	"AppsApplications":  true,
	"AppsCatalog":       true,
	"EditConfiguration": true,
}

func ExtractBaseline(baseline string) (*Extraction, error) {
	routesJS, err := os.ReadFile(filepath.Join(baseline, "src", "routes.js"))
	if err != nil {
		return nil, fmt.Errorf("read routes.js: %w", err)
	}
	protected, err := os.ReadFile(filepath.Join(baseline, "src", "[fsd]", "app", "routes", "ProtectedRoutes.jsx"))
	if err != nil {
		return nil, fmt.Errorf("read ProtectedRoutes.jsx: %w", err)
	}
	router, err := os.ReadFile(filepath.Join(baseline, "src", "[fsd]", "app", "routes", "router.jsx"))
	if err != nil {
		return nil, fmt.Errorf("read router.jsx: %w", err)
	}

	// 1. RouteDefinitions: key -> pattern
	defs := map[string]string{}
	inBlock := false
	for _, line := range strings.Split(string(routesJS), "\n") {
		if strings.Contains(line, "const RouteDefinitions = {") {
			inBlock = true
			continue
		}
		if inBlock && strings.HasPrefix(strings.TrimSpace(line), "};") {
			break
		}
		if !inBlock {
			continue
		}
		if m := defRe.FindStringSubmatch(line); m != nil {
			defs[m[1]] = m[2]
		}
	}
	if len(defs) == 0 {
		return nil, fmt.Errorf("no RouteDefinitions parsed from routes.js")
	}

	mounted := map[string]bool{}
	mountedKeys := map[string]bool{}

	addKey := func(key string) error {
		p, ok := defs[key]
		if !ok {
			return fmt.Errorf("ProtectedRoutes mounts RouteDefinitions.%s which is not declared in routes.js", key)
		}
		mounted[p] = true
		mountedKeys[key] = true
		return nil
	}

	// 2. ProtectedRoutes.jsx: RouteDefinitions-keyed mounts + literals
	prot := string(protected)
	for _, m := range mountKeyRe.FindAllStringSubmatch(prot, -1) {
		if err := addKey(m[1]); err != nil {
			return nil, err
		}
	}
	for _, m := range mountAttrRe.FindAllStringSubmatch(prot, -1) {
		if err := addKey(m[1]); err != nil {
			return nil, err
		}
	}
	for _, m := range literalAttrRe.FindAllStringSubmatch(prot, -1) {
		lit := m[1]
		if lit == "" {
			lit = m[2]
		}
		switch {
		case lit == ":version":
			// version-append rule handled below
		case lit == "*" || strings.HasPrefix(lit, "/"):
			mounted[lit] = true
		default:
			// relative literal = Settings child
			mounted["/settings/"+lit] = true
		}
	}
	// index routes
	if strings.Contains(prot, "<IndexRoute />") {
		mounted["/"] = true
	}
	if strings.Contains(prot, `<Navigate`) && strings.Contains(prot, `to="model-configuration"`) {
		mounted["/settings (index)"] = true
	}
	// version-append rule (ProtectedRoutes.jsx: path.endsWith('/:agentId') || path.endsWith('/:skillId'))
	if strings.Contains(prot, ".endsWith('/:agentId')") {
		for p := range mounted {
			if strings.HasSuffix(p, "/:agentId") || strings.HasSuffix(p, "/:skillId") {
				mounted[p+"/:version"] = true
			}
		}
	}

	// 3. router.jsx: eager auth callback + shell splat
	rt := string(router)
	for _, m := range mountAttrRe.FindAllStringSubmatch(rt, -1) {
		if err := addKey(m[1]); err != nil {
			return nil, err
		}
	}
	for _, m := range literalAttrRe.FindAllStringSubmatch(rt, -1) {
		lit := m[1]
		if lit == "" {
			lit = m[2]
		}
		if lit == "*" || strings.HasPrefix(lit, "/") {
			mounted[lit] = true
		}
	}

	// 4. declared-but-never-mounted patterns
	declaredOnly := map[string]string{}
	for key, p := range defs {
		if !mountedKeys[key] && !mounted[p] {
			declaredOnly[p] = key
		}
	}
	return &Extraction{Mounted: mounted, DeclaredOnly: declaredOnly}, nil
}

var titleMountedRe = regexp.MustCompile("^Route `([^`]+)`")
var titleAnomalyRe = regexp.MustCompile("^Route anomaly `([^`]+)`")

// DiffPatterns compares the baseline extraction with the manifest's route
// item titles (formats "Route `<pattern>` ..." and "Route anomaly `<pattern>` ...").
func DiffPatterns(ext *Extraction, titles []string) []string {
	var problems []string
	manifestMounted := map[string]bool{}
	manifestAnomaly := map[string]bool{}
	for _, t := range titles {
		if m := titleAnomalyRe.FindStringSubmatch(t); m != nil {
			manifestAnomaly[m[1]] = true
			continue
		}
		if m := titleMountedRe.FindStringSubmatch(t); m != nil {
			manifestMounted[m[1]] = true
			continue
		}
		problems = append(problems, fmt.Sprintf("route item title %q does not follow the Route `<pattern>` convention", t))
	}

	for _, p := range sorted(ext.Mounted) {
		if !manifestMounted[p] {
			problems = append(problems, fmt.Sprintf("baseline mounts %q but the manifest has no ROUTE item for it", p))
		}
	}
	for p := range manifestMounted {
		if !ext.Mounted[p] {
			problems = append(problems, fmt.Sprintf("manifest claims route %q which the baseline does not mount", p))
		}
	}
	for p := range manifestAnomaly {
		if _, ok := ext.DeclaredOnly[p]; !ok {
			problems = append(problems, fmt.Sprintf("manifest claims anomaly %q but the baseline does not declare it as unmounted", p))
		}
	}
	for p, key := range ext.DeclaredOnly {
		if !manifestAnomaly[p] && !declaredOnlyExempt[key] {
			problems = append(problems, fmt.Sprintf("baseline declares-but-never-mounts %q (%s) and the manifest has no anomaly item for it", p, key))
		}
	}
	sort.Strings(problems)
	return problems
}

// LoadNewRoutes reads the new app's exported route patterns ([]string JSON).
func LoadNewRoutes(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read new-routes export: %w", err)
	}
	var patterns []string
	if err := json.Unmarshal(data, &patterns); err != nil {
		return nil, fmt.Errorf("new-routes export must be a JSON array of route pattern strings: %w", err)
	}
	return patterns, nil
}

// DiffNewApp compares the baseline mounted set with the new app's exported
// patterns. Exact set equality is required.
func DiffNewApp(ext *Extraction, newPatterns []string) []string {
	var problems []string
	np := map[string]bool{}
	for _, p := range newPatterns {
		np[p] = true
	}
	for _, p := range sorted(ext.Mounted) {
		if !np[p] {
			problems = append(problems, fmt.Sprintf("new app is missing baseline route %q", p))
		}
	}
	for p := range np {
		if !ext.Mounted[p] {
			problems = append(problems, fmt.Sprintf("new app mounts %q which the baseline does not", p))
		}
	}
	sort.Strings(problems)
	return problems
}

func sorted(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
