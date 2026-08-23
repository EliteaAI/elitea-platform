package mcpregistry

// The PostgreSQL store behind `elitea_mcp.prebuilt_servers` (shared migration
// 0092).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrPrebuiltNotFound reports that no catalogue entry carries the key.
//
// It is distinct from a read failure. A caller that resolves a toolkit's
// settings treats "no such entry" as "nothing to inject" and carries on, and
// must not treat an unreadable table the same way: that would silently drop an
// operator's credentials into a request that then fails at the remote server
// with an authentication error naming nothing.
var ErrPrebuiltNotFound = errors.New("mcpregistry: no pre-built MCP server with that key")

// PrebuiltStore reads and writes the platform-wide pre-built MCP catalogue.
type PrebuiltStore struct {
	pool *pgxpool.Pool
}

func NewPrebuiltStore(pool *pgxpool.Pool) *PrebuiltStore { return &PrebuiltStore{pool: pool} }

const prebuiltColumns = `catalogue_key, display_name, server_url, base_url, client_id,
	client_secret_ref, timeout_seconds, headers, enabled`

// List returns every catalogue entry, ordered by display name.
//
// The order is by the operator's own spelling rather than by the normalised
// key, because the admin page renders display names and an alphabetical listing
// that is alphabetical in a column nobody sees reads as unordered.
func (s *PrebuiltStore) List(ctx context.Context) ([]PrebuiltServer, error) {
	if s == nil || s.pool == nil {
		return nil, ErrNoPool
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+prebuiltColumns+`
		   FROM elitea_mcp.prebuilt_servers
		  ORDER BY lower(display_name), catalogue_key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]PrebuiltServer, 0)
	for rows.Next() {
		entry, err := scanPrebuilt(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

// Lookup resolves one toolkit type or catalogue name to its entry.
//
// The argument is normalised here rather than by the caller, so every call site
// matches on the same rule and a caller cannot accidentally look up a raw
// toolkit type against a normalised column.
//
// A DISABLED entry is returned, not hidden. Whether a disabled entry may be
// used is the resolver's decision (Resolve declines one), and an admin listing
// must be able to see it. Filtering here would make the two callers disagree
// about whether the row exists.
func (s *PrebuiltStore) Lookup(ctx context.Context, nameOrType string) (PrebuiltServer, error) {
	if s == nil || s.pool == nil {
		return PrebuiltServer{}, ErrNoPool
	}
	key := NormalizeCatalogueKey(nameOrType)
	if key == "" {
		return PrebuiltServer{}, ErrPrebuiltNotFound
	}
	row := s.pool.QueryRow(ctx,
		`SELECT `+prebuiltColumns+`
		   FROM elitea_mcp.prebuilt_servers
		  WHERE catalogue_key = $1`, key)
	entry, err := scanPrebuilt(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return PrebuiltServer{}, ErrPrebuiltNotFound
	}
	if err != nil {
		return PrebuiltServer{}, err
	}
	return entry, nil
}

// Upsert writes one catalogue entry, keyed by its normalised key.
//
// A write REPLACES the entry. That is pylon's semantics — its catalogue is a
// dictionary rebuilt from the descriptor on every reload — and it is what makes
// the admin page's save mean "this is the definition now" rather than "merge
// this into whatever was there".
//
// ClientSecretRef is written as given. Sealing the plaintext secret into the
// vault and producing the reference belongs to the admin write path, which owns
// the vault; this store must not acquire a second way to touch secrets.
func (s *PrebuiltStore) Upsert(ctx context.Context, entry PrebuiltServer) (PrebuiltServer, error) {
	if s == nil || s.pool == nil {
		return PrebuiltServer{}, ErrNoPool
	}

	display := strings.TrimSpace(entry.DisplayName)
	if display == "" {
		return PrebuiltServer{}, fmt.Errorf("mcpregistry: catalogue entry has no display name")
	}
	// The key is derived from the display name when the caller did not supply
	// one, which is what pylon does: its dictionary key IS the YAML key.
	key := NormalizeCatalogueKey(entry.Key)
	if key == "" {
		key = NormalizeCatalogueKey(display)
	}
	if key == "" {
		return PrebuiltServer{}, fmt.Errorf("mcpregistry: catalogue entry has no key")
	}
	if entry.TimeoutSeconds < 0 {
		return PrebuiltServer{}, fmt.Errorf("mcpregistry: timeout is negative")
	}

	headers := entry.Headers
	if headers == nil {
		headers = map[string]string{}
	}
	encodedHeaders, err := json.Marshal(headers)
	if err != nil {
		return PrebuiltServer{}, fmt.Errorf("mcpregistry: encode headers: %w", err)
	}

	row := s.pool.QueryRow(ctx,
		`INSERT INTO elitea_mcp.prebuilt_servers
		     (catalogue_key, display_name, server_url, base_url, client_id,
		      client_secret_ref, timeout_seconds, headers, enabled)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (catalogue_key) DO UPDATE SET
		     display_name      = EXCLUDED.display_name,
		     server_url        = EXCLUDED.server_url,
		     base_url          = EXCLUDED.base_url,
		     client_id         = EXCLUDED.client_id,
		     client_secret_ref = EXCLUDED.client_secret_ref,
		     timeout_seconds   = EXCLUDED.timeout_seconds,
		     headers           = EXCLUDED.headers,
		     enabled           = EXCLUDED.enabled,
		     updated_at        = now()
		 RETURNING `+prebuiltColumns,
		key, display, strings.TrimSpace(entry.ServerURL), strings.TrimSpace(entry.BaseURL),
		strings.TrimSpace(entry.ClientID), strings.TrimSpace(entry.ClientSecretRef),
		entry.TimeoutSeconds, encodedHeaders, entry.Enabled)

	return scanPrebuilt(row)
}

// Delete removes one catalogue entry and reports the secret reference it held.
//
// The reference is RETURNED rather than acted on, because deleting the vault
// entry is the admin path's business and it may not always be right: two
// catalogue entries could name the same platform credential. Returning it lets
// the caller decide, and makes the orphan visible either way.
func (s *PrebuiltStore) Delete(ctx context.Context, nameOrType string) (string, error) {
	if s == nil || s.pool == nil {
		return "", ErrNoPool
	}
	key := NormalizeCatalogueKey(nameOrType)
	if key == "" {
		return "", ErrPrebuiltNotFound
	}
	var reference string
	err := s.pool.QueryRow(ctx,
		`DELETE FROM elitea_mcp.prebuilt_servers
		  WHERE catalogue_key = $1
		 RETURNING client_secret_ref`, key).Scan(&reference)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrPrebuiltNotFound
	}
	if err != nil {
		return "", err
	}
	return reference, nil
}

// scanRow is the shared shape of pgx.Row and pgx.Rows for a single record.
type scanRow interface {
	Scan(dest ...any) error
}

func scanPrebuilt(row scanRow) (PrebuiltServer, error) {
	var (
		entry          PrebuiltServer
		encodedHeaders []byte
	)
	if err := row.Scan(
		&entry.Key, &entry.DisplayName, &entry.ServerURL, &entry.BaseURL, &entry.ClientID,
		&entry.ClientSecretRef, &entry.TimeoutSeconds, &encodedHeaders, &entry.Enabled,
	); err != nil {
		return PrebuiltServer{}, err
	}
	// A header object that will not decode is reported rather than dropped. An
	// entry whose headers silently vanish authenticates nothing and fails at the
	// remote server with a message that names neither this row nor this service.
	if len(encodedHeaders) > 0 {
		if err := json.Unmarshal(encodedHeaders, &entry.Headers); err != nil {
			return PrebuiltServer{}, fmt.Errorf(
				"mcpregistry: catalogue entry %q has undecodable headers: %w", entry.Key, err)
		}
	}
	return entry, nil
}
