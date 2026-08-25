package supportassistant

// All of this package's SQL.
//
// It is one file on purpose. The support project is SHARED BY EVERY USER ON THE
// PLATFORM, so the difference between "your support history" and "everybody's
// support history" is a single predicate — `author_id = $caller AND source =
// 'support'` — and a predicate that decides that must not be scattered across
// five handlers where the sixth can forget it. Every statement below that
// touches `chat_conversations` carries it, and `conversationOwnedByCaller` is
// the one lookup the mutating routes go through.
//
// # Why the tenant schema is interpolated without escaping
//
// `p_%d` is built from an int64 that came out of `centry.platform_config` via
// `Values.Int`, which returns a number or nothing. No caller-supplied text
// reaches these statements, which is a stronger guarantee than escaping: there
// is no string on this path to escape.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/platformconfig"
)

// supportSource is the `chat_conversations.source` value that marks a row as
// belonging to this feature, verbatim from `api/v2/conversations.py`'s
// `source='support'`. It is also what keeps support transcripts OUT of the
// ordinary chat listing if the hidden project is ever opened by a person.
const supportSource = "support"

// bootstrapLockKey keys the advisory lock the project bootstrap serialises on.
// It is a fixed arbitrary constant; the only requirement is that this feature
// uses the same number in every replica and no other feature uses it.
const bootstrapLockKey int64 = 0x5507A551 // "SUPPASSI"

type store struct {
	pool        *pgxpool.Pool
	provisioner Provisioner
	logger      *slog.Logger
}

// ---------------------------------------------------------------------------
// settings and bootstrap
// ---------------------------------------------------------------------------

// settings resolves the section, bootstrapping the hidden project the first time
// an enabled deployment needs one.
func (s *store) settings(ctx context.Context) (platformconfig.SupportAssistant, error) {
	resolved, err := platformconfig.LoadSupportAssistant(ctx, s.pool)
	if err != nil {
		return platformconfig.SupportAssistant{}, err
	}
	if !resolved.Enabled || resolved.ProjectID > 0 {
		return resolved, nil
	}
	projectID, err := s.bootstrapProject(ctx)
	if err != nil {
		// Reported as NOT READY rather than as an error to the caller: an
		// operator who enabled the switch on a deployment with no provisioner
		// gets no widget, which is recoverable, instead of a 500 on every page.
		s.logger.Warn("support assistant: project bootstrap unavailable", "err", err)
		return resolved, nil
	}
	resolved.ProjectID = projectID
	return resolved, nil
}

// bootstrapProject creates the hidden support project exactly once per
// deployment and records its id back into `centry.platform_config`, so the
// Features page shows the operator which project it landed in.
func (s *store) bootstrapProject(ctx context.Context) (int64, error) {
	if s.provisioner == nil {
		return 0, ErrNoProvisioner
	}
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return 0, fmt.Errorf("support assistant: acquire connection: %w", err)
	}
	defer conn.Release()

	// A SESSION lock, taken on a single pinned connection and released
	// explicitly, because provisioning is many statements over its own pool
	// connections and cannot run inside one transaction.
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, bootstrapLockKey); err != nil {
		return 0, fmt.Errorf("support assistant: bootstrap lock: %w", err)
	}
	defer func() {
		if _, err := conn.Exec(context.WithoutCancel(ctx),
			`SELECT pg_advisory_unlock($1)`, bootstrapLockKey); err != nil {
			s.logger.Error("support assistant: bootstrap unlock", "err", err)
		}
	}()

	// Re-read INSIDE the lock. This is the whole point of the lock: the replica
	// that waited here must see the winner's write rather than provision a
	// second "Support Assistant" project.
	values, err := platformconfig.Load(ctx, s.pool, platformconfig.SectionSupportAssistant)
	if err != nil {
		return 0, err
	}
	if existing, ok := values.Int(platformconfig.KeySupportProjectID); ok && existing > 0 {
		return existing, nil
	}

	// A project by that name from a PREVIOUS bootstrap whose id row was cleared
	// (an operator emptying the field on the Features page) is adopted rather
	// than duplicated. The reference has no equivalent and grows a new project
	// every time its state file is lost.
	if adopted, err := s.projectByName(ctx, SupportProjectName); err != nil {
		return 0, err
	} else if adopted > 0 {
		if err := s.recordProjectID(ctx, adopted); err != nil {
			return 0, err
		}
		return adopted, nil
	}

	ownerID, err := s.ensureSystemUser(ctx)
	if err != nil {
		return 0, err
	}
	projectID, err := s.provisioner.Provision(ctx, ProvisionRequest{
		Name:       SupportProjectName,
		OwnerID:    ownerID,
		AdminEmail: SystemUserEmail,
	})
	if err != nil {
		return 0, fmt.Errorf("support assistant: provision project: %w", err)
	}
	if err := s.recordProjectID(ctx, projectID); err != nil {
		// The project EXISTS at this point. Failing to record its id would make
		// the next request provision another one, so this is reported rather
		// than swallowed — and the name-adoption branch above is what recovers
		// the deployment if it ever happens.
		return 0, err
	}
	s.logger.Info("support assistant: hidden project created", "project_id", projectID)
	return projectID, nil
}

func (s *store) projectByName(ctx context.Context, name string) (int64, error) {
	var projectID int64
	// `create_success` is the provisioner's own "every step finished" marker
	// (see createProjectModel / markCreated). Adopting a HALF-PROVISIONED row —
	// one whose tenant schema or RBAC never landed — would point the assistant
	// at a project whose `chat_conversations` table does not exist, so the
	// listing would 500 forever with no way for an operator to see why.
	err := s.pool.QueryRow(ctx,
		`SELECT id FROM centry.project
		 WHERE name = $1 AND create_success IS TRUE
		 ORDER BY id LIMIT 1`, name).Scan(&projectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("support assistant: lookup project by name: %w", err)
	}
	return projectID, nil
}

// ensureSystemUser resolves the platform system identity, creating it when the
// deployment has none. `ON CONFLICT DO NOTHING` plus the UNION is the same
// race-free upsert-and-read `createSystemUser` uses in the provisioner.
func (s *store) ensureSystemUser(ctx context.Context) (int64, error) {
	var userID int64
	err := s.pool.QueryRow(ctx, `
WITH created AS (
    INSERT INTO public.auth_core__user (email, name)
    VALUES ($1, $2)
    ON CONFLICT (email) DO NOTHING
    RETURNING id
)
SELECT id FROM created
UNION ALL
SELECT id FROM public.auth_core__user WHERE email = $1
LIMIT 1`, SystemUserEmail, "System").Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("support assistant: resolve system user: %w", err)
	}
	return userID, nil
}

// recordProjectID writes the bootstrapped id into the same row the Features page
// edits, with the same statement that page uses, so the value the operator sees
// and the value this package reads are one row.
func (s *store) recordProjectID(ctx context.Context, projectID int64) error {
	encoded, err := json.Marshal(projectID)
	if err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `
INSERT INTO centry.platform_config (section, key, value, updated_at, updated_by)
VALUES ($1, $2, $3::jsonb, now(), $4)
ON CONFLICT (section, key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
		platformconfig.SectionSupportAssistant,
		platformconfig.KeySupportProjectID,
		string(encoded),
		"support_assistant_bootstrap",
	); err != nil {
		return fmt.Errorf("support assistant: record project id: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// enrolment
// ---------------------------------------------------------------------------

// ensureEnrolled grants `viewer` in the support project to a caller who holds no
// role there, mirroring `module.ensure_user_enrolled`.
//
// `viewer` and not more. Migration 0068/0070 give the default-mode viewer every
// permission this package's routes ask for — list, create, delete, details,
// messages.create, messages.delete, attachments.create — so viewer is both
// sufficient and the least this feature can ask for. Enrolling everybody as
// editor would hand every user on the platform the ability to edit whatever else
// ever lands in that project.
func (s *store) ensureEnrolled(ctx context.Context, projectID, userID int64) error {
	var exists bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1 FROM public.auth_core__project_user_role
    WHERE project_id = $1 AND user_id = $2
)`, projectID, userID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("support assistant: read membership: %w", err)
	}
	if exists {
		return nil
	}
	if _, err := s.pool.Exec(ctx, `
INSERT INTO public.auth_core__project_user_role (project_id, user_id, role_id)
SELECT $1, $2, role.id
FROM public.auth_core__project_role AS role
WHERE role.project_id = $1 AND role.name = 'viewer'
ON CONFLICT (project_id, user_id, role_id) DO NOTHING`, projectID, userID); err != nil {
		return fmt.Errorf("support assistant: enrol: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// conversations
// ---------------------------------------------------------------------------

// Conversation is one row of the widget's history list. The field names are the
// ones `@eliteaai/elitea-assistant`'s `TConversationListItem` reads.
type Conversation struct {
	ID                int64          `json:"id"`
	UUID              string         `json:"uuid"`
	Name              string         `json:"name"`
	IsPrivate         bool           `json:"is_private"`
	AuthorID          int64          `json:"author_id"`
	Source            string         `json:"source"`
	Meta              map[string]any `json:"meta"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	MessageGroupCount int            `json:"message_groups_count"`
}

func tenantSchema(projectID int64) string {
	return "p_" + strconv.FormatInt(projectID, 10)
}

// listConversations returns the CALLER'S support conversations, newest first.
func (s *store) listConversations(
	ctx context.Context, projectID, userID int64, limit, offset int, query string,
) ([]Conversation, int, error) {
	schema := tenantSchema(projectID)

	var total int
	countStatement := fmt.Sprintf(`
SELECT COUNT(*) FROM %q.chat_conversations c
WHERE c.author_id = $1 AND c.source = $2 AND ($3 = '' OR c.name ILIKE '%%' || $3 || '%%')`, schema)
	if err := s.pool.QueryRow(ctx, countStatement, userID, supportSource, query).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("support assistant: count conversations: %w", err)
	}

	statement := fmt.Sprintf(`
SELECT c.id, c.uuid::text, c.name, c.is_private, c.author_id, c.source, c.meta,
       c.created_at, COALESCE(c.updated_at, c.created_at),
       (SELECT COUNT(*) FROM %q.chat_message_group mg WHERE mg.conversation_id = c.id)
FROM %q.chat_conversations c
WHERE c.author_id = $1 AND c.source = $2 AND ($3 = '' OR c.name ILIKE '%%' || $3 || '%%')
ORDER BY COALESCE(c.updated_at, c.created_at) DESC, c.id DESC
LIMIT $4 OFFSET $5`, schema, schema)

	rows, err := s.pool.Query(ctx, statement, userID, supportSource, query, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("support assistant: list conversations: %w", err)
	}
	defer rows.Close()

	items := make([]Conversation, 0, limit)
	for rows.Next() {
		conversation, err := scanConversation(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, conversation)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("support assistant: list conversations: %w", err)
	}
	return items, total, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanConversation(row scanner) (Conversation, error) {
	var conversation Conversation
	var meta []byte
	if err := row.Scan(
		&conversation.ID, &conversation.UUID, &conversation.Name, &conversation.IsPrivate,
		&conversation.AuthorID, &conversation.Source, &meta,
		&conversation.CreatedAt, &conversation.UpdatedAt, &conversation.MessageGroupCount,
	); err != nil {
		return Conversation{}, fmt.Errorf("support assistant: read conversation: %w", err)
	}
	conversation.Meta = map[string]any{}
	if len(meta) > 0 {
		_ = json.Unmarshal(meta, &conversation.Meta) // trusted internal column
	}
	return conversation, nil
}

// createConversation inserts one support conversation.
//
// `source`, `is_private` and the `meta` document are transcribed from
// `api/v2/conversations.py`'s POST: hidden, private, typed `support`, with
// `internal_tools: ['internal_mcp']`. They are written HERE rather than accepted
// from the client for the obvious reason — a client that could choose
// `is_hidden: false` could publish its own support transcript into the shared
// project's ordinary chat listing.
func (s *store) createConversation(
	ctx context.Context, projectID, userID int64, name string,
) (Conversation, error) {
	schema := tenantSchema(projectID)
	meta, err := json.Marshal(map[string]any{
		"is_hidden":         true,
		"conversation_type": supportSource,
		"internal_tools":    []string{"internal_mcp"},
	})
	if err != nil {
		return Conversation{}, err
	}

	statement := fmt.Sprintf(`
INSERT INTO %q.chat_conversations (uuid, name, is_private, author_id, meta, source)
VALUES (gen_random_uuid(), $1, TRUE, $2, $3::jsonb, $4)
RETURNING id, uuid::text, name, is_private, author_id, source, meta,
          created_at, COALESCE(updated_at, created_at), 0`, schema)

	row := s.pool.QueryRow(ctx, statement, name, userID, string(meta), supportSource)
	return scanConversation(row)
}

// conversationOwnedByCaller resolves a conversation UUID to its row id, and is
// the ONLY way the mutating routes address a conversation.
//
// It is a single statement rather than a fetch-then-check because the two are
// not equivalent: a check performed in the handler can be skipped by the next
// route somebody adds, and "not yours" and "does not exist" must answer the same
// 404 — a distinct 403 for somebody else's conversation would confirm that the
// UUID names a real support conversation belonging to a real other user.
func (s *store) conversationOwnedByCaller(
	ctx context.Context, projectID, userID int64, conversationUUID string,
) (int64, error) {
	schema := tenantSchema(projectID)
	statement := fmt.Sprintf(`
SELECT c.id FROM %q.chat_conversations c
WHERE c.uuid = $1::uuid AND c.author_id = $2 AND c.source = $3`, schema)

	var conversationID int64
	err := s.pool.QueryRow(ctx, statement, conversationUUID, userID, supportSource).Scan(&conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, errConversationNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("support assistant: resolve conversation: %w", err)
	}
	return conversationID, nil
}

var errConversationNotFound = errors.New("conversation not found")

// conversationByID re-reads one conversation for the details response. It is a
// second read rather than a wider first one because the ownership lookup has a
// single job — decide whether this caller may address this row — and a lookup
// that also returns a payload invites a caller to be added later that uses the
// payload and skips the decision.
func (s *store) conversationByID(ctx context.Context, projectID, conversationID int64) (Conversation, error) {
	schema := tenantSchema(projectID)
	statement := fmt.Sprintf(`
SELECT c.id, c.uuid::text, c.name, c.is_private, c.author_id, c.source, c.meta,
       c.created_at, COALESCE(c.updated_at, c.created_at),
       (SELECT COUNT(*) FROM %q.chat_message_group mg WHERE mg.conversation_id = c.id)
FROM %q.chat_conversations c WHERE c.id = $1`, schema, schema)
	return scanConversation(s.pool.QueryRow(ctx, statement, conversationID))
}
