package personalproject_test

// The parts that need no database: the name both readers agree on, the
// principal-id guard, and the two constructor/receiver states a composition can
// legitimately be in.

import (
	"context"
	"errors"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/personalproject"
)

// The name is a CONTRACT with two readers that do not import this package:
// internal/api/v2/social/handler.go's resolvePersonalProjectID and
// internal/api/middleware/project_resolver.go both build
// `project_user_<uid>` from their own literal. A change here that they do not
// follow makes provisioning succeed and resolution fail — silently, and for
// every account.
func TestNameMatchesThePersonalProjectTemplateBothResolversUse(t *testing.T) {
	for userID, want := range map[int64]string{
		1:       "project_user_1",
		9:       "project_user_9",
		123_456: "project_user_123456",
	} {
		if got := personalproject.Name(userID); got != want {
			t.Errorf("Name(%d) = %q, want %q", userID, got, want)
		}
	}
}

// A handler holds the principal id as a string, and not every principal that
// reaches `/social/author` carries an auth_core__user id in it — a development
// stub or an unresolved token principal can put anything there.
// `project_user_<anything>` is a project nobody could be a member of.
func TestUserIDFromStringRefusesEverythingThatIsNotAUserID(t *testing.T) {
	for _, accepted := range []struct {
		raw  string
		want int64
	}{
		{"9", 9},
		{" 42 ", 42},
	} {
		got, ok := personalproject.UserIDFromString(accepted.raw)
		if !ok || got != accepted.want {
			t.Errorf("UserIDFromString(%q) = (%d, %v), want (%d, true)",
				accepted.raw, got, ok, accepted.want)
		}
	}

	for _, refused := range []string{"", "0", "-3", "dev-user", "9.5", "9a", "system"} {
		if got, ok := personalproject.UserIDFromString(refused); ok {
			t.Errorf("UserIDFromString(%q) = (%d, true), want refused", refused, got)
		}
	}
}

// A composition that could not build an ensurer must be able to hold a nil one
// and call it — that is what keeps the branch out of the request handler. Both
// entry points therefore have to tolerate a nil receiver, EnsureAsync by doing
// nothing and Ensure by saying why.
func TestANilEnsurerIsInertRatherThanAPanic(t *testing.T) {
	var ensurer *personalproject.Ensurer
	ensurer.EnsureAsync(9) // must not panic

	if _, err := ensurer.Ensure(context.Background(), 9); !errors.Is(err, personalproject.ErrNotConfigured) {
		t.Fatalf("Ensure on a nil ensurer = %v, want ErrNotConfigured", err)
	}
}

// NewEnsurer refuses a missing dependency instead of returning something that
// fails later: without the pool it cannot tell whether a project already
// exists, and without the provisioner it cannot create one.
func TestNewEnsurerRefusesAMissingDependency(t *testing.T) {
	if _, err := personalproject.NewEnsurer(nil, nil); !errors.Is(err, personalproject.ErrNotConfigured) {
		t.Fatalf("NewEnsurer(nil, nil) = %v, want ErrNotConfigured", err)
	}
}
