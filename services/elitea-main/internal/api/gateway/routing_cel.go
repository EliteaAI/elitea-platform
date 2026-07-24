package gateway

import (
	"fmt"
	"sync"

	"github.com/google/cel-go/cel"
)

// The governance CEL variable set — design-governance-config-authoring §3.1.
// A routing-rule expression is a boolean predicate over exactly these variables.
// elitea-main does NOT import bifrost/core (it is the thin auth edge), so this
// declares the same variable surface locally; the gateway's GovernanceStore
// compiles the identical set for enforcement. Keep the two in lock-step: a rule
// that type-checks here MUST type-check in the gateway.
//
//	budget_used     number  — fraction/amount of budget consumed
//	tokens_used     int     — tokens consumed on the request path
//	provider        string  — upstream provider id
//	model           string  — model name
//	team_id         string  — requesting team
//	customer_id     string  — requesting customer
//	complexity_tier string  — routing complexity bucket
//	headers         map[string]string — request headers
//	params          map[string]dyn    — request parameters
func newRoutingCELEnv() (*cel.Env, error) {
	return cel.NewEnv(
		cel.Variable("budget_used", cel.DoubleType),
		cel.Variable("tokens_used", cel.IntType),
		cel.Variable("provider", cel.StringType),
		cel.Variable("model", cel.StringType),
		cel.Variable("team_id", cel.StringType),
		cel.Variable("customer_id", cel.StringType),
		cel.Variable("complexity_tier", cel.StringType),
		cel.Variable("headers", cel.MapType(cel.StringType, cel.StringType)),
		cel.Variable("params", cel.MapType(cel.StringType, cel.DynType)),
	)
}

// routingCELEnv is built once — env construction parses the standard macro/decl
// set and is not free, while a routing-rule save is on a human-interactive path.
var routingCELEnv struct {
	once sync.Once
	env  *cel.Env
	err  error
}

func governanceCELEnv() (*cel.Env, error) {
	routingCELEnv.once.Do(func() {
		routingCELEnv.env, routingCELEnv.err = newRoutingCELEnv()
	})
	return routingCELEnv.env, routingCELEnv.err
}

// CompileRoutingCEL type-checks a routing-rule CEL expression against the
// governance variable set and requires it to evaluate to a boolean. It returns a
// user-facing error describing the first compile/type problem, or nil when the
// expression is a valid boolean predicate. This is the server-side source of
// truth — the admin editor's inline hints are UX only (design §3.1, §4).
func CompileRoutingCEL(expr string) error {
	if expr == "" {
		return fmt.Errorf("CEL expression must not be empty")
	}
	env, err := governanceCELEnv()
	if err != nil {
		return fmt.Errorf("CEL environment unavailable: %w", err)
	}
	ast, issues := env.Compile(expr)
	if issues != nil && issues.Err() != nil {
		return fmt.Errorf("CEL compile error: %s", issues.Err())
	}
	if out := ast.OutputType(); !out.IsExactType(cel.BoolType) {
		return fmt.Errorf("CEL expression must evaluate to bool, got %s", out.TypeName())
	}
	return nil
}
