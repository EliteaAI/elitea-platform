package middleware

import "net/http"

// SecurityHeaders sets the response headers that stop a browser from
// interpreting an API response as a document.
//
// # Why this is middleware and not a per-handler call
//
// Eight handlers in this service set `X-Content-Type-Options: nosniff` on their
// own (the artifact content server, the branding reader, the avatar reader, the
// admin console shell, the browser-auth pages, and the two allowlisted binary
// readers). Every one of them serves a body a caller can influence. Nothing set
// the header on the JSON API, so the control depended on a handler author
// remembering it — and a header that protects only the routes somebody
// remembered is not a control.
//
// # What each header does here
//
//   - `X-Content-Type-Options: nosniff` stops content sniffing. Without it a
//     browser may ignore `application/json` and render a body as HTML when the
//     body starts with markup. That is the step a reflected value needs to
//     become script, and it is the reason CodeQL reports every response write
//     that carries caller text (go/reflected-xss, alerts 100 and 101). The two
//     sites it names, `middleware.statusRecorder.Write` and
//     `shadow.responseCapture.Write`, are pass-through wrappers: they forward
//     bytes and originate none. The control belongs where the response leaves
//     the service, which is here.
//   - `X-Frame-Options: DENY` stops framing of any API response.
//   - `Referrer-Policy: no-referrer` keeps a project or resource identifier in a
//     URL out of the Referer header of a cross-origin navigation.
//
// # What this does NOT do
//
// It sets no Content-Security-Policy. The SPA handlers own their own policy,
// because a policy strict enough for JSON breaks a document that loads scripts
// and styles. `adminui.Handler` sets that policy for the admin console (#177).
//
// It never REPLACES a header a handler already set. A handler that needs a
// different value keeps it: the middleware writes each header only when the
// handler left it empty. That matters for a route that must be framed or must
// send a referrer, and it keeps the middleware safe to add in front of every
// existing route.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		setIfAbsent(header, "X-Content-Type-Options", "nosniff")
		setIfAbsent(header, "X-Frame-Options", "DENY")
		setIfAbsent(header, "Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// setIfAbsent writes value only when the handler has not set the header.
//
// The headers must be written BEFORE the handler runs, because a header set
// after the first write never reaches the wire. Writing them first means a
// handler can still overwrite one, and `Header().Set` in the handler wins.
func setIfAbsent(header http.Header, name, value string) {
	if header.Get(name) == "" {
		header.Set(name, value)
	}
}
