import { describe, expect, it } from 'vitest';

import { resolveIndexesTabVisibility } from './indexesTabVisibility';

/**
 * The schema shapes below are not invented: they are the real payloads
 * measured from `GET /api/v2/elitea_core/toolkits/prompt_lib/1` on the
 * standalone E2E stack on 2026-08-09 (`artifact` carries
 * `selected_tools.args_schemas.index_data`; `github` carries sixteen
 * non-indexing tools and none of the index ones). See this module's own doc
 * comment for the full measurement.
 */
const ARTIFACT_SCHEMA = {
  properties: {
    selected_tools: {
      args_schemas: {
        delete_artifact: { type: 'object' },
        index_data: { type: 'object' },
        list_artifacts: { type: 'object' },
        read_artifact: { type: 'object' },
      },
    },
  },
};

const GITHUB_SCHEMA = {
  properties: {
    selected_tools: {
      args_schemas: {
        create_issue: { type: 'object' },
        list_branches: { type: 'object' },
        search_code: { type: 'object' },
      },
    },
  },
};

describe('resolveIndexesTabVisibility', () => {
  it('hides the tab on an MCP screen even when the schema offers indexing (baseline `if (mcpId) return true`)', () => {
    const result = resolveIndexesTabVisibility({ isMCP: true, toolkitTypeSchema: ARTIFACT_SCHEMA, selectedTools: ['index_data'] });
    expect(result.hidden).toBe(true);
  });

  it('still reports the selected index tools on an MCP screen, so a caller that unhides never sees a silently empty list', () => {
    const result = resolveIndexesTabVisibility({ isMCP: true, toolkitTypeSchema: ARTIFACT_SCHEMA, selectedTools: ['index_data'] });
    expect(result.selectedIndexTools).toEqual(['index_data']);
  });

  it('shows the tab for a type whose schema offers an index tool', () => {
    const result = resolveIndexesTabVisibility({ isMCP: false, toolkitTypeSchema: ARTIFACT_SCHEMA, selectedTools: ['index_data'] });
    expect(result.hidden).toBe(false);
  });

  it('shows the tab even when nothing is selected yet — the TYPE gates the tab, the SELECTION gates the tools', () => {
    const result = resolveIndexesTabVisibility({ isMCP: false, toolkitTypeSchema: ARTIFACT_SCHEMA, selectedTools: [] });
    expect(result).toEqual({ hidden: false, selectedIndexTools: [] });
  });

  it('hides the tab for a type whose schema offers only non-indexing tools', () => {
    const result = resolveIndexesTabVisibility({ isMCP: false, toolkitTypeSchema: GITHUB_SCHEMA, selectedTools: [] });
    expect(result.hidden).toBe(true);
  });

  it('hides the tab when the type schema is unknown or has no selected_tools at all', () => {
    expect(resolveIndexesTabVisibility({ isMCP: false, toolkitTypeSchema: undefined, selectedTools: [] }).hidden).toBe(true);
    expect(resolveIndexesTabVisibility({ isMCP: false, toolkitTypeSchema: { properties: {} }, selectedTools: [] }).hidden).toBe(true);
  });

  it("reads the baseline's `items.enum` shape too, not only this backend's `args_schemas`", () => {
    const legacyShape = { properties: { selected_tools: { items: { enum: ['index_data', 'search_index'] } } } };
    expect(resolveIndexesTabVisibility({ isMCP: false, toolkitTypeSchema: legacyShape, selectedTools: [] }).hidden).toBe(false);
  });

  it('keeps only IndexesToolsEnum members out of selected_tools, and drops non-strings', () => {
    const result = resolveIndexesTabVisibility({
      isMCP: false,
      toolkitTypeSchema: ARTIFACT_SCHEMA,
      selectedTools: ['index_data', 'list_artifacts', 'remove_index', 42, null, 'search_index'],
    });
    expect(result.selectedIndexTools).toEqual(['index_data', 'remove_index', 'search_index']);
  });

  it('treats a non-array selected_tools as no selection rather than throwing', () => {
    expect(resolveIndexesTabVisibility({ isMCP: false, toolkitTypeSchema: ARTIFACT_SCHEMA, selectedTools: undefined }).selectedIndexTools).toEqual([]);
    expect(resolveIndexesTabVisibility({ isMCP: false, toolkitTypeSchema: ARTIFACT_SCHEMA, selectedTools: 'index_data' }).selectedIndexTools).toEqual([]);
  });
});
