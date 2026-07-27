/**
 * Toolkit domain type — a configured tool integration instance. Distinct
 * from `ToolkitTypeSchemas` (the settings-JSON-Schema catalogue, OpenAPI
 * schema at services/elitea-main/api/openapi/v2.yaml:1963-1979, unit W2) —
 * that describes the settings FORM for a toolkit TYPE; `Toolkit` here is an
 * actual configured instance, for which no OpenAPI schema exists (chat/
 * agent-authoring domain, not in the W2 manifest).
 *
 * Instance-shape evidence: apps/elitea-ui/src/api/toolkits.js:43-144
 * (`toolkitsList`/`toolkitsDetails`), field destructure at
 * apps/elitea-ui/src/[fsd]/entities/toolkit-card (or ToolkitAll) `Card.jsx:
 * 46-56` (`id, name, authors, author, description, status, meta, is_forked,
 * is_pinned, type, settings, tags, online`).
 */

export interface ToolkitAuthor {
  readonly id: string;
  readonly name?: string;
  readonly avatar?: string;
}

export interface Toolkit {
  readonly id: string;
  readonly name: string;
  readonly authors?: readonly ToolkitAuthor[];
  readonly author?: ToolkitAuthor;
  readonly description?: string;
  readonly status?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly isForked?: boolean;
  readonly isPinned?: boolean;
  /** Toolkit type key, e.g. `"github"`, `"jira"`, `"mcp"`. Looked up in `ToolkitTypeSchemaMap`. */
  readonly type: string;
  /** Opaque toolkit-type-specific settings blob (e.g. `{ url, ... }` for MCP). */
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly tags?: readonly string[];
  /** Server-pushed liveness flag (`mcp_status` socket event). */
  readonly online?: boolean;
}

export interface ToolkitPage {
  readonly rows: readonly Toolkit[];
  readonly total: number;
}

/**
 * `ToolkitTypeSchemas` (v2.yaml:1963-1979) — map keyed by toolkit type name,
 * each value a JSON-Schema-shaped settings descriptor served verbatim from a
 * static Go map (internal/api/v2/toolkits/handler.go:82-233).
 */
export type ToolkitTypeSchemaMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
