import { useCallback, useState } from 'react';

import { useSelectedProjectId } from '../../api/useSelectedProjectId';
import { resolveToolkitId, setToolkitRelation } from '../toolRelation';
import type { AgentToolAssociation } from '../types';

/**
 * Persists ONE attached toolkit's `selected_tools` checkbox list (#248).
 *
 * Until this landed, `EnhancedCardToolActions`' toggles wrote to the panel's
 * in-memory `tools[]` mirror and nothing else: `applications`' `UpdateVersion`
 * has no `tools` branch (so the page's Save button could not carry them
 * either), and the relation PATCH that owns the mapping row ignored the
 * `selected_tools` the client already sent. The column
 * (`p_{id}.entity_tool_mapping.selected_tools`) existed the whole time — the
 * handler now writes it, upserting on `_entity_tool_unique
 * (entity_version_id, tool_id, entity_type)`.
 *
 * Same shape as the attach/detach writes this panel already performs: an
 * immediate server write on toggle, NOT form state gathered up for a Save
 * button (`AgentToolsPanel`'s module doc comment explains why `tools` is a
 * mirror of server state here). The local mirror is updated first so the
 * checkbox responds immediately, and rolled back to the list that was on
 * screen when the request started if the write fails — leaving a checkmark
 * showing a selection the server rejected is the same "the UI lies about what
 * was saved" defect class this whole change removes.
 */
export interface UseSaveSelectedToolsParams {
  readonly tool: AgentToolAssociation;
  /** Position of `tool` in `tools` — the row's identity here, matching `useDisassociateToolkit`'s own per-row `index` (an `id` match would collide across the two id spaces `tools[]` mixes). */
  readonly index: number;
  readonly applicationId: number | undefined;
  readonly versionId: number | undefined;
  readonly tools: readonly AgentToolAssociation[];
  readonly onToolsChange: (tools: readonly AgentToolAssociation[]) => void;
}

export interface UseSaveSelectedToolsResult {
  readonly onSelectedToolsChange: (newSelectedTools: readonly string[]) => void;
  readonly isSaving: boolean;
  readonly saveError: unknown;
}

function withSelectedTools(
  tools: readonly AgentToolAssociation[],
  index: number,
  selectedTools: readonly string[],
): readonly AgentToolAssociation[] {
  return tools.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, settings: { ...entry.settings, selected_tools: selectedTools } } : entry,
  );
}

export function useSaveSelectedTools({ tool, index, applicationId, versionId, tools, onToolsChange }: UseSaveSelectedToolsParams): UseSaveSelectedToolsResult {
  const projectId = useSelectedProjectId();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(undefined);

  const onSelectedToolsChange = useCallback(
    (newSelectedTools: readonly string[]) => {
      const previousTools = tools;
      onToolsChange(withSelectedTools(tools, index, newSelectedTools));

      const toolkitId = resolveToolkitId(tool);
      if (!projectId || applicationId === undefined || versionId === undefined || toolkitId === undefined) {
        // Same treatment as `useDisassociateToolkit`'s deviation 9: a request
        // that cannot be addressed is a surfaced failure with the optimistic
        // edit rolled back, never a silent no-op that looks saved.
        onToolsChange(previousTools);
        setSaveError(new Error('selected tools cannot be saved without a project, application and version'));
        return;
      }

      setIsSaving(true);
      setSaveError(undefined);
      void setToolkitRelation({ projectId, applicationId, versionId, toolkitId, hasRelation: true, selectedTools: newSelectedTools })
        .catch((error: unknown) => {
          onToolsChange(previousTools);
          setSaveError(error);
        })
        .finally(() => setIsSaving(false));
    },
    // `tool` covers the toolkit id; the 6 entries below are within the §3.5 hook-deps budget (≤8).
    [applicationId, index, onToolsChange, projectId, tool, tools, versionId],
  );

  return { onSelectedToolsChange, isSaving, saveError };
}
