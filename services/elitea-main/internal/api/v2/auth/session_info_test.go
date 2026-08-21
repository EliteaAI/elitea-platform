package auth

// GET /forward-auth/info: how a failed user lookup is reported.
//
// DEFECT. Every failure exit of SessionHandler.Info answered
// `200 {"authenticated": false}`, including the error from the user SELECT. A
// database that cannot serve a query was therefore indistinguishable from a
// browser with no cookie.
//
// SCENARIO. The pool fails for a moment (failover, connection saturation). The
// browser holds a valid, unexpired elitea_session cookie. The web app reads
// `authenticated: false`, drops the user and redirects to the identity
// provider. The provider still holds its own session, so it bounces the
// browser back to the callback, where user provisioning hits the same broken
// pool and renders a bare 500 page. A recoverable blip costs a forced sign-out.
//
// EVIDENCE. oidc.go already separates pgx.ErrNoRows (absent or suspended user)
// from a real query error. Info did not.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
)

// stubRow returns one prepared error or user id for Scan.
type stubRow struct {
	err    error
	userID int64
}

func (r stubRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) == 1 {
		if target, ok := dest[0].(*int64); ok {
			*target = r.userID
		}
	}
	return nil
}

type stubUsers struct {
	row stubRow
}

func (s stubUsers) QueryRow(context.Context, string, ...any) pgx.Row { return s.row }

func infoResponse(t *testing.T, handler *SessionHandler, token string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/forward-auth/info", nil)
	if token != "" {
		request.AddCookie(&http.Cookie{Name: "elitea_session", Value: token})
	}
	recorder := httptest.NewRecorder()
	handler.Info(recorder, request)
	return recorder
}

func TestSessionInfoSeparatesAStoreOutageFromNoSession(t *testing.T) {
	const secret = "session-secret"
	token := makeSessionToken(secret, "7", "owner@example.test")

	for _, test := range []struct {
		name          string
		row           stubRow
		wantStatus    int
		wantAuth      bool
		wantRetry     bool
		wantErrorBody string
	}{
		{
			name:       "a live session stays authenticated",
			row:        stubRow{userID: 7},
			wantStatus: http.StatusOK,
			wantAuth:   true,
		},
		{
			name:       "an absent or suspended user is not authenticated",
			row:        stubRow{err: pgx.ErrNoRows},
			wantStatus: http.StatusOK,
			wantAuth:   false,
		},
		{
			name:          "a store outage is not an answer about the caller",
			row:           stubRow{err: errors.New("connection refused")},
			wantStatus:    http.StatusServiceUnavailable,
			wantRetry:     true,
			wantErrorBody: "session store unavailable",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := NewSessionHandler(nil, secret)
			handler.users = stubUsers{row: test.row}

			recorder := infoResponse(t, handler, token)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, test.wantStatus, recorder.Body.String())
			}

			var body map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("body %q: %v", recorder.Body.String(), err)
			}
			if test.wantErrorBody != "" {
				if body["error"] != test.wantErrorBody {
					t.Fatalf("body = %v, want error %q", body, test.wantErrorBody)
				}
				// The outage must never carry the sign-out verdict.
				if _, present := body["authenticated"]; present {
					t.Fatalf("body = %v, want no authenticated field", body)
				}
			} else if body["authenticated"] != test.wantAuth {
				t.Fatalf("authenticated = %v, want %v", body["authenticated"], test.wantAuth)
			}
			if got := recorder.Header().Get("Retry-After"); (got != "") != test.wantRetry {
				t.Fatalf("Retry-After = %q, want present=%v", got, test.wantRetry)
			}
		})
	}
}

// TestSessionInfoReportsAMisWiredHandler pins the split of the composition
// error away from the outage. A nil user store means the route was mounted
// without a pool, which no retry can repair.
func TestSessionInfoReportsAMisWiredHandler(t *testing.T) {
	const secret = "session-secret"
	handler := NewSessionHandler(nil, secret)

	recorder := infoResponse(t, handler, makeSessionToken(secret, "7", "owner@example.test"))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body %s)", recorder.Code, recorder.Body.String())
	}
}

// TestSessionInfoStillReportsNoSessionWithoutACookie keeps the three exits that
// really do mean "no session" on 200.
func TestSessionInfoStillReportsNoSessionWithoutACookie(t *testing.T) {
	const secret = "session-secret"
	handler := NewSessionHandler(nil, secret)
	handler.users = stubUsers{row: stubRow{userID: 7}}

	for _, test := range []struct {
		name  string
		token string
	}{
		{name: "no cookie", token: ""},
		{name: "bad signature", token: makeSessionToken("other-secret", "7", "owner@example.test")},
		{name: "no user id", token: makeSessionToken(secret, "0", "owner@example.test")},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := infoResponse(t, handler, test.token)
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", recorder.Code)
			}
			var body map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["authenticated"] != false {
				t.Fatalf("authenticated = %v, want false", body["authenticated"])
			}
		})
	}
}
