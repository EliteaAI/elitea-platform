import type { ReactNode } from 'react';
import { useCallback } from 'react';

import { useDisassociateToolkit } from '../lib/hooks/useDisassociateToolkit.hooks';
import type { ToolRemovalUpdate } from '../lib/hooks/useDisassociateToolkit.hooks';
import { useSaveAgentToolVariables } from '../lib/hooks/useSaveAgentToolVariables';
import type { AgentToolAssociation } from '../lib/types';

import { ToolCard } from './ToolCard';

/**
 * ONE attached tool, as a component rather than a `renderToolCard` inline
 * closure — `useDisassociateToolkit` takes the row's `index` and is one hook
 * call per row, and React hooks cannot be called from a `.map()` in the
 * parent. This is the whole reason `ApplicationTools` takes an injected
 * `renderToolCard` render-prop instead of rendering `ToolCard` itself (see
 * that file's own module doc comment): the caller owns the per-row state,
 * so the caller owns the per-row component too.
 *
 * `AgentToolsPanel` (sibling) is the only caller; this file exists
 * separately purely so both stay inside the §3.5 file-length/complexity
 * budgets.
 *
 * **`ToolCard` prop groups this row deliberately does NOT fill, each a real
 * gap rather than an oversight:**
 *  - `versionSelector` (sub-agent/pipeline version dropdown) — omitted, and
 *    `ToolCardBody` gates the whole selector on it being present, so nothing
 *    renders rather than an empty dropdown. Switching an attached sub-agent's
 *    version is `useApplicationChatSwitchVersion`/`useSaveChangedTools`
 *    territory and needs a version LIST per attached sub-agent, which no
 *    endpoint on this page's fetch returns.
 *  - `validation` — this app's generated validate-version endpoint returns a
 *    plain `{valid}` with none of the per-toolkit detail the banner needs
 *    (already disclosed in `ToolCard.types.ts`).
 *  - `delegatedAuth` — `features/mcps`/`features/sharepoint`/`features/openapi`
 *    slots; `no-sideways-features` forbids reaching them from here, and a
 *    page-level composition would have to inject them.
 *
 * **`variables.onChangeVariable`/`toolSelection.onSelectedToolsChange` write
 * to the caller's in-memory `tools[]` only — they do NOT persist.** The Go
 * `UpdateVersion` handler (`applications/handler.go`) reads `name`/
 * `instructions`/`welcome_message`/`agent_type`/`llm_settings`/
 * `conversation_starters`/`meta`/`pipeline_settings` and has NO `tools`
 * branch, and the relation PATCH that does own the mapping row ignores
 * `selected_tools` on insert. Attach and detach (this row's Remove button and
 * the panel's `ToolMenu`) are the two tool operations that genuinely reach
 * the database; per-tool variables and per-tool selected-tools have no write
 * path on this backend at all. Both are left wired to local state rather than
 * silently dropped so the values still round-trip within a session — the
 * missing endpoint is a backend gap, tracked separately, not something this
 * composition can close.
 */
/** Structural only — a caller builds this inline against `AgentToolRowProps`; un-exported so knip does not flag an unused named export (the `ToolCardIcon` precedent in `ToolCard.types.ts`). */
interface AgentToolRowEntity {
  readonly applicationId: number | undefined;
  readonly versionId: number | undefined;
  readonly projectId: string | undefined;
  /** `version_details.meta.attachment_toolkit_id` — drives the attachment-toolkit paperclip and remove-dialog copy. */
  readonly attachmentToolkitId?: number | string | undefined;
}

/** Structural only, see `AgentToolRowEntity` above. */
interface AgentToolRowToolsState {
  readonly tools: readonly AgentToolAssociation[];
  /** The "Discard" baseline — `useDisassociateToolkit` rebases it as well as the live array on a successful removal. */
  readonly initialTools: readonly AgentToolAssociation[];
  /** Whether the host form already had unsaved edits BEFORE this removal (gates the hook's `setRefetch`). */
  readonly dirty: boolean;
  readonly onToolsChange: (tools: readonly AgentToolAssociation[]) => void;
  readonly onToolRemoved: (update: ToolRemovalUpdate) => void;
}

export interface AgentToolRowProps {
  readonly tool: AgentToolAssociation;
  readonly index: number;
  readonly isDuplicate: boolean;
  readonly disabled: boolean;
  readonly viewMode: string;
  readonly entity: AgentToolRowEntity;
  readonly toolsState: AgentToolRowToolsState;
}

export function AgentToolRow({ tool, index, isDuplicate, disabled, viewMode, entity, toolsState }: AgentToolRowProps): ReactNode {
  const { onDisassociateTool, isLoading } = useDisassociateToolkit({
    applicationId: entity.applicationId,
    versionId: entity.versionId,
    index,
    tools: toolsState.tools,
    initialTools: toolsState.initialTools,
    dirty: toolsState.dirty,
    onToolRemoved: toolsState.onToolRemoved,
    // `onDeleteAttachmentTool` (the hook's "the removed tool WAS the
    // attachment toolkit, clear `meta.attachment_toolkit_id`" signal) is
    // deliberately not passed: nothing in this composition sets that meta key
    // — the attachment toolkit is `AttachmentSwitch`'s territory and it is not
    // mounted on this page. A pass-through callback with no state behind it
    // would be dead wiring, which this codebase has been bitten by repeatedly.
  });

  const { onChangeVariable } = useSaveAgentToolVariables({
    tool,
    tools: toolsState.tools,
    onChangeTools: toolsState.onToolsChange,
  });

  const handleDisassociate = useCallback(
    ({ isAttachmentToolkit }: { readonly isAttachmentToolkit: boolean }) => {
      void onDisassociateTool({ tool, isAttachmentToolkit });
    },
    [onDisassociateTool, tool],
  );

  const onSelectedToolsChange = useCallback(
    (newSelectedTools: readonly string[]) => {
      toolsState.onToolsChange(
        toolsState.tools.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, settings: { ...entry.settings, selected_tools: newSelectedTools } } : entry,
        ),
      );
    },
    [index, toolsState],
  );

  return (
    <ToolCard
      tool={tool}
      disabled={disabled}
      isDuplicate={isDuplicate}
      context={{
        selectedProjectId: entity.projectId,
        viewMode,
        versionId: entity.versionId,
        attachmentToolkitId: entity.attachmentToolkitId,
      }}
      icon={{ url: tool.icon_meta?.url }}
      disassociate={{ onDisassociateTool: handleDisassociate, isDisassociating: isLoading }}
      variables={{ onChangeVariable }}
      toolSelection={{ onSelectedToolsChange }}
    />
  );
}
