import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Extension } from '@codemirror/state';

import { AnimatedLoadingText } from '@/shared/ui/AnimatedLoadingText';
import { t } from '@/shared/i18n';

import { AIAssistantCodeMirrorInput } from './AIAssistantCodeMirrorInput';
import type { FStringAutocompleteOption } from '../lib/fStringAutocomplete';
import { singleViewContainerSx, singleViewLoadingContainerSx } from './aiAssistantModal.styles';

/**
 * `AIAssistantModal`'s single (non-split) view: one editable CodeMirror
 * input plus the "Thinking..." indicator while generating into an empty
 * value. Extracted purely so `AIAssistantModal.tsx`'s own cyclomatic
 * complexity (§3.5 budget: 12) stops counting this JSX's 2 conditional
 * renders — same technique `./AIAssistantModalSplitView.tsx` already
 * applies to the split view. No behaviour change (baseline
 * `AIAssistantModal.jsx` lines 423-441).
 */
export interface AIAssistantModalSingleViewProps {
  readonly readOnly: boolean;
  readonly value: string;
  readonly extensions: Extension[];
  readonly notifyChange: (value: string) => void;
  readonly onBlur: (value: string) => void;
  readonly enableFStringAutocomplete: boolean;
  readonly stateVariableOptions: readonly FStringAutocompleteOption[];
  readonly isGenerating: boolean;
}

export function AIAssistantModalSingleView(props: AIAssistantModalSingleViewProps): ReactNode {
  const { readOnly, value, extensions, notifyChange, onBlur, enableFStringAutocomplete, stateVariableOptions, isGenerating } = props;
  const thinkingLabel = t('pipelines.aiAssistant.thinking', 'Thinking...');

  return (
    <Box sx={singleViewContainerSx}>
      <AIAssistantCodeMirrorInput
        readOnly={readOnly}
        value={value}
        extensions={extensions}
        notifyChange={notifyChange}
        onBlur={onBlur}
        enableFStringAutocomplete={enableFStringAutocomplete}
        stateVariableOptions={stateVariableOptions}
      />
      {isGenerating && !value && (
        <Box sx={singleViewLoadingContainerSx}>
          <AnimatedLoadingText text={thinkingLabel} />
        </Box>
      )}
    </Box>
  );
}
