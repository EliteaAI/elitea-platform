// Package pagination provides cursor-based pagination helpers.
package pagination

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
)

const (
	defaultLimit = 20
	maxLimit     = 100
)

// Cursor is an opaque page token encoding the last-seen row ID and sort key.
type Cursor struct {
	ID    string
	After string
}

// Encode encodes the cursor to a base64 URL-safe string.
func (c Cursor) Encode() string {
	raw := fmt.Sprintf("%s:%s", c.ID, c.After)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeCursor decodes a base64 cursor token back to a Cursor.
func DecodeCursor(token string) (Cursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return Cursor{}, fmt.Errorf("pagination: decode cursor: %w", err)
	}
	// Simple "id:after" format; adjust to match actual sort key.
	for i, ch := range b {
		if ch == ':' {
			return Cursor{ID: string(b[:i]), After: string(b[i+1:])}, nil
		}
	}
	return Cursor{ID: string(b)}, nil
}

// Page holds the parsed pagination parameters from a request.
type Page struct {
	Limit  int
	Cursor Cursor
}

// FromRequest parses ?limit= and ?cursor= query parameters.
func FromRequest(r *http.Request) (Page, error) {
	p := Page{Limit: defaultLimit}

	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return p, fmt.Errorf("pagination: invalid limit %q", raw)
		}
		if n > maxLimit {
			n = maxLimit
		}
		p.Limit = n
	}

	if token := r.URL.Query().Get("cursor"); token != "" {
		c, err := DecodeCursor(token)
		if err != nil {
			return p, err
		}
		p.Cursor = c
	}

	return p, nil
}

// Response is the pagination metadata returned alongside a list of items.
type Response struct {
	NextCursor string `json:"next_cursor,omitempty"`
	HasMore    bool   `json:"has_more"`
	Total      int    `json:"total,omitempty"`
}
