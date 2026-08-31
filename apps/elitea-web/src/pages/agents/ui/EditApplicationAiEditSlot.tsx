import type { ReactNode } from 'react';

import { EditInstructionsWithAiButton } from '@/features/agents';
import type { AgentLlmSettings } from '@/shared/api/agentLlmSettings';

/**
 * The agent editor's "Edit with AI" slot.
 *
 * A separate file only so `EditApplication.tsx` stays inside its `max-lines`
 * and cyclomatic-complexity budgets — same reason `EditApplicationActions`/
 * `EditApplicationSaveBar`/`EditApplicationToolsPanel` are their own files.
 * It owns no decision: the button gates itself on the backend capability, a
 * resolvable Service Prompt and a configured model (see
 * `features/agents`' `EditInstructionsWithAiButton`), so this page mounts it
 * unconditionally and it renders nothing where the feature cannot work.
 */
/**
 * The page's editor bridge, narrowed to the two things this slot reads and
 * the one setter it writes. Structural, not the bridge's own type: the slot
 * has no business with the rest of it.
 */
interface EditApplicationAiEditEditor {
  readonly values: {
    readonly version_details: {
      readonly instructions?: string | undefined;
      readonly llm_settings?: AgentLlmSettings | undefined;
    };
  };
  readonly onFieldChange: (path: string, value: unknown) => void;
}

export interface EditApplicationAiEditSlotProps {
  readonly editor: EditApplicationAiEditEditor;
  readonly projectId: string | undefined;
  readonly disabled: boolean;
}

export function EditApplicationAiEditSlot({ editor, projectId, disabled }: EditApplicationAiEditSlotProps): ReactNode {
  const { instructions, llm_settings } = editor.values.version_details;
  return (
    <EditInstructionsWithAiButton
      projectId={projectId}
      instructions={instructions ?? ''}
      llmSettings={llm_settings}
      // Routed through the same `onFieldChange` every other version-level
      // field uses, so an applied edit lands in the save body AND in the
      // dirty comparison the nav blocker reads (#133).
      onApply={(next) => editor.onFieldChange('version_details.instructions', next)}
      disabled={disabled}
    />
  );
}
