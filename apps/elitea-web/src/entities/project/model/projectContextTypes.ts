/**
 * Project context types — the project's system-prompt-style context blob
 * (the "Project Context" / "Project Background" field in Settings > Project Params).
 *
 * Separate from `entities/project/model/types.ts` because this domain has its
 * own write shape (`ProjectContextUpdateRequest`) and the generated client
 * already covers the CRUD endpoints in `shared/api/generated/applications`.
 */

/** Project context content + enabled state — mirrors OpenAPI `ProjectContext` / `ProjectContextUpdateRequest`. */
export interface ProjectContextEntry {
  content: string | null;
  enabled: boolean | null;
}

/** Response shape for project info (name, icon_meta, teammates_count). */
export interface ProjectInfoEntry {
  name?: string;
  icon_meta?: { name: string; url: string } | null;
  teammates_count?: number;
}

/** Uploaded icon entry returned by the project_icon listing endpoint. */
export interface UploadedIcon {
  name: string;
  url: string;
}
