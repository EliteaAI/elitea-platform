/**
 * Project domain type — mirrors OpenAPI schema `Project` / `ProjectContext`
 * (services/elitea-main/api/openapi/v2.yaml:1575-1589, 1622-1640, unit W2),
 * sourced from internal/api/v2/projects/handler.go:33-40, 84-99 and
 * internal/api/v2/eliteacore/handler.go:110-134.
 */
export type ProjectStatus = 'active' | 'suspended';

export interface Project {
  readonly id: number;
  readonly name: string;
  /** Absent when the Go struct's `omitempty` elides it (empty string). */
  readonly description?: string;
  readonly status: ProjectStatus;
  /** Absent when the Go struct's `omitempty` elides it. */
  readonly role?: string;
  readonly suspended: boolean;
}

/**
 * `ProjectContext` (v2.yaml:1622-1640) — the project's system-prompt-style
 * context blob. Keys are always present on the wire; `""` / `false` when no
 * configuration row exists, `null` possible when the stored jsonb lacks the
 * key (NOTE(W2), handler.go:130-133). A write always echoes the typed
 * request back, so nulls never appear after a successful update.
 */
export interface ProjectContext {
  readonly content: string | null;
  readonly enabled: boolean | null;
}
