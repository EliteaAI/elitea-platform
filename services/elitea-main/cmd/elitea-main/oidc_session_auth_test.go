package main

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	notificationsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/notifications"
	v2projects "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
	notificationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/notifications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
)

const oidcSessionTestSecret = "oidc-only-session-secret"

// grantingPermissions answers every question with the permission the route
// requires, for the user the session names. It is the load-bearing part of
// these tests: it reproduces the real condition the issue describes, where a
// deactivated user KEEPS the RBAC rows that were granted before deactivation.
// A refusal observed through it can only come from the principal validator.
type grantingPermissions struct {
	permission string
	calls      int
}

func (p *grantingPermissions) ResolvePermissions(
	_ context.Context,
	_ auth.User,
	_ string,
	_ string,
) (auth.PermissionResolution, error) {
	p.calls++
	return auth.PermissionResolution{UserID: 42, Permissions: []string{p.permission}}, nil
}

// listerStub and eventReaderStub stand in for the PostgreSQL repositories. Both
// count their calls, so a test can prove the refusal happened before the
// handler read anything.
type listerStub struct{ calls int }

func (l *listerStub) ListCurrentUserProjects(
	context.Context,
	sqlcgen.ListCurrentUserProjectsParams,
) ([]sqlcgen.ListCurrentUserProjectsRow, error) {
	l.calls++
	return nil, nil
}

type eventReaderStub struct{ calls int }

func (r *eventReaderStub) HighWater(context.Context, int64) (int64, error) {
	r.calls++
	return 0, nil
}

func (r *eventReaderStub) ListAfter(
	context.Context,
	int64,
	int64,
	int32,
) ([]notificationapp.Event, error) {
	r.calls++
	return nil, nil
}

// streamingRecorder adds the two methods the notification SSE writer probes
// for. httptest.ResponseRecorder alone makes newCurrentNotificationSSEWriter
// fail, which would mask the status this test measures.
type streamingRecorder struct {
	*httptest.ResponseRecorder
}

func newStreamingRecorder() *streamingRecorder {
	return &streamingRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (recorder *streamingRecorder) SetWriteDeadline(time.Time) error { return nil }

func (recorder *streamingRecorder) Flush() { recorder.ResponseRecorder.Flush() }

// TestCurrentProjectListOIDCOnlyAuthRejectsADeactivatedSession drives the REAL
// route — the composition helper, apimw.Auth, the per-project permission gate
// and the handler — with a validly signed session cookie.
//
// Before this fix the OIDC-only branch was `apimw.AuthConfig{SessionSecret:
// ...}` with no PrincipalValidator, and apimw.validatePrincipal returns the
// session user UNCHANGED when that field is nil. A deactivated user's
// unexpired cookie therefore reached the handler with 200. Deleting the
// PrincipalValidator field from oidcSessionAuthConfig turns the first row red.
func TestCurrentProjectListOIDCOnlyAuthRejectsADeactivatedSession(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		principals *countingPrincipals
		wantStatus int
		wantBody   string
	}{
		{
			name:       "deactivated principal is refused",
			principals: &countingPrincipals{inner: deactivatedPrincipals{}},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "authenticated principal is inactive",
		},
		{
			name:       "active principal is served",
			principals: &countingPrincipals{inner: activePrincipals{}},
			wantStatus: http.StatusOK,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			permissions := &grantingPermissions{
				permission: v2projects.CurrentProjectListPermission,
			}
			projects := &listerStub{}
			route, err := v2projects.NewCurrentProjectListRoute(
				projects,
				oidcSessionAuthConfig(testCase.principals, oidcSessionTestSecret),
				permissions,
			)
			if err != nil {
				t.Fatalf("compose current project-list route: %v", err)
			}

			request := httptest.NewRequest(
				http.MethodGet,
				v2projects.CurrentProjectListPath,
				nil,
			)
			request.AddCookie(&http.Cookie{
				Name: "elitea_session",
				Value: signedSessionCookie(
					t, oidcSessionTestSecret, "42", time.Now().Add(time.Hour),
				),
			})
			recorder := httptest.NewRecorder()
			route.ServeHTTP(recorder, request)

			assertOIDCSessionOutcome(t, oidcSessionOutcome{
				status:     recorder.Code,
				body:       recorder.Body.String(),
				wantStatus: testCase.wantStatus,
				wantBody:   testCase.wantBody,
				consulted:  testCase.principals.consulted(),
				reads:      projects.calls,
			})
			// A deactivated user's grants survive deactivation, so the
			// permission gate cannot produce this refusal. Reaching it at all
			// means the principal check already passed.
			if testCase.wantStatus != http.StatusOK && permissions.calls != 0 {
				t.Fatalf("permission resolver consulted %d times on a refused "+
					"request: the session passed the principal check (#314)",
					permissions.calls)
			}
		})
	}
}

// TestCurrentNotificationEventsOIDCOnlyAuthRejectsADeactivatedSession is the
// same proof for the notification SSE stream, the route every page that mounts
// the sidebar opens (#152).
func TestCurrentNotificationEventsOIDCOnlyAuthRejectsADeactivatedSession(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		principals *countingPrincipals
		wantStatus int
		wantBody   string
	}{
		{
			name:       "deactivated principal is refused",
			principals: &countingPrincipals{inner: deactivatedPrincipals{}},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "authenticated principal is inactive",
		},
		{
			name:       "active principal is served",
			principals: &countingPrincipals{inner: activePrincipals{}},
			wantStatus: http.StatusOK,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			permissions := &grantingPermissions{
				permission: notificationsapi.CurrentNotificationEventsPermission,
			}
			events := &eventReaderStub{}
			route, err := notificationsapi.NewCurrentNotificationEventsRoute(
				events,
				oidcSessionAuthConfig(testCase.principals, oidcSessionTestSecret),
				permissions,
			)
			if err != nil {
				t.Fatalf("compose current notification events route: %v", err)
			}

			// The served row opens a stream that runs until the client goes
			// away. A deadline on the request context is that departure.
			streamContext, closeStream := context.WithTimeout(
				context.Background(), 150*time.Millisecond,
			)
			defer closeStream()
			request := httptest.NewRequest(
				http.MethodGet,
				"/api/v2/notifications/events/prompt_lib/1",
				nil,
			).WithContext(streamContext)
			request.AddCookie(&http.Cookie{
				Name: "elitea_session",
				Value: signedSessionCookie(
					t, oidcSessionTestSecret, "42", time.Now().Add(time.Hour),
				),
			})
			recorder := newStreamingRecorder()
			route.ServeHTTP(recorder, request)

			assertOIDCSessionOutcome(t, oidcSessionOutcome{
				status:     recorder.Code,
				body:       recorder.Body.String(),
				wantStatus: testCase.wantStatus,
				wantBody:   testCase.wantBody,
				consulted:  testCase.principals.consulted(),
				reads:      events.calls,
			})
			if testCase.wantStatus != http.StatusOK && permissions.calls != 0 {
				t.Fatalf("permission resolver consulted %d times on a refused "+
					"request: the session passed the principal check (#314)",
					permissions.calls)
			}
		})
	}
}

type oidcSessionOutcome struct {
	status     int
	body       string
	wantStatus int
	wantBody   string
	consulted  int
	reads      int
}

func assertOIDCSessionOutcome(t *testing.T, outcome oidcSessionOutcome) {
	t.Helper()
	if outcome.status != outcome.wantStatus {
		t.Fatalf("status = %d, want %d (body %q)",
			outcome.status, outcome.wantStatus, outcome.body)
	}
	if outcome.wantBody != "" && !strings.Contains(outcome.body, outcome.wantBody) {
		t.Fatalf("body = %q, want it to contain %q", outcome.body, outcome.wantBody)
	}
	// A validator that is never called cannot enforce anything. This is what
	// separates "the config has a non-nil field" from "the session is actually
	// re-checked against the current principal".
	if outcome.consulted != 1 {
		t.Fatalf("PrincipalValidator consulted %d times, want 1: the session "+
			"was accepted without re-checking the principal (#314)",
			outcome.consulted)
	}
	if outcome.wantStatus != http.StatusOK && outcome.reads != 0 {
		t.Fatalf("repository read %d times on a refused request: the refusal "+
			"has already leaked the data it was meant to withhold", outcome.reads)
	}
	if outcome.wantStatus == http.StatusOK && outcome.reads == 0 {
		t.Fatalf("repository read 0 times on a served request: the control row " +
			"proves nothing, so the refusal above is not attributable to the " +
			"principal validator")
	}
}

// TestOIDCSessionAuthConfigCarriesBothCredentialHalves pins the composition
// itself. A session secret without a validator is exactly the defect (#314); a
// validator without the secret refuses every cookie and takes the two routes
// offline.
func TestOIDCSessionAuthConfigCarriesBothCredentialHalves(t *testing.T) {
	principals := &countingPrincipals{inner: activePrincipals{}}

	config := oidcSessionAuthConfig(principals, oidcSessionTestSecret)

	if config.SessionSecret != oidcSessionTestSecret {
		t.Fatalf("SessionSecret = %q, want %q",
			config.SessionSecret, oidcSessionTestSecret)
	}
	if config.PrincipalValidator != apimw.PrincipalValidator(principals) {
		t.Fatal("the OIDC-only config did not take the session principal " +
			"validator; main.go's production one is nil in this branch and " +
			"would enforce nothing (#314)")
	}
	if config.Validator != nil {
		t.Fatal("the OIDC-only config must not carry a token validator: a nil " +
			"*FormGraph in that interface field reads as configured")
	}
}

// TestOIDCOnlyRoutesUseTheSharedAuthComposition guards the call sites. The
// helper is only worth anything if main.go still routes through it, and every
// route test composes its own AuthConfig, so nothing else in the build reads
// what production actually wires.
func TestOIDCOnlyRoutesUseTheSharedAuthComposition(t *testing.T) {
	file := parseMainFile(t)

	for _, constructor := range []string{
		"NewCurrentProjectListRoute",
		"NewCurrentNotificationEventsRoute",
	} {
		if !callPassesCallee(file, constructor, "oidcSessionAuthConfig") {
			t.Fatalf("%s no longer builds its OIDC-only AuthConfig with "+
				"oidcSessionAuthConfig — that branch can silently lose its "+
				"PrincipalValidator again (#314)", constructor)
		}
	}
}

// TestOIDCSessionAuthConfigAlwaysTakesAPoolBackedValidator closes the trap the
// issue names. `oidcSessionAuthConfig(principalValidator, ...)` would read like
// a fix and enforce nothing, because main.go assigns that variable only inside
// the `authEnabled` block — it is nil in exactly this branch. Every call must
// therefore build a validator from the pool instead.
func TestOIDCSessionAuthConfigAlwaysTakesAPoolBackedValidator(t *testing.T) {
	file := parseMainFile(t)

	calls, poolBacked := countArgumentCalls(file, "oidcSessionAuthConfig", 0, "NewPrincipalValidator")
	if calls == 0 {
		t.Fatal("main.go no longer calls oidcSessionAuthConfig at all (#314)")
	}
	if calls != poolBacked {
		t.Fatalf("%d of %d oidcSessionAuthConfig calls build their validator "+
			"with authsvc.NewPrincipalValidator; the rest pass something that "+
			"is nil in this branch and enforce nothing (#314)",
			poolBacked, calls)
	}
}

func parseMainFile(t *testing.T) *ast.File {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse main.go: %v", err)
	}
	return file
}

// countArgumentCalls reports how many calls to `callee` the file makes, and how
// many of those pass a call to `argument` in position `index`.
func countArgumentCalls(file *ast.File, callee string, index int, argument string) (int, int) {
	var calls, matching int
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || calleeName(call.Fun) != callee {
			return true
		}
		calls++
		if index >= len(call.Args) {
			return true
		}
		if nested, ok := call.Args[index].(*ast.CallExpr); ok &&
			calleeName(nested.Fun) == argument {
			matching++
		}
		return true
	})
	return calls, matching
}
