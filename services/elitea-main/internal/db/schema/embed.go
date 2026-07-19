// Package schema exposes SQLC compiler projections to integration tests.
// Runtime binaries must use the versioned elitea-migrate history instead.
package schema

import _ "embed"

// AuthCoreBaselineSQLCProjection is a compile/test projection of the populated
// current-baseline schema. It is not an application startup migration.
//
//go:embed auth_core_baseline.sql
var AuthCoreBaselineSQLCProjection string
