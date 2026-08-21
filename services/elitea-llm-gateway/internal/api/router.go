// Package api mounts the gateway's /llm chi routes. The route ordering is the
// dialect discriminator: the Anthropic surface shares the /llm/v1/ prefix with
// OpenAI callers (ChatAnthropic posts to {base}/llm/v1/messages), so the exact
// /llm/v1/messages route MUST be registered before the /llm/v1/* OpenAI
// catch-all or Anthropic callers are misrouted (design §3.1, §3.2). This
// ordering is a Build gate covered by regression tests.
package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/llmproxy"
)

// NewRouter builds the chi router for the /llm surface, wiring each route to
// the given handler. The routes are mounted under the full inbound path
// (/llm/v1/...) because elitea-main's reverse proxy preserves the path verbatim
// (no StripPrefix); the gateway sees /llm/v1/... exactly as the client sent it.
func NewRouter(h *llmproxy.Handler) http.Handler {
	r := chi.NewRouter()
	r.NotFound(h.NotFound)
	r.MethodNotAllowed(h.MethodNotAllowed)

	r.Route("/llm/v1", func(r chi.Router) {
		// Anthropic dialect — exact routes registered BEFORE the OpenAI
		// catch-all. count_tokens is synchronous (non-SSE); any other
		// /messages/{suffix} is 404 rather than misrouted.
		r.Post("/messages", h.Messages)
		r.Post("/messages/count_tokens", h.CountTokens)
		r.Post("/messages/*", h.MessagesSubPath)

		// OpenAI dialect — multipart image routes are decoded by the gateway
		// itself (net/http multipart), so they are mounted explicitly rather
		// than falling through the JSON catch-all.
		r.Post("/images/edits", h.ImageEdit)
		r.Post("/images/variations", h.ImageVariation)
		r.Post("/images/generations", h.ImageGeneration)

		// OpenAI dialect — audio. transcriptions/translations carry a
		// multipart body and are decoded by the gateway itself, like the
		// image edit/variation routes above. speech carries JSON and answers
		// raw audio bytes (issue #323, llmproxy/audio.go).
		r.Post("/audio/speech", h.Speech)
		r.Post("/audio/transcriptions", h.Transcription)
		r.Post("/audio/translations", h.Transcription)

		// OpenAI dialect — explicit JSON routes.
		r.Post("/chat/completions", h.Chat)
		r.Post("/completions", h.TextCompletion)
		r.Post("/embeddings", h.Embeddings)
		r.Post("/responses", h.Responses)

		// OpenAI dialect — the realtime WebSocket surface (llmproxy/realtime.go).
		// A WebSocket handshake is a GET, so GET is the route that matters; POST
		// is mounted beside it because the legacy pylon relay and several
		// hand-built clients post to the same path, and a 405 there is a
		// mis-diagnosable failure for a route whose real errors are already
		// hard to read.
		r.Get("/realtime", h.Realtime)
		r.Post("/realtime", h.Realtime)

		// Synthetic models surface — resolved from Postgres per project, NOT
		// routed through core (design §4.2, §3.4). The exact /models route is
		// the list; /models/* is a single-model lookup (the wildcard lets model
		// ids contain slashes, e.g. "openai/gpt-4o").
		r.Get("/models", h.Models)
		r.Get("/models/*", h.Model)

		// Connection-check surface (#319) — a real, minimal round trip to a
		// NOT-YET-SAVED credential, so it bypasses core entirely rather than
		// going through the persisted-credential Account path. See
		// llmproxy/checkconnection.go.
		r.Post("/check_connection", h.CheckConnection)
	})

	return r
}
