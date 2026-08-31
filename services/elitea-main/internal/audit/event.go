// Package audit writes `centry.audit_events` — the table the admin Audit Trail
// reads and, until this package existed, the table NOTHING in production wrote.
//
// # The state this replaces
//
// The read surface was complete and correct: four endpoints in
// internal/api/v2/eliteacore/audit.go, a per-project activity count in
// project_activity.go, an analytics join in internal/api/v2/analytics/costs.go,
// and three SPA consumers (AuditTrail, ProjectUserActivity,
// ScheduleHistoryDrawer). All of them read a table whose only writers were the
// E2E seeder (apps/elitea-web/scripts/e2e-stack.sh) and test fixtures.
// internal/api/generated/api.gen.go said so outright: "READ-ONLY from this
// service. Never emitted today." A grep over EVERY file type (not just .go/.sql
// — a previous investigation in this repo missed a writer that lived as shell
// inside a YAML template) confirms there was no third writer.
//
// So the Audit Trail page rendered an empty state in every real deployment, and
// the empty state was indistinguishable from "nothing happened". This package
// is the producer.
//
// # The vocabulary is not invented
//
// The readers are the contract. `event_type` must come from the set the SPA
// colours and tabs by (apps/elitea-web/src/pages/admin/auditPalette.json and
// api/adminAuditApi.ts): api, socketio, rpc, agent, tool, llm on the "user"
// tab; schedule, admin_task on the "system" tab. This service emits `api` — the
// same type legacy's Flask middleware span produced
// (legacy/plugins/tracing/utils/audit_processor.py `_extract_api`), with the
// same meaning: one completed HTTP request. `action` mirrors that extractor's
// span name, `"METHOD /route"`. A writer that invented its own type strings
// would leave both tabs empty, which is where we started.
//
// `is_error` means "the recorded operation failed" — `status_code >= 400` for
// an HTTP span, exactly `_extract_api`'s rule. `duration_ms` is wall clock in
// milliseconds and is what the heatmap buckets into the five duration bands in
// audit_query.go; a row with no duration belongs to no band, so this package
// always records one rather than leaving it NULL.
package audit

import (
	"context"
	"time"
)

// Event is one `centry.audit_events` row.
//
// The fields are exactly the columns the readers select
// (internal/api/v2/eliteacore/audit.go `auditSpan`), minus the LLM accounting
// columns — input_tokens, output_tokens, llm_cost, token_source, cost_source,
// model_name. Those belong to the model-call path, which in this architecture
// is the gateway's request log (shared migration 0099), not elitea-main's
// request path. Emitting zeroes into them here would put a second, disagreeing
// cost ledger under the analytics reads.
type Event struct {
	// Timestamp is when the recorded operation COMPLETED, matching legacy,
	// which built it from the span's end time.
	Timestamp time.Time

	UserID    *int64
	UserEmail string
	ProjectID *int64

	// EventType is one of the values the SPA knows. See the package doc.
	EventType string
	// Action is the human label the trail's Action column shows.
	Action string

	HTTPMethod string
	// HTTPRoute is the matched ROUTE PATTERN, never the raw target. The raw
	// target carries project, user, token and entity ids; the pattern is
	// bounded, groupable, and safe to render in an admin table.
	HTTPRoute  string
	StatusCode *int32
	DurationMS *float64
	IsError    bool

	EntityType string
	EntityID   *int64
	EntityName string

	TraceID      string
	SpanID       string
	ParentSpanID string
}

// Recorder accepts an event for eventual persistence.
//
// Record MUST NOT block the caller and MUST NOT return an error: an audit write
// may never fail the request it describes. See PostgresRecorder for what
// happens instead when the write cannot be made.
type Recorder interface {
	Record(ctx context.Context, event Event)
}

/* ── annotation ─────────────────────────────────────────────────────────── */

type annotationKey struct{}

// Annotation is the domain meaning a handler can add to the record the audit
// middleware will write for the request it is serving.
//
// This is the answer to the level-of-emission trade-off (see
// internal/api/middleware/audit.go): the middleware alone knows HTTP shape but
// not what the request MEANT, and explicit call sites know the meaning but are
// forgotten on new routes. With an annotation, forgetting degrades a row from
// "PUT /api/v2/admin/user_suspend/{mode}/{userID} on user 42" to
// "PUT /api/v2/admin/user_suspend/{mode}/{userID}" — it never degrades to no
// row at all, which is the failure this whole package exists to remove.
//
// Only non-zero fields overwrite. A handler that annotates nothing changes
// nothing.
type Annotation struct {
	EventType  string
	Action     string
	EntityType string
	EntityID   *int64
	EntityName string
	ProjectID  *int64
}

// AnnotationSlot is the mutable cell the middleware puts on the context before
// calling the handler and reads back after. A pointer is necessary: context
// values set by an inner handler are invisible to the middleware that wrapped
// it, because a context flows down and never back up.
type AnnotationSlot struct {
	annotation Annotation
	present    bool
}

// ContextWithAnnotationSlot marks ctx as "this request is being audited" and
// gives handlers somewhere to write. Called only by the audit middleware.
func ContextWithAnnotationSlot(ctx context.Context) (context.Context, *AnnotationSlot) {
	slot := &AnnotationSlot{}
	return context.WithValue(ctx, annotationKey{}, slot), slot
}

// Read returns the accumulated annotation and whether any handler wrote one.
func (s *AnnotationSlot) Read() (Annotation, bool) {
	if s == nil {
		return Annotation{}, false
	}
	return s.annotation, s.present
}

// Annotate records domain meaning for the request being served.
//
// It is a no-op — not an error and not a panic — when the request is not being
// audited, so a handler may call it unconditionally. That is deliberate: a
// handler must not have to know the audit policy, and a policy change must not
// be able to turn a handler into a panic.
//
// Not safe for concurrent calls within one request. Handlers are single
// goroutine per request; a handler that fans out must annotate before it does.
func Annotate(ctx context.Context, a Annotation) {
	slot, ok := ctx.Value(annotationKey{}).(*AnnotationSlot)
	if !ok || slot == nil {
		return
	}
	slot.present = true
	if a.EventType != "" {
		slot.annotation.EventType = a.EventType
	}
	if a.Action != "" {
		slot.annotation.Action = a.Action
	}
	if a.EntityType != "" {
		slot.annotation.EntityType = a.EntityType
	}
	if a.EntityID != nil {
		slot.annotation.EntityID = a.EntityID
	}
	if a.EntityName != "" {
		slot.annotation.EntityName = a.EntityName
	}
	if a.ProjectID != nil {
		slot.annotation.ProjectID = a.ProjectID
	}
}

// ID is a convenience for the pointer fields above.
func ID(value int64) *int64 { return &value }
