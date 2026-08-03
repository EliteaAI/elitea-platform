/**
 * GenerateProjectContextButton — permission-gated button that opens the
 * GenerateProjectContextModal.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/GenerateProjectContextButton.jsx`,
 * merged with the step-machine pattern from
 * `features/agents/ui/generate-agent-modal/GenerateAgentButton.tsx`.
 */
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { AiSparkleIcon } from '@/shared/ui/icons/ai-sparkle-icon';

import { GenerateProjectContextModal } from './GenerateProjectContextModal';

export interface GenerateProjectContextButtonProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
  /** Existing context content. */
  existingContent: string;
  /** Called with the generated content on approve. */
  onApply: (content: string) => void;
}

export function GenerateProjectContextButton({
  projectId,
  existingContent,
  onApply,
}: GenerateProjectContextButtonProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  return (
    <>
      <BaseBtn
        component="span"
        variant="secondary"
        size="small"
        startIcon={<AiSparkleIcon />}
        onClick={handleOpen}
        sx={buttonSx}
      >
        {t('entities.projectContext.generateButton.label', 'Generate with AI')}
      </BaseBtn>
      <GenerateProjectContextModal
        open={isOpen}
        onClose={handleClose}
        projectId={projectId}
        existingContent={existingContent}
        onApply={onApply}
      />
    </>
  );
}

const buttonSx: SxProps<Theme> = (theme: Theme) => ({
  borderRadius: theme.vars.shape.radiusPill,
  color: theme.vars.palette.primary.main,
});
