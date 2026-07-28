import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { Extension } from '@codemirror/state';

import { BaseBtn, BUTTON_VARIANTS } from '@/shared/ui/BaseBtn';
import { AnimatedLoadingText } from '@/shared/ui/AnimatedLoadingText';
import { t } from '@/shared/i18n';

import { AIAssistantCodeMirrorInput } from './AIAssistantCodeMirrorInput';
import { AIAssistantPanelHeader } from './AIAssistantPanelHeader';
import type { FStringAutocompleteOption } from '../lib/fStringAutocomplete';
import {
  buttonWrapperSx,
  currentEditorWrapperSx,
  editorContainerSx,
  iconButtonSx,
  improvedEditorContainerSx,
  improvedEditorWrapperSx,
  improvedPanelContainerSx,
  panelContainerSx,
  singleViewLoadingContainerSx,
  splitViewContainerSx,
} from './aiAssistantModal.styles';

/**
 * `AIAssistantModal`'s split-view (current-vs-improved) panels, extracted
 * to its own file so `AIAssistantModal.tsx` itself stays under the §3.5
 * 400-line file-length budget — pure JSX/props extraction, no baseline
 * behaviour change (baseline `AIAssistantModal.jsx` lines 314-421).
 *
 * DEVIATION FROM BASELINE (copy toast): the baseline calls `useToast().
 * toastInfo(...)` after each copy. No toast/snackbar primitive exists yet
 * in `shared/ui` (`features/mcps/model/useMcpAuthModal.ts`'s doc comment
 * records the same finding first) — `onCopied` is an optional callback the
 * caller can use to surface its own feedback; the clipboard write itself
 * still happens here (unlike `shared/ui/CopyToClipboardButton`, this is a
 * `features/` file, so it is free to perform the write directly rather
 * than delegating it upward — R-L1 only restricts `shared/ui`).
 *
 * `CopyIcon`/`CloseIcon` (baseline: hand-rolled `@/components/Icons/*`)
 * have no ported `shared/ui/icons` equivalent — `@mui/icons-material`
 * fallback, same established precedent as `../ui/AIPromptInput.tsx`'s doc
 * comment records for `SendIcon`.
 */
export interface AIAssistantModalSplitViewProps {
  readonly isGenerating: boolean;
  readonly currentValue: string;
  readonly improvedContent: string;
  readonly extensions: Extension[];
  readonly enableFStringAutocomplete: boolean;
  readonly stateVariableOptions: readonly FStringAutocompleteOption[];
  readonly onCurrentChange: (value: string) => void;
  readonly onImprovedChange: (value: string) => void;
  readonly onApply: () => void;
  readonly onCloseSplitView: () => void;
  readonly onCopied?: (which: 'current' | 'improved') => void;
}

async function copyToClipboard(value: string, which: 'current' | 'improved', onCopied?: (which: 'current' | 'improved') => void): Promise<void> {
  await navigator.clipboard.writeText(value);
  onCopied?.(which);
}

export function AIAssistantModalSplitView(props: AIAssistantModalSplitViewProps): ReactNode {
  const {
    isGenerating,
    currentValue,
    improvedContent,
    extensions,
    enableFStringAutocomplete,
    stateVariableOptions,
    onCurrentChange,
    onImprovedChange,
    onApply,
    onCloseSplitView,
    onCopied,
  } = props;

  const copyCurrentLabel = t('pipelines.aiAssistant.splitView.copyCurrent', 'Copy current version');
  const copyImprovedLabel = t('pipelines.aiAssistant.splitView.copyImproved', 'Copy improved version');
  const closeSplitViewLabel = t('pipelines.aiAssistant.splitView.close', 'Close split view');
  const applyLabel = t('pipelines.aiAssistant.splitView.apply', 'Apply');
  const currentVersionTitle = t('pipelines.aiAssistant.splitView.currentVersion', 'Current Version');
  const improvedVersionTitle = t('pipelines.aiAssistant.splitView.improvedVersion', 'Improved Version');
  const thinkingLabel = t('pipelines.aiAssistant.thinking', 'Thinking...');

  return (
    <Box sx={splitViewContainerSx}>
      <Box sx={panelContainerSx}>
        <AIAssistantPanelHeader
          title={currentVersionTitle}
          actions={
            <Tooltip
              title={copyCurrentLabel}
              placement="top"
            >
              <IconButton
                sx={iconButtonSx}
                aria-label={copyCurrentLabel}
                onClick={() => void copyToClipboard(currentValue, 'current', onCopied)}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          }
        />
        <Box sx={editorContainerSx}>
          <Box sx={currentEditorWrapperSx}>
            <AIAssistantCodeMirrorInput
              readOnly={isGenerating}
              value={currentValue}
              extensions={extensions}
              notifyChange={onCurrentChange}
              enableFStringAutocomplete={enableFStringAutocomplete}
              stateVariableOptions={stateVariableOptions}
            />
          </Box>
        </Box>
      </Box>

      <Box sx={improvedPanelContainerSx}>
        <AIAssistantPanelHeader
          title={improvedVersionTitle}
          actions={
            <>
              <Box
                component="span"
                sx={buttonWrapperSx}
              >
                <BaseBtn
                  variant={BUTTON_VARIANTS.secondary}
                  onClick={onApply}
                  disabled={isGenerating}
                >
                  {applyLabel}
                </BaseBtn>
              </Box>
              <Tooltip
                title={copyImprovedLabel}
                placement="top"
              >
                <IconButton
                  sx={iconButtonSx}
                  aria-label={copyImprovedLabel}
                  onClick={() => void copyToClipboard(improvedContent, 'improved', onCopied)}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip
                title={closeSplitViewLabel}
                placement="top"
              >
                <IconButton
                  sx={iconButtonSx}
                  aria-label={closeSplitViewLabel}
                  onClick={onCloseSplitView}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          }
        />
        <Box sx={improvedEditorContainerSx}>
          <Box sx={improvedEditorWrapperSx}>
            <AIAssistantCodeMirrorInput
              readOnly={isGenerating}
              value={improvedContent}
              extensions={extensions}
              notifyChange={onImprovedChange}
              enableFStringAutocomplete={enableFStringAutocomplete}
              stateVariableOptions={stateVariableOptions}
            />
            {isGenerating && !improvedContent && (
              <Box sx={singleViewLoadingContainerSx}>
                <AnimatedLoadingText text={thinkingLabel} />
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
