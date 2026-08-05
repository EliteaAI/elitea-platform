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

/**
 * Wire shape (snake_case) of one `Skill` component, as returned by the Go
 * handler and typed by `src/shared/api/generated/model/skill.zod.ts`
 * (`zod.input<typeof Skill>` — the same type the generated `useListSkills` /
 * `useCreateSkill` react-query hooks resolve their `data` to). Verified
 * against internal/api/v2/skills/handler.go:15-25 (json tags) and
 * internal/infra/db/repos/skills.go:22-71,73-92,95-113 (the wired Pg
 * repository's List/Get/Create/Update methods, which independently confirm
 * the degenerate-field note on `Skill` above: `Config`/`IsDefault` are never
 * scanned or set — so `config` is absent on the wire and `is_default` is
 * always `false` — `Type` is hardcoded to the literal `"skill"`, and
 * `UpdatedAt` is never set, marshalling as the Go zero-value sentinel
 * `"0001-01-01T00:00:00Z"`).
 *
 * The OpenAPI document (services/elitea-main/api/openapi/v2.yaml:1864,1901)
 * DOES define named `Skill`/`SkillsList` component schemas, matching this
 * wire shape and the same degenerate-field note field-for-field — the
 * `v2.yaml:1856-1908` citation on this slice's `Skill`/`SkillsPage` domain
 * types above is correct. The wire shape below is cross-checked against that
 * schema as well as the Go handler/repository and the generated zod file,
 * all three of which agree with each other.
 */
export interface SkillWire {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  /** Absent when the Go struct's `omitempty` elides it. */
  readonly description?: string;
  readonly type: string;
  /** Never present today — see the degenerate-field note above. */
  readonly config?: Readonly<Record<string, unknown>>;
  readonly is_default: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Wire shape of the `SkillsList` envelope
 * (`src/shared/api/generated/model/skillsList.zod.ts`), returned whole by
 * `Handler.List` (internal/api/v2/skills/handler.go:61-78) using pagination
 * fields computed in internal/infra/db/repos/skills.go:22-71.
 */
export interface SkillsPageWire {
  readonly items: readonly SkillWire[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly total_pages: number;
}
