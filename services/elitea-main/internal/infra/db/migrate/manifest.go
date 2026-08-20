package migrate

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"strconv"
)

// Scope identifies an independently ordered migration history.
type Scope string

const (
	ScopeShared     Scope = "shared"
	ScopeTenant     Scope = "tenant"
	ScopeAgentState Scope = "agentstate"
)

var migrationName = regexp.MustCompile(`^([0-9]{4})_([a-z][a-z0-9_]*)\.sql$`)

// Migration is one immutable SQL artifact and its content identity.
type Migration struct {
	Scope    Scope
	Version  int64
	Name     string
	Path     string
	SQL      []byte
	Checksum [sha256.Size]byte
}

// LoadManifest discovers, validates, and orders one migration history.
func LoadManifest(files fs.FS, scope Scope) ([]Migration, error) {
	if scope != ScopeShared && scope != ScopeTenant && scope != ScopeAgentState {
		return nil, fmt.Errorf("migrate: invalid scope %q", scope)
	}

	dir := string(scope)
	entries, err := fs.ReadDir(files, dir)
	if err != nil {
		return nil, fmt.Errorf("migrate: read %s history: %w", scope, err)
	}

	result := make([]Migration, 0, len(entries))
	seen := make(map[int64]string, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			return nil, fmt.Errorf("migrate: nested directory %q is not allowed", path.Join(dir, entry.Name()))
		}
		match := migrationName.FindStringSubmatch(entry.Name())
		if match == nil {
			return nil, fmt.Errorf("migrate: invalid migration filename %q", entry.Name())
		}
		version, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil || version <= 0 {
			return nil, fmt.Errorf("migrate: invalid migration version in %q", entry.Name())
		}
		if previous, ok := seen[version]; ok {
			return nil, fmt.Errorf("migrate: duplicate version %04d in %q and %q", version, previous, entry.Name())
		}

		migrationPath := path.Join(dir, entry.Name())
		contents, err := fs.ReadFile(files, migrationPath)
		if err != nil {
			return nil, fmt.Errorf("migrate: read %q: %w", migrationPath, err)
		}
		if len(contents) == 0 {
			return nil, fmt.Errorf("migrate: empty migration %q", migrationPath)
		}
		seen[version] = entry.Name()
		result = append(result, Migration{
			Scope:    scope,
			Version:  version,
			Name:     match[2],
			Path:     migrationPath,
			SQL:      contents,
			Checksum: sha256.Sum256(contents),
		})
	}

	sort.Slice(result, func(i, j int) bool { return result[i].Version < result[j].Version })
	return result, nil
}

// Head returns the expected version at the end of a history.
func Head(manifest []Migration) int64 {
	if len(manifest) == 0 {
		return 0
	}
	return manifest[len(manifest)-1].Version
}
