import type { ReactNode } from 'react';
import { memo } from 'react';

import Box from '@mui/material/Box';
import type { Extension } from '@codemirror/state';
import type { SxProps, Theme } from '@mui/material/styles';

import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';

import { useCodeMirrorFStringAutocomplete } from '../model/useCodeMirrorFStringAutocomplete';
import { FStringAutocompletePopper } from './FStringAutocompletePopper';
import type { FStringAutocompleteOption } from '../lib/fStringAutocomplete';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/ai-assistant/
 * ui/AIAssistantCodeMirrorInput.jsx` (baseline, 59 lines) — unit A2a.
 *
 * DISCLOSED SCOPE TRIM: the baseline forwards an `onKeyDown` prop straight
 * through to its `Field.CodeMirrorEditor`. This app's ported `shared/ui/
 * CodeMirrorEditor` (unit S1-E) declares no `onKeyDown` prop at all — its
 * own doc comment lists this as a deliberate trim ("unused by every
 * in-scope caller"), and `shared/ui` is out of this sub-unit's ownership
 * fence to extend. No verified in-scope caller of THIS component
 * (`AIAssistantModal`'s single call site, `../ui/AIAssistantInput.tsx`)
 * ever supplies a real `onKeyDown` either — grepped, the baseline's
 * `AIAssistantInput.jsx` never sets it, it only exists as a pass-through
 * prop with no concrete producer inside this sub-unit's owned files — so
 * this prop is dropped rather than kept as a dead no-op.
 *
 * See `../model/useCodeMirrorFStringAutocomplete.ts`'s own doc comment for
 * how the f-string autocomplete bridge obtains the CodeMirror `EditorView`
 * without an imperative ref API (the baseline's `editorRef` prop is
 * likewise dropped — nothing here needs it once the view is captured
 * internally).
 */
export interface AIAssistantCodeMirrorInputProps {
  readonly value: string;
  readonly extensions?: Extension | Extension[] | undefined;
  readonly notifyChange?: (value: string) => void;
  readonly readOnly?: boolean;
  readonly onBlur?: (value: string) => void;
  readonly enableFStringAutocomplete?: boolean;
  readonly stateVariableOptions?: readonly FStringAutocompleteOption[];
}

const containerSx: SxProps<Theme> = {
  height: '100%',
  position: 'relative',
};

export const AIAssistantCodeMirrorInput = memo(function AIAssistantCodeMirrorInput(
  props: AIAssistantCodeMirrorInputProps,
): ReactNode {
  const {
    value,
    extensions,
    notifyChange,
    readOnly = false,
    onBlur,
    enableFStringAutocomplete = false,
    stateVariableOptions = [],
  } = props;

  const { mergedExtensions, popperProps } = useCodeMirrorFStringAutocomplete({
    extensions,
    notifyChange,
    enableFStringAutocomplete,
    readOnly,
    stateVariableOptions,
  });

  return (
    <Box sx={containerSx}>
      <CodeMirrorEditor
        readOnly={readOnly}
        value={value}
        extensions={mergedExtensions}
        {...(notifyChange !== undefined ? { onChange: notifyChange } : {})}
        {...(onBlur !== undefined ? { onBlur } : {})}
        height="100%"
        minHeight="100%"
      />
      {enableFStringAutocomplete && <FStringAutocompletePopper {...popperProps} />}
    </Box>
  );
});
