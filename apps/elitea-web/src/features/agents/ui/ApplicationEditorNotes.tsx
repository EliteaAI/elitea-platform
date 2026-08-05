import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { InfoLabelWithTooltip } from '@/shared/ui/InfoLabelWithTooltip';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

const NOTES_MAX_LENGTH = 1000;

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/ApplicationEditorNotes.jsx`.
 *
 * DISCLOSED REDESIGN — no ambient form context (see `../model/types.ts`'s
 * module doc comment): `notes` is a prop, `onNotesChange` replaces
 * `formik.setFieldValue('version_details.notes', ...)`.
 */
export interface ApplicationEditorNotesProps {
  readonly notes: string | undefined;
  readonly onNotesChange: (value: string) => void;
  readonly disabled?: boolean | undefined;
  readonly sx?: SxProps<Theme> | undefined;
}

export function ApplicationEditorNotes({ notes, onNotesChange, disabled, sx }: ApplicationEditorNotesProps): ReactNode {
  const handleNotesChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onNotesChange(event.target.value);
    },
    [onNotesChange],
  );

  const accordionItems = useMemo(
    () => [
      {
        title: t('features.agents.applicationEditorNotes.title', 'EDITOR NOTES'),
        content: (
          <Box sx={fieldContainerSx}>
            <StyledInputEnhancer
              value={notes ?? ''}
              onChange={handleNotesChange}
              disabled={disabled}
              fullScreenTitle={t('features.agents.applicationEditorNotes.fullScreenTitle', 'Editor Notes')}
              label={
                <InfoLabelWithTooltip
                  label={t('features.agents.applicationEditorNotes.label', 'Notes')}
                  tooltip={t(
                    'features.agents.applicationEditorNotes.tooltip',
                    'Free-text notes for documentation only. Not sent to the LLM, chat, or execution; not used in monitoring.',
                  )}
                  variant="bodyMedium"
                />
              }
              expand={{ minRows: 3, maxRows: 10 }}
              slotProps={{ htmlInput: { maxLength: NOTES_MAX_LENGTH } }}
            />
          </Box>
        ),
      },
    ],
    [notes, handleNotesChange, disabled],
  );

  return (
    <BasicAccordion
      showMode="left"
      slotSx={{ accordion: accordionSx, ...(sx !== undefined ? { root: sx } : {}) }}
      items={accordionItems}
    />
  );
}

const accordionSx: SxProps<Theme> = (theme: Theme) => ({
  background: theme.vars.palette.background.tabPanel,
});

const fieldContainerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  marginTop: '0.5rem',
};
