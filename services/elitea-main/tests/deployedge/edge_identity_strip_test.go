// This file gates the edge identity-header strip (#368, guarding the fix from
// #326).
//
// elitea-main accepts X-Auth-Type + X-Auth-ID as a finished identity from any
// address inside auth.form.yml's trusted_proxy_cidrs, which is the whole compose
// network. The browser edge sits on that network. Without the
// `strip-client-identity` middleware a caller with no credential at all chooses
// its own user id, on every route that does not carry the #302 membership gate.
// Measured on a real stack before the fix: `curl -H 'X-Auth-ID: 4'` returned
// that user's record with HTTP 200.
//
// WHAT THIS GATE ADDS, AND WHAT IT DOES NOT DUPLICATE.
//
// TestEveryRouterMiddlewareResolves in edge_middlewares_test.go already fails
// when the DEFINITION disappears while a router still names it. Three edits it
// cannot see:
//
//	1. dropping `strip-client-identity` from a router's middlewares list;
//	2. deleting the reference and the definition together;
//	3. removing header names from the list, which leaves a middleware that
//	   still resolves and still strips almost everything.
//
// Each of the three restores the bypass. This gate fails on all three.
//
// The runtime proof is stronger and lives elsewhere:
// deploy/scripts/standalone-stack.sh `check` forges a header against a live
// stack and requires a 401/403, requires a real personal access token on the
// same route to answer 200 with its OWN user, and requires a forged header not
// to override a genuine bearer. apps/elitea-web/scripts/chat-stream-e2e.sh runs
// that step, so the CI — Web E2E workflow executes it on every pull request that
// touches deploy/** or services/elitea-main/**.
//
// That runtime proof reaches ONE of the two files: the chat-stream stack mounts
// dynamic.e2e.yml. No stack in continuous integration mounts dynamic.yml, so
// this static gate is what covers it. Both are checked here, and the two must
// agree — a fix in only one file leaves whichever stack mounts the other wide
// open, which is the #326 defect itself.
//
// RUN IT WITH -count=1, for the reason stated in edge_middlewares_test.go: the
// YAML this file reads lives in deploy/, outside this module.
package deployedge_test

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// stripMiddlewareName is the middleware every browser-edge router that reaches
// elitea-main must carry.
const stripMiddlewareName = "strip-client-identity"

// protectedService is the load-balancer name of the process that trusts these
// headers. Routers are selected by the service they reach and not by their own
// names, so a NEW router added to either file is covered from the day it is
// written.
const protectedService = "elitea-main"

// browserEdgeFiles are the two files #326 fixed. Both front elitea-main from a
// browser and NEITHER runs a forwardAuth, so no identity header arriving at
// them is ever legitimate client input.
//
// deploy/runtime/platform-edge-dynamic.yml is deliberately not in this list. It
// has a different shape: it authenticates with forwardAuth and then PROJECTS
// verified identity headers, so the same names are legitimate on the way out of
// its middleware chain. Holding it to the rule below would assert something
// that is not true of it.
var browserEdgeFiles = []string{
	"deploy/traefik/dynamic.yml",
	"deploy/traefik/dynamic.e2e.yml",
}

// requiredStrippedHeaders is the floor, not the ceiling: each name here must be
// deleted, and a file may delete more. It stops a silent narrowing of the list.
//
// The X-Auth-* names are what internal/api/middleware/auth.go reads through
// tryTrustedProxyHeaders. The X-Elitea-* names are the elitea-main to gateway
// identity projection, never a browser input; they are listed so that a future
// route through either edge cannot inherit a client-chosen project or tenant.
var requiredStrippedHeaders = []string{
	"X-Auth-Type",
	"X-Auth-ID",
	"X-Auth-User-ID",
	"X-Auth-Reference",
	"X-Auth-Avatar",
	"X-Auth-Avatar-State",
	"X-Auth-Session-Id",
	"X-Auth-Session-Name",
	"X-Auth-Session-Endpoint",
	"X-Elitea-Identity-Signature",
	"X-Elitea-Project-Id",
	"X-Elitea-User-Id",
	"X-Elitea-Tenant-Id",
}

// edgeWithHeaders re-reads the edge YAML with the header fields this gate needs.
// dynamicConfig in edge_middlewares_test.go models middleware CHAINS and stops
// there; adding headers to it would change what that gate parses.
type edgeWithHeaders struct {
	HTTP struct {
		Routers map[string]struct {
			Service     string   `yaml:"service"`
			Middlewares []string `yaml:"middlewares"`
		} `yaml:"routers"`
		Middlewares map[string]struct {
			Headers struct {
				CustomRequestHeaders map[string]string `yaml:"customRequestHeaders"`
			} `yaml:"headers"`
		} `yaml:"middlewares"`
	} `yaml:"http"`
}

func parseEdgeWithHeaders(t *testing.T, path string) edgeWithHeaders {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var parsed edgeWithHeaders
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("parse %s as Traefik dynamic configuration: %v", path, err)
	}
	return parsed
}

// TestBrowserEdgesStripClientIdentity is the gate.
func TestBrowserEdgesStripClientIdentity(t *testing.T) {
	root := repoRoot(t)

	// Keyed by file, so the cross-file comparison below reports which side moved.
	strippedPerFile := map[string][]string{}

	for _, relative := range browserEdgeFiles {
		absolute := filepath.Join(root, relative)
		if _, err := os.Stat(absolute); err != nil {
			t.Fatalf(
				"%s does not exist. The edge moved and this gate stopped "+
					"gating. Update browserEdgeFiles in this file.",
				relative,
			)
		}
		parsed := parseEdgeWithHeaders(t, absolute)

		// 1. The middleware must be defined, and it must delete every required
		//    name. Traefik deletes a header whose customRequestHeaders value is
		//    empty; a NON-empty value would set the header instead, which is the
		//    opposite of the control.
		definition, defined := parsed.HTTP.Middlewares[stripMiddlewareName]
		if !defined {
			t.Errorf(
				"%s defines no %q middleware, so this edge forwards whatever "+
					"identity headers the client sent. elitea-main trusts "+
					"X-Auth-Type + X-Auth-ID from any trusted-proxy address, "+
					"and this edge is one, so an unauthenticated caller picks "+
					"its own user id (#326).",
				relative, stripMiddlewareName,
			)
			continue
		}

		stripped := make([]string, 0, len(definition.Headers.CustomRequestHeaders))
		for name, value := range definition.Headers.CustomRequestHeaders {
			if value != "" {
				t.Errorf(
					"%s: %q sets %s to %q. Only an EMPTY value deletes a "+
						"header; a non-empty one makes the edge assert that "+
						"identity for every caller.",
					relative, stripMiddlewareName, name, value,
				)
				continue
			}
			stripped = append(stripped, name)
		}
		sort.Strings(stripped)
		strippedPerFile[relative] = stripped

		present := map[string]bool{}
		for _, name := range stripped {
			present[name] = true
		}
		var missing []string
		for _, name := range requiredStrippedHeaders {
			if !present[name] {
				missing = append(missing, name)
			}
		}
		if len(missing) > 0 {
			t.Errorf(
				"%s: %q does not delete %s.\n"+
					"A middleware that still resolves and still strips most "+
					"names reads as correct in review and in "+
					"TestEveryRouterMiddlewareResolves. Every name left in "+
					"place is one a client can choose for itself.",
				relative, stripMiddlewareName, strings.Join(missing, ", "),
			)
		}

		// 2. Every router that reaches elitea-main must NAME the middleware. A
		//    definition nothing references strips nothing.
		routersReachingMain := 0
		for name, router := range parsed.HTTP.Routers {
			if router.Service != protectedService {
				continue
			}
			routersReachingMain++
			carries := false
			for _, named := range router.Middlewares {
				if providerLocalName(named) == stripMiddlewareName {
					carries = true
					break
				}
			}
			if !carries {
				t.Errorf(
					"%s: router %q reaches service %q without %q.\n"+
						"Defining the middleware is not enough — a router that "+
						"does not name it forwards the client's own "+
						"X-Auth-ID, and elitea-main accepts it (#326).\n"+
						"Add it to that router's middlewares list.",
					relative, name, protectedService, stripMiddlewareName,
				)
			}
		}
		if routersReachingMain == 0 {
			t.Errorf(
				"%s declares no router with service %q, so this gate checked "+
					"nothing in it. Either the service was renamed or the file "+
					"changed shape; update protectedService in this file.",
				relative, protectedService,
			)
		}
	}

	// 3. The two files must strip the SAME names. They are copies on purpose:
	//    dynamic.e2e.yml REPLACES dynamic.yml at runtime, so each stack loads
	//    exactly one of them. Adding a name to one alone leaves the other stack
	//    open, which is the #326 defect repeated.
	if len(strippedPerFile) == len(browserEdgeFiles) {
		first := browserEdgeFiles[0]
		for _, other := range browserEdgeFiles[1:] {
			if strings.Join(strippedPerFile[first], ",") == strings.Join(strippedPerFile[other], ",") {
				continue
			}
			t.Errorf(
				"%s and %s strip different header sets:\n  %s: %s\n  %s: %s\n"+
					"One file replaces the other at runtime, so each stack "+
					"loads only one of them. A name added to one alone leaves "+
					"the other stack open (#326).",
				first, other,
				first, strings.Join(strippedPerFile[first], ", "),
				other, strings.Join(strippedPerFile[other], ", "),
			)
		}
	}
}
