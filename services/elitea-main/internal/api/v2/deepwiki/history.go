package deepwiki

// Server-side history for the wiki chat drawer.
//
// Until this file the drawer's conversation lived in the BROWSER — a
// namespaced localStorage key per (project, toolkit),
// apps/elitea-web/src/widgets/deepwiki/lib/chatStorage.ts. That is history in
// the sense that a sticky note is a filing cabinet: it is gone on another
// device, in another browser, and on a cleared profile, and nobody but that
// one browser can ever see it.
//
// A wiki chat is now an ORDINARY TENANT CONVERSATION — `p_{id}.chat_conversations`
// with `source = 'deepwiki'` and a participant of `entity_name = 'toolkit'`.
// No migration: migrations/tenant/0123 already declares `source` on the
// conversation, `entity_name` on the participant and `task_id` on the message
// group, which are the three columns this feature needs.
//
// # BOTH TURNS ARE WRITTEN HERE, NEVER BY THE BROWSER
//
// A client-authorable assistant turn is forgery — it would let any caller put
// words in the model's mouth in a transcript that is then read back as a
// record of what the model said. There is also no message-create route to do
// it with. So:
//
//   - The QUESTION is written from the invoke, through material.Observer:
//     after the hop, from the body the CLIENT sent (never the rewritten one,
//     which carries credentials) and the invocation id the provider answered
//     with.
//   - The ANSWER is written by TEEING the terminal poll. The browser drains
//     its answer THROUGH this facade — `GET /deepwiki/invocations/...` is a
//     proxy route — so the facade does see the terminal payload, and that is
//     the only moment it does.
//
// `chat_message_group.task_id` carries the invocation id on the question, and
// the answer is inserted as the reply to that group. That is what makes the
// tee idempotent: a poll loop that reaches the terminal payload twice — and
// it does, because nothing stops the browser polling once more after the
// answer arrives — finds the reply already there and writes nothing.
//
// # THE ACCEPTED GAP (v1)
//
// If the tab closes between the invoke and the terminal poll, the QUESTION is
// stored and the ANSWER is not. The invocation still runs and still finishes;
// nothing re-polls it, because a poll only happens when a browser asks. The
// conversation then shows a question with no reply.
//
// This is accepted rather than half-built. Reconciling would mean elitea-main
// polling the provider on its own — a background worker holding a client the
// facade does not have (it owns a ReverseProxy, not an API client), a
// schedule, and a rule for when to give up. That is a feature, not a detail
// of this one. What this file does instead is make the gap VISIBLE: every
// recorded question logs at info with its invocation id, so an unanswered
// turn can be traced to the invocation that was never drained.
//
// # THE STORE SEAM
//
// The store interface is `internal/domain/wikichat.Store`, declared in its own
// package rather than here. The support assistant's ChatStore could sit in its
// handler package because nothing under internal/infra/db/repos imports that
// handler; this facade is not in that position — its credential resolver
// reaches providerhost/material, which imports repos — so a repository naming
// this package's types would close the loop. See that package's doc comment.

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/wikichat"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/material"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/proxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/routes"
)

// The two request headers the drawer sends with an invoke.
//
// HEADERS AND NOT BODY FIELDS. The body is an SPI envelope that travels to
// the provider verbatim apart from the rewrite; a key put there for
// elitea-main's own bookkeeping would be forwarded to a service that has no
// idea what it means, and stripping it would mean teaching the shared
// envelope about one facade's feature. Both headers are read and DELETED
// before the hop.
const (
	// ChatKeyHeader carries the conversation this question belongs to. It is
	// a client-chosen opaque key, and choosing it is not a privilege: every
	// statement that resolves it also requires `author_id = the caller`, so
	// the worst a caller can do with somebody else's key is fail to match it
	// and open a conversation of their own.
	ChatKeyHeader = "X-Elitea-Wiki-Chat"
	// ToolkitHeader carries the toolkit row the drawer is open on, which is
	// what the conversation is filed under and what the drawer lists by. The
	// invoke body cannot supply it: `Wikis` names a code toolkit, `wikis_query`
	// names a Wikis toolkit and `wiki_query` names nothing at all (wikis.go),
	// so there is no one field that means "the wiki I am looking at".
	ToolkitHeader = "X-Elitea-Wiki-Toolkit"
)

// maxChatKeyLength bounds the opaque key. A UUID is 36 characters; the bound
// exists so a caller cannot make the store compare megabyte strings.
const maxChatKeyLength = 64

// pollCaptureLimit bounds the terminal payload this facade buffers. A
// completed `deep_research` result is the largest thing on this route and is
// measured in tens of kilobytes; a megabyte is well past it, and a body over
// the limit is recorded as a failure to read rather than as a truncated
// answer.
const pollCaptureLimit = 1 << 20

// History records wiki conversations. A nil History records nothing and
// serves everything, which is what a deployment with no database pool gets.
type History struct {
	store  wikichat.Store
	logger *slog.Logger
}

// NewHistory builds the recorder. A nil store yields a nil History rather
// than one that fails on every turn: the facade must serve a wiki chat that
// is not being recorded, exactly as it did before this feature existed.
func NewHistory(store wikichat.Store, logger *slog.Logger) *History {
	if store == nil {
		return nil
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &History{store: store, logger: logger}
}

// chatContextKey carries the two headers from the route wrapper to the
// observer, which runs inside material.Invocation.Serve and never sees the
// request.
type chatContextKey struct{}

type chatContext struct {
	key       string
	toolkitID int64
}

// WrapInvoke reads the drawer's two headers, strips them, and remembers them
// for the observer. It is a no-op wrapper on a nil History.
func (h *History) WrapInvoke(next http.HandlerFunc) http.HandlerFunc {
	if h == nil {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request) {
		chat := chatContext{key: strings.TrimSpace(r.Header.Get(ChatKeyHeader))}
		if id, err := strconv.ParseInt(strings.TrimSpace(r.Header.Get(ToolkitHeader)), 10, 64); err == nil {
			chat.toolkitID = id
		}
		// Deleted whether or not they were readable: a header this platform
		// gives a meaning to must not also reach the provider, where it means
		// something else or nothing.
		r.Header.Del(ChatKeyHeader)
		r.Header.Del(ToolkitHeader)
		if chat.key == "" {
			// NOT a warning, and this is the case that matters: every wiki
			// GENERATION is an invoke on this same route, and a generation
			// has no conversation. Logging here would put a line per
			// generation in the log for a request that is behaving correctly.
			next(w, r)
			return
		}
		if len(chat.key) > maxChatKeyLength || chat.toolkitID <= 0 {
			// A key with no usable toolkit IS worth a line: the drawer meant
			// to record this turn and something about the request stopped it.
			// The question is still asked and still answered — it is simply
			// not filed, because filing it under a made-up toolkit would put
			// it in a drawer that never lists it.
			h.logger.Warn("deepwiki: wiki chat turn is not recorded",
				"reason", "the request named a conversation key but no usable toolkit")
			next(w, r)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), chatContextKey{}, chat)))
	}
}

// Observer is the invoke hook, or nil when nothing is being recorded.
//
// A METHOD VALUE WOULD NOT DO. `h.Observe` on a nil *History is a non-nil
// func value, so handing it straight to material.Invocation would switch on
// body capture for a facade that records nothing — the shape of "absence
// reads as presence" this codebase has been bitten by before. Returning a
// typed nil is what makes the caller's `!= nil` mean what it says.
func (h *History) Observer() material.Observer {
	if h == nil {
		return nil
	}
	return h.observe
}

// observe writes the question of one served invoke.
func (h *History) observe(ctx context.Context, served material.Served) {
	chat, ok := ctx.Value(chatContextKey{}).(chatContext)
	if !ok || chat.key == "" {
		return
	}
	if served.Status < 200 || served.Status >= 300 {
		// A refused invoke started nothing. Recording the question would put
		// a turn in the transcript that no answer can ever join.
		return
	}
	invocationID := invocationIDOf(served.Response)
	if invocationID == "" {
		// An acceptance with no invocation id is a run nothing can follow —
		// the browser refuses it too (entities/provider-run/invocationId.ts).
		h.logger.Warn("deepwiki: accepted invoke carried no invocation id; the question is not recorded",
			"project", served.ProjectID)
		return
	}
	question := questionOf(served.Request)
	if question == "" {
		return
	}

	record := wikichat.Question{
		ProjectID:    served.ProjectID,
		UserID:       served.UserID,
		ChatKey:      chat.key,
		ToolkitID:    chat.toolkitID,
		ToolkitName:  served.ToolkitName,
		Capability:   CapabilityOf(served.ToolName),
		Question:     question,
		InvocationID: invocationID,
	}
	if err := h.store.RecordQuestion(ctx, record); err != nil {
		// Not surfaced to the caller: the invocation is already running and
		// the answer is already on its way. Losing the transcript is worse
		// than nothing and better than failing a question that succeeded.
		h.logger.Error("deepwiki: record wiki question",
			"project", record.ProjectID, "invocation", invocationID, "err", err)
		return
	}
	// The gap this line exists for is in the file header: nothing re-polls an
	// invocation the browser abandons, so a question logged here with no
	// matching "record wiki answer" is a turn whose answer was never drained.
	h.logger.Info("deepwiki: wiki question recorded",
		"project", record.ProjectID, "toolkit", record.ToolkitID,
		"invocation", invocationID, "capability", record.Capability)
}

// Poll is the GET-invocation hop with the terminal payload teed off it.
//
// It forwards through `inner` unchanged — the caller's bytes are the
// provider's bytes — and reads a COPY that providerhost/proxy buffers in
// ModifyResponse. Nothing about the response the browser receives depends on
// whether the recording succeeds.
func (h *History) Poll(inner routes.Forwarder) routes.Forwarder {
	if h == nil {
		return inner
	}
	return func(w http.ResponseWriter, r *http.Request, providerPath, projectID, userID string) {
		outcome := &proxy.Outcome{CaptureLimit: pollCaptureLimit}
		inner(w, r.WithContext(proxy.WithOutcome(r.Context(), outcome)), providerPath, projectID, userID)
		h.record(r, outcome, providerPath, projectID, userID)
	}
}

// record writes the answer a terminal poll carried.
func (h *History) record(
	r *http.Request, outcome *proxy.Outcome, providerPath, projectID, userID string,
) {
	if outcome.Status != http.StatusOK || len(outcome.Body) == 0 {
		return
	}
	if outcome.Truncated {
		h.logger.Warn("deepwiki: poll payload exceeded the capture limit; the answer is not recorded",
			"path", providerPath)
		return
	}
	project, projectErr := strconv.ParseInt(projectID, 10, 64)
	user, userErr := strconv.ParseInt(userID, 10, 64)
	if projectErr != nil || userErr != nil || project <= 0 || user <= 0 {
		return
	}
	terminal, ok := terminalAnswer(outcome.Body)
	if !ok {
		return
	}
	terminal.ProjectID = project
	terminal.UserID = user

	// WithoutCancel: the browser has its answer, so its context may already
	// be cancelled — and the write that makes the answer durable must not be
	// the casualty of the request that delivered it.
	written, err := h.store.RecordAnswer(context.WithoutCancel(r.Context()), terminal)
	if err != nil {
		h.logger.Error("deepwiki: record wiki answer",
			"project", project, "invocation", terminal.InvocationID, "err", err)
		return
	}
	if written {
		h.logger.Info("deepwiki: wiki answer recorded",
			"project", project, "invocation", terminal.InvocationID, "is_error", terminal.IsError)
	}
}

// CapabilityOf names which of the two agents a tool is. It is the label the
// drawer renders on the answer, and the reason it is stored rather than
// derived on read: the toggle can move, and a transcript must say what
// actually ran.
func CapabilityOf(toolName string) string {
	if toolName == "deep_research" {
		return "research"
	}
	return "ask"
}

// invocationIDOf reads `invocation_id` out of an accepted invoke.
func invocationIDOf(body []byte) string {
	var payload struct {
		InvocationID string `json:"invocation_id"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	return payload.InvocationID
}

// questionOf reads the question out of the client's invoke body.
func questionOf(body []byte) string {
	var payload struct {
		Parameters struct {
			Question string `json:"question"`
		} `json:"parameters"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.Parameters.Question)
}

// pollPayload is the terminal envelope, as entities/provider-run spells it.
type pollPayload struct {
	InvocationID string `json:"invocation_id"`
	Status       string `json:"status"`
	Result       string `json:"result"`
	Message      string `json:"message"`
}

// terminalAnswer decides whether one poll ended the invocation, and what it
// said.
//
// The status vocabulary and the fallbacks are the browser's
// (entities/provider-run/model/poll.ts `terminalOutcome`), deliberately: a
// transcript that disagreed with the bubble the user was looking at would be
// worse than no transcript.
func terminalAnswer(body []byte) (wikichat.Answer, bool) {
	var payload pollPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return wikichat.Answer{}, false
	}
	if payload.InvocationID == "" || payload.Status == "" {
		return wikichat.Answer{}, false
	}
	switch payload.Status {
	case "Completed":
		content := AnswerText(payload.Result)
		if content == "" {
			return wikichat.Answer{}, false
		}
		return wikichat.Answer{InvocationID: payload.InvocationID, Content: content}, true
	case "Error", "Stopped":
		content := firstNonEmpty(payload.Result, payload.Message, "The request failed.")
		return wikichat.Answer{InvocationID: payload.InvocationID, Content: content, IsError: true}, true
	default:
		// Started, InProgress, or a status this build has never heard of.
		// Recording an unknown status as an answer would settle a turn that
		// is still running.
		return wikichat.Answer{}, false
	}
}

// AnswerText reads the answer out of a `Completed` result.
//
// It is a Go transcription of the browser's `readAnswer`
// (features/wiki-chat/model/frames/terminalFrames.ts) and covers the same
// shapes: the platform's result array, a JSON envelope naming one of four
// keys, and a bare string. Where the browser and this disagree the browser
// wins, because it is what the user saw — so the fallbacks are the same and
// in the same order, including the "raw string, key order and all" last
// resort.
func AnswerText(result string) string {
	trimmed := strings.TrimSpace(result)
	if trimmed == "" {
		return ""
	}
	if !strings.HasPrefix(trimmed, "[") && !strings.HasPrefix(trimmed, "{") {
		return trimmed
	}
	var parsed any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		// A brace-first sentence must not cost the user their answer.
		return trimmed
	}
	switch value := parsed.(type) {
	case []any:
		return resultArrayText(value)
	case map[string]any:
		if text := firstTruthyText(value, "answer", "result", "message", "data"); text != "" {
			return text
		}
		return trimmed
	default:
		return trimmed
	}
}

// resultArrayText joins every `message` object's data, in order — the shape
// `ask` answers with, where the answer and its "Sources:" list are two
// separate entries. Keeping only the first dropped the sources (DWIKI-012).
func resultArrayText(entries []any) string {
	var parts []string
	for _, entry := range entries {
		object, ok := entry.(map[string]any)
		if !ok || primitiveText(object["object_type"]) != "message" {
			continue
		}
		if text := primitiveText(object["data"]); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}

// firstTruthyText is the browser's `firstTruthy` chain: `||` and not `??`, so
// an empty `answer` falls through to `result` rather than stopping there.
func firstTruthyText(object map[string]any, keys ...string) string {
	for _, key := range keys {
		if text := primitiveText(object[key]); text != "" {
			return text
		}
	}
	return ""
}

// primitiveText renders a JSON scalar the way the browser's `primitiveText`
// does, and refuses a composite: an object rendered as `[object Object]` —
// or, here, as its Go formatting — is not an answer.
func primitiveText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
