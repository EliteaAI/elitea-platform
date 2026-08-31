package sharedchat

import (
	"context"
	"errors"
	"time"
)

// ErrNoLink is what a Store returns when a token resolves to nothing. It is the
// SINGLE error for "no such token", "revoked" and "expired" as far as the
// anonymous surface is concerned — Handler.View maps all three onto one status
// on purpose, and the Store therefore never has to be trusted to keep them
// apart at the boundary.
var ErrNoLink = errors.New("sharedchat: no such link")

// Link is one share link as its OWNER sees it.
//
// There is no `Token` field, and that is the whole point of the design: the
// token is minted, returned once by Create, and never readable again — see
// CreateResult. A listing that could re-show the token would mean the token
// were stored in a recoverable form, which is exactly what
// migrations/shared/0100 refuses to do.
type Link struct {
	ID              int64      `json:"id"`
	Scope           string     `json:"scope"`
	HasPassword     bool       `json:"has_password"`
	MessageGroupIDs []int64    `json:"message_group_ids,omitempty"`
	CreatedBy       string     `json:"created_by"`
	CreatedAt       time.Time  `json:"created_at"`
	ExpiresAt       time.Time  `json:"expires_at"`
	RevokedAt       *time.Time `json:"revoked_at,omitempty"`
	AccessCount     int64      `json:"access_count"`
	LastAccessedAt  *time.Time `json:"last_accessed_at,omitempty"`
	// Active is derived, not stored: a link is usable only while it is
	// neither revoked nor past its expiry. It is computed server-side so
	// that a client cannot disagree with the server about which of its own
	// links still works.
	Active bool `json:"active"`
}

// CreateInput is one authorised request to publish a conversation.
type CreateInput struct {
	ProjectID       string
	ConversationID  int64
	Scope           string
	MessageGroupIDs []int64
	// TokenHash is SHA-256 of the minted token. The plaintext never crosses
	// this boundary, so no Store implementation is in a position to persist it
	// even by mistake.
	TokenHash    []byte
	PasswordHash []byte
	PasswordSalt []byte
	CreatedBy    string
	ExpiresAt    time.Time
}

// Resolved is what a token buys: enough to find the conversation, and enough to
// decide whether the holder may see it yet.
//
// PasswordHash/PasswordSalt cross this boundary because the verification is the
// handler's (it owns the timing-equalisation strategy, which a Store cannot).
// Nothing about the conversation's CONTENT is in here.
type Resolved struct {
	ID              int64
	ProjectID       string
	ConversationID  int64
	Scope           string
	MessageGroupIDs []int64
	PasswordHash    []byte
	PasswordSalt    []byte
	ExpiresAt       time.Time
}

// SharedMessage is one message group as the anonymous view renders it.
//
// The field set is the whole security contract of this feature and is
// enumerated rather than passed through: see Handler.View for what is
// deliberately absent and why.
type SharedMessage struct {
	// ID is an ORDINAL within this response (0, 1, 2 …), not the database's
	// message-group id. A shared page has no legitimate use for the real id —
	// it is a React key and nothing more — and emitting it would hand an
	// anonymous holder a valid identifier for an authenticated API.
	ID                   int               `json:"id"`
	AuthorType           string            `json:"author_type"`
	AuthorName           string            `json:"author_name,omitempty"`
	ParticipantType      string            `json:"participant_type,omitempty"`
	ParticipantAgentType string            `json:"participant_agent_type,omitempty"`
	CreatedAt            time.Time         `json:"created_at"`
	IsError              bool              `json:"is_error"`
	Items                []SharedMessageIt `json:"items"`
}

// SharedMessageIt is one part of a shared message group.
type SharedMessageIt struct {
	Type       string            `json:"type"`
	Content    string            `json:"content,omitempty"`
	Attachment *SharedAttachment `json:"attachment,omitempty"`
}

// SharedAttachment names a file that rode a shared message.
//
// NAME AND TYPE ONLY. No bucket, no object key, no download URL: the bytes are
// not served to anonymous callers at all (see Handler.View), so a locator would
// be an unusable string that nonetheless discloses this deployment's storage
// layout.
type SharedAttachment struct {
	Name string `json:"name"`
	Type string `json:"attachment_type,omitempty"`
}

// TranscriptStore reads the conversation a resolved link points at.
//
// It is a SEPARATE interface from Store because the two have different
// tenancy: Store is one central table, this reads a project's own schema. The
// split is also what lets the route tests exercise refusal paths with no
// transcript reader wired at all.
type TranscriptStore interface {
	// SharedTranscript returns the conversation's display name and the
	// messages in scope, oldest first. `groupIDs` empty means the whole
	// conversation; otherwise ONLY those groups.
	SharedTranscript(ctx context.Context, projectID string, conversationID int64, groupIDs []int64) (name string, messages []SharedMessage, err error)
}

// Store is the central share-link table.
type Store interface {
	Create(ctx context.Context, in CreateInput) (Link, error)
	ListByConversation(ctx context.Context, projectID string, conversationID int64) ([]Link, error)
	// Revoke stamps revoked_at. It is scoped by project AND conversation as
	// well as by id, so that a caller authorised on one conversation cannot
	// revoke a link belonging to another by guessing a serial id.
	Revoke(ctx context.Context, projectID string, conversationID, linkID int64) error
	// ResolveByTokenHash returns ErrNoLink for a hash that matches nothing,
	// matches a revoked row, or matches an expired row. The three are one
	// answer by design.
	ResolveByTokenHash(ctx context.Context, tokenHash []byte) (Resolved, error)
	// RecordAccess bumps the owner-visible counter. Failures are never
	// allowed to fail the read — see Handler.View.
	RecordAccess(ctx context.Context, linkID int64) error
}
