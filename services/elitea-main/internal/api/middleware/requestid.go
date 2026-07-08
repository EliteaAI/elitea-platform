package middleware

import (
	chimw "github.com/go-chi/chi/v5/middleware"
)

// RequestID is a thin wrapper around chi's built-in RequestID middleware so
// that callers import from a single package.
var RequestID = chimw.RequestID
