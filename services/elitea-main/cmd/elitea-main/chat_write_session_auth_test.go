package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// TestChatWriteRoutesAcceptABrowserSession reads main.go's own AuthConfig for
// the agent-start composition and asserts it carries a session credential.
//
// That handler serves START, REGENERATE and CONTINUE (production_router.go),
// i.e. every write path a chat conversation has, and the product's UI
// authenticates with a session cookie and nothing else — no bearer, no
// forwarded identity. Composed without SessionSecret the route answered
// `401 missing authorization header` to the browser while every server-side
// hop (worker, PAT-driven smoke) succeeded, so the whole backend looked
// healthy and chat simply did not work (#291).
//
// It is an AST assertion for the same reason
// TestProductionRouterConfigSetsRouteGatingRepositories is one: every route
// test composes its OWN AuthConfig, so all of them keep passing while main's
// real literal is missing the field. Nothing else in the build reads what
// production actually wires.
func TestChatWriteRoutesAcceptABrowserSession(t *testing.T) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse main.go: %v", err)
	}

	config := authConfigForCall(t, file, "NewCurrentApplicationStartRoute")
	if !authConfigHasField(config, "SessionSecret") {
		t.Fatal("the agent-start AuthConfig has no SessionSecret: the chat UI " +
			"cannot start, regenerate or continue a turn — it authenticates " +
			"with a session cookie and nothing else (#291)")
	}

	// The configuration reads the chat page makes on every load — the model
	// catalogue among them — share one `currentAuth`. Without a session the
	// model picker rendered EMPTY, so no model could be chosen and the turn was
	// then rejected for not naming one (#292): a chat that cannot run, with
	// every configuration row present and correct.
	shared := authConfigVariable(t, file, "currentAuth")
	if !authConfigHasField(shared, "SessionSecret") {
		t.Fatal("the shared configuration AuthConfig has no SessionSecret: the " +
			"model picker cannot read its own catalogue in a browser (#292)")
	}

	// The peer verifier must survive alongside it. Accepting a session is
	// additive; dropping forwarded identity would break the worker and the
	// forward-auth edge, which are the callers that work today.
	for _, field := range []string{"PrincipalValidator", "ForwardedIdentityVerifier"} {
		if !authConfigHasField(config, field) {
			t.Fatalf("the agent-start AuthConfig lost %s — server-side callers "+
				"authenticate with it", field)
		}
	}
}

// authConfigVariable finds `name := apimw.AuthConfig{...}`.
func authConfigVariable(t *testing.T, file *ast.File, name string) *ast.CompositeLit {
	t.Helper()
	var found *ast.CompositeLit
	ast.Inspect(file, func(node ast.Node) bool {
		assign, ok := node.(*ast.AssignStmt)
		if !ok || len(assign.Lhs) != 1 || len(assign.Rhs) != 1 {
			return true
		}
		identifier, ok := assign.Lhs[0].(*ast.Ident)
		if !ok || identifier.Name != name {
			return true
		}
		if literal, ok := assign.Rhs[0].(*ast.CompositeLit); ok && selectorName(literal.Type) == "AuthConfig" {
			found = literal
			return false
		}
		return true
	})
	if found == nil {
		t.Fatalf("no apimw.AuthConfig assigned to %s in main.go", name)
	}
	return found
}

// authConfigForCall finds `apimw.AuthConfig{...}` passed to the named function.
func authConfigForCall(t *testing.T, file *ast.File, callee string) *ast.CompositeLit {
	t.Helper()
	var found *ast.CompositeLit
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel == nil || selector.Sel.Name != callee {
			return true
		}
		for _, argument := range call.Args {
			literal, ok := argument.(*ast.CompositeLit)
			if !ok {
				continue
			}
			if selectorName(literal.Type) == "AuthConfig" {
				found = literal
				return false
			}
		}
		return true
	})
	if found == nil {
		t.Fatalf("no apimw.AuthConfig literal passed to %s in main.go", callee)
	}
	return found
}

func authConfigHasField(literal *ast.CompositeLit, name string) bool {
	for _, element := range literal.Elts {
		keyValue, ok := element.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := keyValue.Key.(*ast.Ident); ok && key.Name == name {
			return true
		}
	}
	return false
}

func selectorName(expr ast.Expr) string {
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok || selector.Sel == nil {
		return ""
	}
	return selector.Sel.Name
}
