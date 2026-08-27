// Package personalproject creates the per-user "private" project every account
// needs before the product is usable, and that this stack never created.
//
// THE DEFECT IT CLOSES. `GET /social/author` answers `personal_project_id`, and
// internal/api/v2/social/handler.go's resolvePersonalProjectID said so in its
// own doc comment: "this Go stack never PROVISIONS a `project_user_<uid>`
// project, so branch 1 only ever fires for data migrated from pylon". On a
// deployment with no pylon data behind it — every fresh install — that value is
// therefore `""` for every account, forever. The SPA reads it as "no personal
// project yet" and sends the browser to `/onboarding`
// (apps/elitea-web/src/routes/-guards/indexRoute.ts), which waits for a project
// that nothing was ever going to create. Every new user was stuck on that
// screen.
//
// THE REFERENCE is legacy/plugins/projects: `create_personal_project`
// (rpc/poc.py:64) names the project `project_user_<uid>` and provisions it
// through the same create-project pipeline an ordinary project uses, and
// methods/private_projects.py runs it OFF the request path — pylon's auth layer
// fires an `auth_visitor` event for every authenticated request, the projects
// plugin queues the visitor, and a background thread provisions the project
// while the SPA polls `/social/author` every five seconds until the id appears.
// The onboarding screen's "Configuring Personal project… about 5 min" is that
// wait.
//
// WHAT IS PORTED, AND WHAT IS NOT.
//
//   - The name, the ownership, and the off-request-path execution are ported.
//   - The queue and its worker thread are NOT. Ensure is deduplicated per user
//     inside the process and serialized across processes by a PostgreSQL
//     advisory lock, which is what the queue was doing on a single-process
//     runtime and is what a multi-replica deployment actually needs.
//   - pylon's `plugins=('configuration', 'models')` is kept verbatim. Nothing
//     in this service reads centry.project.plugins — it is echoed back by the
//     project listings and nothing else — so the value is parity rather than
//     behaviour. It is what a pylon-created personal project carries.
//   - pylon grants the owner `editor`, `viewer` and `monitor` on their own
//     project. This grants `admin`, which is what projectprovisioning already
//     gives the maker of any project whose request names no administrator
//     (steps.go's ownerProjectRole). A personal project's owner is the only
//     person who can administer it, and `monitor` no longer exists
//     (auth_core's 202602231400_remove_monitor_role migration).
package personalproject

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/projectprovisioning"
)

// Provisioner is the create/delete half of projectprovisioning.Provisioner this
// package needs, declared at the consumer so the ensurer can be tested without
// the tenant migration corpus.
//
// Deprovision is part of it on purpose. See Ensure's repair branch: a project
// row left behind with `create_success = false` is a personal project its owner
// can never be given, and pylon's own `fix_create_personal_projects` repairs
// exactly that state by deleting and recreating.
type Provisioner interface {
	Provision(ctx context.Context, request projectprovisioning.Request) (projectprovisioning.Result, error)
	Deprovision(ctx context.Context, projectID int64) (projectprovisioning.Result, error)
}

// personalProjectNameTemplate is pylon's PROJECT_PERSONAL_NAME_TEMPLATE
// (legacy/plugins/projects/constants.py:13), and the name
// social/handler.go's resolvePersonalProjectID and
// api/middleware/project_resolver.go both look up. All three have to agree, and
// the two readers build it from the same `project_user_` literal.
const personalProjectNameTemplate = "project_user_%d"

// Name is the personal project of one user, by id.
func Name(userID int64) string {
	return fmt.Sprintf(personalProjectNameTemplate, userID)
}

// personalProjectPlugins is pylon's create_personal_project default
// (legacy/plugins/projects/rpc/poc.py:64). See the package comment.
var personalProjectPlugins = []string{"configuration", "models"}

// systemUserEmail matches the per-project system identity pylon creates for
// every project (`system_user_<n>@centry.user`,
// legacy/plugins/projects/constants.py:11). Those accounts already resolve a
// personal project id — it is the second branch of resolvePersonalProjectID —
// and giving one a project of its own would create a project per project.
var systemUserEmail = regexp.MustCompile(`^system_user_[0-9]+@centry\.user$`)

// systemUserNamePrefix is PROJECT_USER_NAME_PREFIX. private_projects.py skips a
// visitor whose name starts with it, so this does too.
const systemUserNamePrefix = ":system:project:"

// advisoryLockClass namespaces this package's advisory locks. PostgreSQL
// advisory locks share one global space keyed by two int4s, so the class keeps
// a lock on user 9 here from colliding with a lock on 9 taken for anything
// else.
//
// The value is arbitrary and permanent. Changing it would let an old process
// and a new one provision the same personal project at the same time during a
// rolling deploy.
const advisoryLockClass = 0x454C5041 // "ELPA"

// defaultProvisionTimeout bounds one provisioning attempt.
//
// It is generous because the work is genuinely long: the project_schema step
// applies the entire tenant migration corpus to a new schema. It runs detached
// from the request that triggered it, so nothing is waiting on it.
const defaultProvisionTimeout = 10 * time.Minute

// ErrNotConfigured reports an ensurer built without its dependencies.
var ErrNotConfigured = errors.New("personalproject: ensurer is not configured")

// Ensurer creates the personal project of one user, once.
type Ensurer struct {
	pool        *pgxpool.Pool
	provisioner Provisioner
	logger      *slog.Logger
	timeout     time.Duration

	// inFlight holds the user ids being provisioned by THIS process. The SPA
	// polls `/social/author` every five seconds while it waits, and every one
	// of those polls resolves an empty personal project id and asks again —
	// without this, each poll would start another provisioning attempt, and
	// they would queue up on the advisory lock behind the first.
	inFlight sync.Map
}

// Option configures an Ensurer at construction time.
type Option func(*Ensurer)

// WithLogger replaces the default logger.
func WithLogger(logger *slog.Logger) Option {
	return func(e *Ensurer) {
		if logger != nil {
			e.logger = logger
		}
	}
}

// WithProvisionTimeout replaces the per-attempt timeout. Zero and negative
// values are ignored, so a caller cannot accidentally build an ensurer whose
// every attempt is already expired.
func WithProvisionTimeout(timeout time.Duration) Option {
	return func(e *Ensurer) {
		if timeout > 0 {
			e.timeout = timeout
		}
	}
}

// NewEnsurer builds an Ensurer. Both dependencies are required: without the
// pool it cannot decide whether a project already exists, and without the
// provisioner it cannot create one.
func NewEnsurer(pool *pgxpool.Pool, provisioner Provisioner, options ...Option) (*Ensurer, error) {
	if pool == nil || provisioner == nil {
		return nil, ErrNotConfigured
	}
	ensurer := &Ensurer{
		pool:        pool,
		provisioner: provisioner,
		logger:      slog.Default(),
		timeout:     defaultProvisionTimeout,
	}
	for _, option := range options {
		option(ensurer)
	}
	return ensurer, nil
}

// EnsureAsync provisions the user's personal project in the background and
// returns immediately.
//
// It is the shape every caller wants, and the only one a request handler may
// use: provisioning applies a migration corpus, so a handler that waited for it
// would hold a request open for as long as that takes. The caller learns the
// outcome the same way the SPA does — by asking for the personal project id
// again.
//
// A nil receiver is a no-op, so a composition that could not build an ensurer
// needs no branch at the call site.
func (e *Ensurer) EnsureAsync(userID int64) {
	if e == nil {
		return
	}
	if _, running := e.inFlight.LoadOrStore(userID, struct{}{}); running {
		return
	}
	go func() {
		defer e.inFlight.Delete(userID)
		// context.Background(), not the request's: the request that triggered
		// this is answered long before provisioning finishes, and cancelling
		// halfway through leaves a half-built tenant for the next attempt to
		// repair.
		ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
		defer cancel()
		if _, err := e.Ensure(ctx, userID); err != nil {
			e.logger.ErrorContext(ctx, "personal project provisioning failed",
				"user_id", userID, "err", err)
		}
	}()
}

// Ensure returns the id of the user's personal project, creating it if there is
// none.
//
// It answers 0 with a nil error for an identity that must NOT have a personal
// project — a missing, suspended, or system account. That is not a failure: it
// is the same answer resolvePersonalProjectID gives, and the same skip
// private_projects.py's process_visitor makes.
func (e *Ensurer) Ensure(ctx context.Context, userID int64) (int64, error) {
	if e == nil || e.pool == nil || e.provisioner == nil {
		return 0, ErrNotConfigured
	}
	if userID <= 0 {
		return 0, fmt.Errorf("personalproject: user id must be positive, got %d", userID)
	}
	// int32 is what auth_core__user.id is, and what the advisory lock's second
	// key accepts. An id outside it names no account.
	if userID > (1<<31)-1 {
		return 0, fmt.Errorf("personalproject: user id %d is out of range", userID)
	}

	eligible, err := e.eligible(ctx, userID)
	if err != nil {
		return 0, err
	}
	if !eligible {
		return 0, nil
	}

	// The lock is held for the whole check-and-create, and it is SESSION
	// scoped rather than transaction scoped because provisioning is not one
	// transaction: projectprovisioning commits the project row before it can
	// apply the tenant corpus to it (see that package's doc comment), so a
	// transaction-scoped lock would be released by the first commit and two
	// replicas would each create a `project_user_<uid>` row. centry.project has
	// no unique index on `name`, so nothing else would stop them.
	connection, err := e.pool.Acquire(ctx)
	if err != nil {
		return 0, fmt.Errorf("personalproject: acquire connection: %w", err)
	}
	defer connection.Release()

	var locked bool
	if err := connection.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1::integer, $2::integer)`,
		int32(advisoryLockClass), int32(userID),
	).Scan(&locked); err != nil {
		return 0, fmt.Errorf("personalproject: lock user %d: %w", userID, err)
	}
	if !locked {
		// Another process is provisioning this user's project right now.
		// Waiting would pin this connection for as long as a tenant migration
		// takes; the caller polls, so returning "not ready yet" is both cheaper
		// and truthful.
		return 0, nil
	}
	defer func() {
		// context.WithoutCancel: the unlock must run even when ctx has expired,
		// otherwise the lock lives until the connection is closed and every
		// later attempt reports "someone else is provisioning".
		unlockCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if _, unlockErr := connection.Exec(unlockCtx,
			`SELECT pg_advisory_unlock($1::integer, $2::integer)`,
			int32(advisoryLockClass), int32(userID),
		); unlockErr != nil {
			e.logger.WarnContext(ctx, "personal project advisory lock was not released",
				"user_id", userID, "err", unlockErr)
		}
	}()

	return e.ensureLocked(ctx, userID)
}

// ensureLocked is Ensure's body, with the advisory lock held.
func (e *Ensurer) ensureLocked(ctx context.Context, userID int64) (int64, error) {
	existingID, created, found, err := e.existingProject(ctx, userID)
	if err != nil {
		return 0, err
	}
	switch {
	case found && created:
		return existingID, nil
	case found && !created:
		// A project row that provisioning never finished. projectprovisioning
		// compensates its own failures, so reaching this state means the
		// compensation itself failed — or the process died mid-flight. Either
		// way the row is unusable AND permanent: resolvePersonalProjectID's
		// first branch matches on the name, so the owner would be told they
		// have a project that no tenant schema backs.
		//
		// pylon repairs it the same way (fix_create_personal_projects: delete
		// then create).
		e.logger.WarnContext(ctx, "removing an unfinished personal project before recreating it",
			"user_id", userID, "project_id", existingID)
		if _, err := e.provisioner.Deprovision(ctx, existingID); err != nil {
			return 0, fmt.Errorf("personalproject: remove unfinished project %d: %w", existingID, err)
		}
	}

	result, err := e.provisioner.Provision(ctx, projectprovisioning.Request{
		Name:    Name(userID),
		Plugins: personalProjectPlugins,
		OwnerID: userID,
		// No AdminEmails and no AdminRoles: projectprovisioning's project_admin
		// step then makes the OWNER the project's administrator, which is the
		// grant a personal project wants. See the package comment.
		Limits: projectprovisioning.DefaultLimits(),
	})
	if err != nil {
		return 0, fmt.Errorf("personalproject: provision for user %d: %w", userID, err)
	}
	e.logger.InfoContext(ctx, "personal project created",
		"user_id", userID, "project_id", result.ProjectID)
	return result.ProjectID, nil
}

// existingProject reads the user's personal project row.
//
// ORDER BY id is the same tie-break resolvePersonalProjectID applies, so the
// two agree about WHICH row is the personal project on a database that already
// carries duplicates — centry.project has no unique index on `name`, and a
// deployment that ran without this package's advisory lock could have two.
func (e *Ensurer) existingProject(
	ctx context.Context, userID int64,
) (projectID int64, created bool, found bool, err error) {
	err = e.pool.QueryRow(ctx,
		`SELECT id, create_success FROM centry.project WHERE name = $1 ORDER BY id LIMIT 1`,
		Name(userID),
	).Scan(&projectID, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, false, nil
	}
	if err != nil {
		return 0, false, false, fmt.Errorf("personalproject: read project for user %d: %w", userID, err)
	}
	return projectID, created, true, nil
}

// eligible reports whether this account is one that should own a personal
// project.
//
// Three accounts are excluded, and each exclusion is pylon's:
//
//   - one that does not exist. Nothing to own a project.
//   - a suspended one. Every other provisioning path in this service refuses a
//     suspended account (identityrepo, and projectprovisioning's own membership
//     inserts filter on `suspended = false`), so creating a project for one
//     would build a tenant its owner cannot reach.
//   - a per-project system identity. process_visitor skips it by name, and
//     resolvePersonalProjectID already answers for it by email.
func (e *Ensurer) eligible(ctx context.Context, userID int64) (bool, error) {
	var email, name string
	var suspended bool
	err := e.pool.QueryRow(ctx,
		`SELECT COALESCE(email, ''), COALESCE(name, ''), suspended
		 FROM public.auth_core__user WHERE id = $1`,
		int32(userID),
	).Scan(&email, &name, &suspended)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("personalproject: read user %d: %w", userID, err)
	}
	if suspended {
		return false, nil
	}
	if systemUserEmail.MatchString(email) || strings.HasPrefix(name, systemUserNamePrefix) {
		return false, nil
	}
	return true, nil
}

// UserIDFromString parses the `auth.User` id a handler holds.
//
// Handlers carry the principal id as a string, and every one of them needs the
// same guard before it can ask for a personal project: a token principal, a
// forwarded header, or a development stub can put a non-numeric value there,
// and `project_user_<that>` is not a project anybody should create.
func UserIDFromString(userID string) (int64, bool) {
	parsed, err := strconv.ParseInt(strings.TrimSpace(userID), 10, 64)
	if err != nil || parsed <= 0 {
		return 0, false
	}
	return parsed, true
}
