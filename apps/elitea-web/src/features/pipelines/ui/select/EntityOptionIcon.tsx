import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { ApplicationsIcon } from '@/shared/ui/icons/applications-icon';
import { FlowIcon } from '@/shared/ui/icons/flow-icon';
import { ToolIcon } from '@/shared/ui/icons/tool-icon';

import type { PipelineToolEntry } from './pipelineToolEntry.types';

export type PipelineEntityIconType = 'agent' | 'pipeline' | 'toolkit';

/**
 * Small option-row icon for `ToolSelect.jsx`/`LoopToolSelect.jsx`
 * (baseline: `EntityIcon` from `@/components/EntityIcon.jsx`, driven there
 * by `useGetToolkitIconMeta()` from `hooks/application/useLibraryToolkits.js`
 * -- a per-toolkit-TYPE brand icon resolver requiring the full toolkit-type
 * schema catalogue plus ~30 brand SVGs, `common/toolkitUtils.jsx`'s
 * `getToolIconByType`).
 *
 * **DISCLOSED SIMPLIFICATION, matching an established precedent** --
 * `features/agents/ui/generate-agent-modal/SuggestionItem.tsx`'s own doc
 * comment: "a per-toolkit-brand icon lookup (`common/toolkitUtils.jsx`'s
 * `getToolIconByType`, ~30 brand SVGs) is out of scope for this leaf row --
 * `toolkit` items fall back to the generic [icon], same 'drop the
 * decorative fanciness, keep the function' call." The same call applies
 * here: only the three entity-type fallback glyphs (`ApplicationsIcon`/
 * `FlowIcon`/`ToolIcon`) this app has ported are rendered; a toolkit's
 * per-brand icon (GitHub/Jira/Confluence/...) is not reproduced.
 *
 * `entityType` resolution mirrors the baseline's own inline ternary
 * (`ToolSelect.jsx:52-57`, `LoopToolSelect.jsx:59-64`):
 * `tool.type === 'application' ? (tool.agent_type === 'pipeline' ? 'pipeline' : 'agent') : 'toolkit'`
 * -- baseline literal was `'application'` for the non-pipeline case (the
 * `EntityIcon.jsx` switch's `ChatParticipantType.Applications` branch,
 * which renders the same `ApplicationsIcon` as its `'agent'` branch), so
 * `'agent'` here is behaviourally identical, not a deviation.
 */
export function resolvePipelineToolEntityType(tool: PipelineToolEntry): PipelineEntityIconType {
  if (tool.type === 'application') {
    return tool.agent_type === 'pipeline' ? 'pipeline' : 'agent';
  }
  return 'toolkit';
}

const iconSx: SxProps<Theme> = { width: '1rem', height: '1rem' };

export function EntityOptionIcon({ entityType }: { readonly entityType: PipelineEntityIconType }): ReactNode {
  if (entityType === 'agent') {
    return (
      <Box
        component={ApplicationsIcon}
        sx={iconSx}
      />
    );
  }
  if (entityType === 'pipeline') {
    return (
      <Box
        component={FlowIcon}
        sx={iconSx}
      />
    );
  }
  return (
    <Box
      component={ToolIcon}
      sx={iconSx}
    />
  );
}
