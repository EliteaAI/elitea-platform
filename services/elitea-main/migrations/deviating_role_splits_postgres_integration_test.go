package migrations_test

// The two role splits #402 decides AGAINST testdata/postgres/legacy-rbac-matrix.json.
//
// Every other grant in this corpus transcribes that matrix. These three strings
// do not, and shared/0083_viewer_secret_list_and_own_avatar.sql carries the
// product reason for each. This file measures the decision, so a later reader
// who restores the matrix split has to delete a named test rather than change a
// row quietly.
//
// # What each test discriminates
//
// The ledger in remaining_permission_grants_postgres_integration_test.go already
// asserts the holder sets, and TestAViewerIsRefusedTheRestrictedGates already
// runs the viewer through every string on both surfaces. This file adds the two
// things that table cannot express:
//
//   - the EDITOR direction, which no test in this package covered; and
//   - the NAME/VALUE line on the secrets surface, which is the whole reason the
//     first split is safe to widen. A test that only proved "a viewer resolves
//     the list" would pass just as well if the migration had granted the viewer
//     the value read too.
//
// Both directions are measured for both splits. An entitled caller resolves the
// string, and a caller without the grant is refused it. Without the second half
// a migration that granted everything to everybody would read as a pass.
//
// Every assertion reads the resolver, never a status code. The per-user property
// of the avatar routes — a caller acts on the caller's own row and on no other
// user's — is a property of the HANDLER, not of a grant, so it is measured where
// the handler runs:
// internal/api/v2/social/avatar_postgres_integration_test.go.

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// secretValueStrings are the five secrets strings that stay with admin and
// editor. `unsecret` is the value read; the other four are writes.
var secretValueStrings = []string{
	"configuration.secrets.secret.unsecret",
	"configuration.secrets.secret.create",
	"configuration.secrets.secret.edit",
	"configuration.secrets.secret.delete",
	"configuration.secrets.secret.hide",
}

// avatarStrings are the two per-user avatar routes.
var avatarStrings = []string{
	"models.social.avatar.get",
	"models.social.avatar.update",
}

/* ── split 1: the viewer lists secret NAMES and reads no VALUE ─────────── */

// The entitled half. A viewer resolves the secret listing on a clean database.
//
// Before 0083 the secrets page answered 403 to a viewer, so the screen was empty
// for ever with no statement of why.
func TestAViewerResolvesTheSecretListing(t *testing.T) {
	pool := newMigratedPool(t)
	seedRoleMembership(t, pool, 4021, "viewer", 1)

	resolution := resolveDefaultModeFor(t, pool, "1", "1")

	if !slices.Contains(resolution.Permissions, "configuration.secrets.secret.list") {
		t.Errorf("a viewer does not resolve configuration.secrets.secret.list.\n" +
			"  0083 grants it. Without it the secrets page cannot tell a viewer that a\n" +
			"  secret a toolkit references exists at all.")
	}
}

// The refused half, and the line the whole decision rests on.
//
// A viewer resolves the NAME listing and none of the five strings that read or
// change a VALUE. This is what makes the widening safe. Delete this test and a
// migration that gave the viewer `unsecret` would pass every other assertion in
// this package that mentions a viewer.
func TestAViewerIsRefusedEverySecretValueString(t *testing.T) {
	pool := newMigratedPool(t)
	seedRoleMembership(t, pool, 4022, "viewer", 1)

	resolution := resolveDefaultModeFor(t, pool, "1", "1")

	for _, permission := range secretValueStrings {
		if slices.Contains(resolution.Permissions, permission) {
			t.Errorf("a viewer resolves %s.\n"+
				"  0083 widens the NAME listing only. A viewer must not read a secret value,\n"+
				"  and must not create, edit, delete or hide one.", permission)
		}
	}
}

/* ── split 2: every project role acts on its OWN avatar ────────────────── */

// The entitled half, for the two roles the matrix withheld the avatar from.
//
// The routes are per-user. A project role must not decide whether a person may
// see or set their own picture.
func TestAnEditorAndAViewerResolveTheOwnAvatarRoutes(t *testing.T) {
	for _, roleName := range []string{"editor", "viewer"} {
		t.Run(roleName, func(t *testing.T) {
			pool := newMigratedPool(t)
			seedRoleMembership(t, pool, 4023, roleName, 1)

			resolution := resolveDefaultModeFor(t, pool, "1", "1")

			for _, permission := range avatarStrings {
				if !slices.Contains(resolution.Permissions, permission) {
					t.Errorf("a %s does not resolve %s on a clean database, so the route "+
						"refuses them their own picture", roleName, permission)
				}
			}
		})
	}
}

// The refused half. A user who belongs to no project resolves neither string.
//
// This is what keeps the widened grant from becoming "any authenticated user may
// write into any project's avatar bucket". projectPermissions() joins the
// central fallback THROUGH the caller's assigned project roles, so a non-member
// has no row to fall back from. It is also the reason 0083 widens the grant
// rather than removing the gate: the gate is what refuses this caller.
func TestANonMemberIsRefusedTheOwnAvatarRoutes(t *testing.T) {
	pool := newMigratedPool(t)
	seedRoleMembership(t, pool, 4024, "admin", 1)

	// User 402 holds no role in project 1. User 1 does, which proves the
	// project itself resolves and that the refusal below is about the caller.
	seedOutsider(t, pool, 402)

	member := resolveDefaultModeFor(t, pool, "1", "1")
	outsider := resolveDefaultModeFor(t, pool, "402", "1")

	for _, permission := range avatarStrings {
		if !slices.Contains(member.Permissions, permission) {
			t.Fatalf("the project member does not resolve %s, so this test cannot "+
				"discriminate a refusal from an empty corpus", permission)
		}
		if slices.Contains(outsider.Permissions, permission) {
			t.Errorf("a non-member resolves %s. The central grant must reach only a "+
				"caller who holds a role in the project.", permission)
		}
	}
}

/* ── why "every role" is the membership check ──────────────────────────── */

// Go seeds exactly three default-mode roles. 0083 grants the avatar strings to
// all three, so the surviving gate admits every project member and refuses
// everybody else. That equivalence is the reason 0083 changes the grant and
// leaves the gate alone, and it stops holding the moment a fourth role appears.
//
// A fourth default-mode role would silently be refused its own avatar. This test
// fails then, and 0083's decision has to be read again.
func TestGoSeedsExactlyThreeDefaultModeRoles(t *testing.T) {
	pool := newMigratedPool(t)

	ctx, cancel := testContext()
	defer cancel()

	rows, err := pool.Query(ctx,
		`SELECT name FROM public.auth_core__role WHERE mode = 'default' ORDER BY name`)
	if err != nil {
		t.Fatalf("read the default-mode roles: %v", err)
	}
	defer rows.Close()

	names := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan a role row: %v", err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate the role rows: %v", err)
	}

	want := []string{"admin", "editor", "viewer"}
	if !slices.Equal(names, want) {
		t.Fatalf("default-mode roles = %v, want %v.\n"+
			"  0083 grants the avatar strings to all three because that set IS the\n"+
			"  membership check. A new role breaks the equivalence and needs its own\n"+
			"  decision.", names, want)
	}
}

/* ── harness ───────────────────────────────────────────────────────────── */

// seedOutsider creates a user with no project role at all.
//
// requireUser() refuses a caller that has no auth_core__user row, so without
// this the resolution would fail for the wrong reason and the refusal would
// prove nothing.
func seedOutsider(t *testing.T, pool *pgxpool.Pool, userID int) {
	t.Helper()
	ctx, cancel := testContext()
	defer cancel()

	email := fmt.Sprintf("outsider-%d@example.com", userID)
	if _, err := pool.Exec(ctx, `
INSERT INTO public.auth_core__user (id, email, name)
VALUES ($1, $2, 'Outsider')
ON CONFLICT (id) DO NOTHING`, userID, email); err != nil {
		t.Fatalf("seed the outsider: %v", err)
	}
}

func testContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 20*time.Second)
}
