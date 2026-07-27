/**
 * Skill domain type — mirrors OpenAPI schema `Skill` / `SkillsList`
 * (services/elitea-main/api/openapi/v2.yaml:1856-1908, unit W2), sourced
 * from internal/api/v2/skills/handler.go:15-25.
 *
 * NOTE(W2) degenerate-field warning, preserved here rather than silently
 * typed away: with the wired Pg repository (repos/skills.go:97-112),
 * `config` is NEVER populated in responses (INSERT persists only
 * name/description and hardcodes meta `'{}'`), `isDefault` is ALWAYS
 * `false`, `type` is ALWAYS the literal `"skill"`, and `updatedAt` is ALWAYS
 * the zero sentinel `"0001-01-01T00:00:00Z"`. The wire shape still matches
 * this type; selectors must not assume these fields carry real data yet.
 */
export interface Skill {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  /** Absent when the Go struct's `omitempty` elides it. */
  readonly description?: string;
  /** Always the literal `"skill"` today — see the degenerate-field note above. */
  readonly type: string;
  /**
   * `map[string]any` on the Go struct; never populated by the wired
   * repository today (discarded on write). Absent when `omitempty` elides
   * it.
   */
  readonly config?: Readonly<Record<string, unknown>>;
  /** Always `false` today — see the degenerate-field note above. */
  readonly isDefault: boolean;
  readonly createdAt: string;
  /** Zero sentinel `"0001-01-01T00:00:00Z"` today — see the note above. */
  readonly updatedAt: string;
}

export interface SkillsPage {
  readonly items: readonly Skill[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}
