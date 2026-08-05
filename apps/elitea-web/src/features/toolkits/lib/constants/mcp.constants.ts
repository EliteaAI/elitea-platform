/**
 * Ported verbatim from
 * `apps/elitea-ui/src/[fsd]/features/toolkits/lib/constants/mcp.constants.js`
 * (4 lines, Wave-2 unit A4b). The two category labels a toolkit-type is
 * bucketed into on the MCP tab: a user's own discovered MCP server
 * (`Local`) vs. the pre-built "Remote MCP" toolkit type
 * (`entities/toolkit`'s `mergeMcpToolkitTypeSchemas`, `model/toolMenu.ts`,
 * labels its synthesized entry `'Remote MCP'` — this `Remote` string is the
 * plain category name used as a filter-tag/tag-list label, a distinct
 * concern from that synthesized display label).
 */
export const McpCategory = {
  Local: 'Local',
  Remote: 'Remote',
} as const;

