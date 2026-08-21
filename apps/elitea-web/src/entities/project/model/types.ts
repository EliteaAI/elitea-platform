/**
 * Project domain type — mirrors OpenAPI schema `ProjectWithGroups`
 * (services/elitea-main/api/openapi/v2.yaml, unit W2), sourced from
 * internal/api/v2/projects/handler.go:134-143 (the `Project` struct) and
 * :226-251 (`assembleProjects`), plus internal/api/v2/eliteacore/handler.go
 * for `ProjectContext`.
 *
 * The wire body has no `status`, `description` or `role` field. The spec
 * declared a required `status: 'active' | 'suspended'` that the handler never
 * emitted, so every project this app built carried `status: undefined` under a
 * type that promised the enum. `suspended` is the one flag the server sends.
 * handler_test.go:145-150 pins the eight-key golden body and fails on a
 * non-baseline key, so this shape is the contract.
 *
 * Only the fields this app reads are kept here: `owner_id`, `plugins`,
 * `keycloak_groups`, `create_success` and `groups` are on the wire and on the
 * generated `ProjectWithGroups`, and a consumer that needs one reads the
 * generated type.
 */
export interface Project {
  readonly id: number;
  readonly name: string;
  readonly suspended: boolean;
}

/**
 * `ProjectContext` (v2.yaml) — the project's system-prompt-style context blob.
 * Keys are always present on the wire; `""` / `false` when no configuration
 * row exists, `null` possible when the stored jsonb lacks the key (NOTE(W2),
 * handler.go:130-133). A write always echoes the typed request back, so nulls
 * never appear after a successful update.
 */
export interface ProjectContext {
  readonly content: string | null;
  readonly enabled: boolean | null;
}
