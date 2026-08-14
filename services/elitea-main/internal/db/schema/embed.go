// Package schema exposes SQLC compiler projections to integration tests.
// Runtime binaries must use the versioned elitea-migrate history instead.
package schema

import _ "embed"

// AuthCoreBaselineSQLCProjection is a compile/test projection of the populated
// current-baseline schema. It is not an application startup migration.
//
//go:embed auth_core_baseline.sql
var AuthCoreBaselineSQLCProjection string

// CentryProjectsBaselineSQLCProjection is the matching compile/test projection
// for current project lifecycle and tenancy fields.
//
//go:embed centry_projects_baseline.sql
var CentryProjectsBaselineSQLCProjection string

// ArtifactStorageBaselineSQLCProjection is the matching projection for the
// elitea_storage schema. The project statistics endpoint measures a project's
// stored bytes from it, and a test that stubbed the sum instead would not
// notice a join that counted soft-deleted buckets.
//
//go:embed artifact_storage_baseline.sql
var ArtifactStorageBaselineSQLCProjection string
