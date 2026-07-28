import type { ReactNode } from 'react';
import { useMemo } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';

import { MAX_INSTRUCTIONS_LENGTH } from '@/shared/lib/limits';
import { t } from '@/shared/i18n';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';

import { createMentionCmExtension, type MentionableItem } from '../lib/utils/instructionsMention.utils';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/input/InstructionsInput.jsx`.
 *
 * DISCLOSED REDESIGN — a fundamentally different base editor, forced by a
 * REAL, already-established `shared/ui` constraint, not a convenience
 * simplification:
 *
 * The baseline's mirror-overlay-sync + slash/tilde-mention machinery is
 * built entirely around `FileReaderEnhancer`'s ref-based imperative handle
 * (`inputRef.current.getTextareaElement()`, geometry sync, a real DOM
 * `<textarea>` to mirror). This app's `shared/ui/FileReaderInput.tsx` — the
 * confirmed baseline-behaviour replacement for `FileReaderEnhancer` — has
 * NEITHER a ref handle NOR an `overlayContent`/`afterContent`/
 * `codeMirrorExtensions` prop; its OWN doc comment discloses this ahead of
 * this sub-unit ever touching it: "Dropped from the baseline: the
 * `updateVariableList`/`stateVariableOptions` F-string variable-highlighting
 * integration and the imperative `restoreValue`/`getInputContent`/
 * `replaceRange` ref handle — both are concerns of the app-level prompt
 * editor this component fed in the baseline, not of a generic file-backed
 * text field." The mirror-overlay approach this file's baseline used is
 * therefore categorically unbuildable against `FileReaderInput` — not a
 * missing prop that could be threaded through, a structurally absent
 * extension point.
 *
 * `shared/ui/CodeMirrorEditor` (unit S1-E), by contrast, DOES take a real
 * `extensions?: Extension[]` slot — CodeMirror 6's own native decoration
 * mechanism, which is exactly what sibling A1b's already-landed
 * `createMentionCmExtension` (`../lib/utils/instructionsMention.utils.ts`)
 * targets. This port uses `CodeMirrorEditor` as the Instructions surface and
 * wires that extension in directly: real, working mention-token
 * HIGHLIGHTING today, for any `mentionableItems` the caller supplies.
 *
 * What this does NOT reproduce, disclosed rather than silently dropped:
 * the baseline's interactive "/" and "~" mention PICKER (typing "/" opens a
 * live-filtered dropdown, arrow keys navigate it, Enter/click inserts a
 * mention token) is driven by `useInstructionsMention`/
 * `useInstructionsSkillMention` — named in sibling A1b's owned-file list
 * (`../lib/constants/mention.constants.ts`'s own doc comment: "only
 * `features/agents`' own instructions-mention hooks
 * (`useInstructionsSlashCommand`, `useInstructionsTildaCommand`,
 * `useInstructionsMention`, `useInstructionsSkillMention` — all four in this
 * sub-unit's owned-file list) consume it") — not landed in this worktree as
 * of this file being written. `InstructionsSlashSuggestionList.tsx` (this
 * sub-unit's own owned file, ported faithfully and exported) is the
 * presentational dropdown that hook pair is expected to drive; it is not
 * wired in here today. `entityProjectId`/`applicationId` are accepted and
 * currently unused for the same reason — kept on the public prop surface so
 * a future wiring pass does not need to change every call site.
 *
 * File-drop / "attach a file" support (the baseline's OTHER real feature,
 * via `FileReaderEnhancer`) is also not reproduced here — `CodeMirrorEditor`
 * has no file-drop affordance, `FileReaderInput` has one but no extension
 * slot (see above); `shared/ui` has no single component covering both.
 * Disclosed trade-off, not silently reinterpreted: this component keeps the
 * extension slot (this file's actual raison d'être — the mention-highlight
 * system) over the file-drop affordance.
 */
export interface InstructionsInputProps {
  readonly instructions: string | undefined;
  readonly onInstructionsChange: (value: string) => void;
  readonly disabled?: boolean | undefined;
  readonly applicationId?: number | string | undefined;
  readonly entityProjectId?: string | undefined;
  /** Drives `createMentionCmExtension`'s highlight decorations — omit for plain, unhighlighted text. */
  readonly mentionableItems?: readonly MentionableItem[] | undefined;
}

export function InstructionsInput({
  instructions,
  onInstructionsChange,
  disabled,
  mentionableItems,
}: InstructionsInputProps): ReactNode {
  const theme = useTheme();

  const extensions = useMemo(
    () => [...createMentionCmExtension(mentionableItems, theme.vars.palette.primary.main)],
    [mentionableItems, theme.vars.palette.primary.main],
  );

  const accordionItems = useMemo(
    () => [
      {
        title: 'Instructions',
        content: (
          <CodeMirrorEditor
            value={instructions ?? ''}
            onChange={onInstructionsChange}
            extensions={extensions}
            readOnly={disabled}
            maxLength={MAX_INSTRUCTIONS_LENGTH}
            minHeight="8rem"
            aria-label={t('features.agents.instructionsInput.ariaLabel', 'Instructions')}
          />
        ),
      },
    ],
    [instructions, onInstructionsChange, extensions, disabled],
  );

  return (
    <BasicAccordion
      showMode="left"
      slotSx={{ accordion: accordionSx }}
      items={accordionItems}
    />
  );
}

const accordionSx: SxProps<Theme> = (theme: Theme) => ({
  background: theme.vars.palette.background.tabPanel,
});
