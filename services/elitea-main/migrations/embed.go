// Package migrations owns the immutable SQL migration corpus embedded in the
// migration binary. Application servers may inspect this corpus, but they do
// not apply it during normal startup.
package migrations

import "embed"

// Files contains the independently versioned shared, tenant and agent-state
// histories.
//
//go:embed shared/*.sql tenant/*.sql agentstate/*.sql
var Files embed.FS
