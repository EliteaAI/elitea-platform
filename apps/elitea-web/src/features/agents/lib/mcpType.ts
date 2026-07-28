/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpAuth.helpers.js:38`
 * (`isPrebuildMcpType`), used by `ToolCard.jsx:67` to distinguish a
 * pre-built MCP toolkit (`mcp_github`, `mcp_context7`, ...) from a plain
 * remote MCP (`type === 'mcp'`) when deciding whether a tool counts as MCP
 * at all (`ToolCard.jsx:68`: `tool.meta?.mcp || tool.type === 'mcp' ||
 * isPrebuildMcp`).
 *
 * This exact function already has a real port at
 * `features/mcps/lib/storage.ts` (`isPrebuildMcpType`, using the same
 * `MCP_PREBUILD_PREFIX = 'mcp_'` constant, `features/mcps/lib/constants.ts`)
 * — `no-sideways-features` forbids importing it from here (`features/agents`
 * may not import `features/mcps`, absolute, no carve-out). Duplicated
 * locally instead: it is a pure, one-line classifier with a stable prefix
 * constant, the same class of small cross-boundary duplication this
 * codebase already accepts elsewhere (`entities/application-form`'s
 * `LATEST_VERSION_NAME`, this sub-unit's own `mapAssociationError.ts`).
 */

const MCP_PREBUILD_PREFIX = 'mcp_';

/** Pre-built MCP toolkit types (`mcp_github`, `mcp_context7`, ...) — `'mcp'` alone is a remote MCP, not pre-built. */
export function isPrebuildMcpType(toolkitType: string | undefined): boolean {
  return typeof toolkitType === 'string' && toolkitType.startsWith(MCP_PREBUILD_PREFIX) && toolkitType !== 'mcp';
}
