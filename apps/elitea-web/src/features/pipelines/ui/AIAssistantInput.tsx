import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { InputBase } from '@/shared/ui/InputBase';
import type { InputBaseProps } from '@/shared/ui/InputBase';
import { AiAssistantIcon } from '@/shared/ui/icons/ai-assistant-icon';
import { t } from '@/shared/i18n';

import { AIAssistantModal } from './AIAssistantModal';
import type { AIAssistantModalProps, AiAssistantFieldBinding, AiAssistantFStringAutocomplete, AiAssistantPipelineContext } from './AIAssistantModal';
import { detectContentType } from '../lib/aiAssistantLanguage';
import type { AiAssistantLlmSettings } from '../api/aiAssistantPredict';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/ai-assistant/
 * ui/AIAssistantInput.jsx` (baseline, 65 lines) — unit A2a.
 *
 * DEVIATIONS FROM BASELINE, both forced by real, verified constraints:
 *
 *  1. Explicit, grouped props instead of `{...leftProps}` spread onto both
 *     `Input.InputBase` and `AIAssistantModal`. `fieldBinding`/
 *     `fStringAutocomplete`/`pipelineContext` are the SAME grouped shapes
 *     `AIAssistantModal.tsx` declares (its own doc comment covers the §3.5
 *     12-prop-budget rationale) — passed straight through here rather than
 *     re-destructured, so this component's own prop count stays low too.
 *     `onKeyDown` is dropped — see `./AIAssistantCodeMirrorInput.tsx`'s doc
 *     comment for why the underlying editor primitive cannot fire it.
 *
 *  2. `Input.InputBase`'s `fullScreenIcon`/`showFullScreenAction` props
 *     have no equivalent on this app's ported `shared/ui/InputBase` (unit
 *     S1-F) — see this file's own trigger-button rendering below, same
 *     rationale as the previous revision of this doc comment.
 */
export interface AIAssistantInputProps {
  readonly value: string;
  readonly label?: ReactNode;
  readonly fieldName?: string;
  readonly language?: string;
  readonly disabled?: boolean;
  readonly projectId?: string | number;
  readonly modelConfig?: AiAssistantLlmSettings | null;
  readonly fieldBinding?: AiAssistantFieldBinding;
  readonly fStringAutocomplete?: AiAssistantFStringAutocomplete;
  readonly pipelineContext?: AiAssistantPipelineContext;
}

const triggerButtonSx: SxProps<Theme> = (theme) => ({
  position: 'absolute',
  top: theme.spacing(-2.5),
  right: theme.spacing(1.5),
  zIndex: 1,
});

/** Collapses the `InputBase` prop-forwarding ternaries into one call — extracted to keep the component's own cyclomatic complexity under the §3.5 budget (12), same technique `../ui/AIAssistantModal.tsx`'s `resolveAiAssistantModalOptions` uses. */
function buildInputBaseProps(
  value: string,
  label: ReactNode,
  disabled: boolean | undefined,
  fieldBinding: AiAssistantFieldBinding | undefined,
): InputBaseProps {
  return {
    value,
    ...(label !== undefined ? { label } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
    ...(fieldBinding?.name !== undefined ? { name: fieldBinding.name } : {}),
    ...(fieldBinding?.id !== undefined ? { id: fieldBinding.id } : {}),
  };
}

/** Same rationale as {@link buildInputBaseProps}, for the `AIAssistantModal` forwarding. */
function buildAiAssistantModalProps(
  required: Pick<AIAssistantModalProps, 'value' | 'title' | 'fieldName' | 'open' | 'onClose' | 'specifiedLanguage' | 'modelConfig'>,
  optional: {
    readonly disabled: boolean | undefined;
    readonly projectId: string | number | undefined;
    readonly fieldBinding: AiAssistantFieldBinding | undefined;
    readonly fStringAutocomplete: AiAssistantFStringAutocomplete | undefined;
    readonly pipelineContext: AiAssistantPipelineContext | undefined;
  },
): AIAssistantModalProps {
  return {
    ...required,
    ...(optional.disabled !== undefined ? { disabled: optional.disabled } : {}),
    ...(optional.projectId !== undefined ? { projectId: optional.projectId } : {}),
    ...(optional.fieldBinding !== undefined ? { fieldBinding: optional.fieldBinding } : {}),
    ...(optional.fStringAutocomplete !== undefined ? { fStringAutocomplete: optional.fStringAutocomplete } : {}),
    ...(optional.pipelineContext !== undefined ? { pipelineContext: optional.pipelineContext } : {}),
  };
}

export const AIAssistantInput = memo(function AIAssistantInput(props: AIAssistantInputProps): ReactNode {
  const {
    value = '',
    label,
    fieldName = '',
    language,
    disabled,
    projectId,
    modelConfig = null,
    fieldBinding,
    fStringAutocomplete,
    pipelineContext,
  } = props;

  const [showAIAssistantModal, setShowAIAssistantModal] = useState(false);

  const handleOpenAIAssistant = useCallback(() => setShowAIAssistantModal(true), []);
  const handleCloseAIAssistant = useCallback(() => setShowAIAssistantModal(false), []);

  const detectedLanguage = useMemo(() => language ?? detectContentType(value), [language, value]);

  const triggerLabel = t('pipelines.aiAssistant.input.openTrigger', 'AI Assistant');
  const inputBaseProps = buildInputBaseProps(value, label, disabled, fieldBinding);
  const modalProps = buildAiAssistantModalProps(
    { value, title: fieldName, fieldName, open: showAIAssistantModal, onClose: handleCloseAIAssistant, specifiedLanguage: detectedLanguage, modelConfig },
    { disabled, projectId, fieldBinding, fStringAutocomplete, pipelineContext },
  );

  return (
    <Box sx={{ position: 'relative' }}>
      <InputBase {...inputBaseProps} />
      <Tooltip
        title={triggerLabel}
        placement="top"
      >
        <IconButton
          onClick={handleOpenAIAssistant}
          sx={triggerButtonSx}
          aria-label={triggerLabel}
          size="small"
        >
          <SvgIcon
            component={AiAssistantIcon}
            inheritViewBox
            fontSize="small"
          />
        </IconButton>
      </Tooltip>
      {showAIAssistantModal && <AIAssistantModal {...modalProps} />}
    </Box>
  );
});
