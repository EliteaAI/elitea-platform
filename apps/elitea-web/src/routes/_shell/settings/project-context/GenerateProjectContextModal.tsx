/**
 * GenerateProjectContextModal — modal for generating a project context draft
 * with AI, reviewing it, and applying it.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/GenerateProjectContextModal.jsx`,
 * merged with the step-machine pattern from
 * `features/agents/ui/generate-agent-modal/GenerateAgentModal.tsx`.
 *
 * Uses the handwritten `useGenerateProjectContextDraftMutation` hook.
 */
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseModal } from '@/shared/ui/BaseModal';

import { useGenerateProjectContextDraftMutation } from '@/entities/project/api/projectContextApi';
import { useSelectedProjectStore } from '@/widgets/app-shell';

import {
  APPLY_MODE,
  type ApplyMode,
  GenerateProjectContextReviewForm,
} from './GenerateProjectContextReviewForm';

type Step = 'input' | 'loading' | 'review';

export interface GenerateProjectContextModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Existing context content — used to decide whether to show replace/append options. */
  readonly existingContent: string;
  /** Called with the (potentially transformed) generated content on approve. */
  readonly onApply: (content: string) => void;
}

export function GenerateProjectContextModal({
  open,
  onClose,
  existingContent,
  onApply,
}: GenerateProjectContextModalProps): ReactNode {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');
  const { mutateAsync: generateDraft, error: generateError } =
    useGenerateProjectContextDraftMutation(projectId);

  const [step, setStep] = useState<Step>('input');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<{ project_background?: string }>({ project_background: '' });
  const [isDraftValid, setIsDraftValid] = useState(true);
  const [applyMode, setApplyMode] = useState<ApplyMode>(APPLY_MODE.REPLACE);

  const hasExistingContent = Boolean(existingContent?.trim());
  const existingContentLength = existingContent?.trimEnd().length ?? 0;

  /* ── step transitions ──────────────────────────────────────────────── */

  const handleClose = useCallback(() => {
    setStep('input');
    setDescription('');
    setDraft({ project_background: '' });
    setApplyMode(APPLY_MODE.REPLACE);
    onClose();
  }, [onClose]);

  const handleBack = useCallback(() => {
    setStep('input');
    setDraft({ project_background: '' });
  }, []);

  /* ── action handlers ───────────────────────────────────────────────── */

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;

    setStep('loading');

    try {
      const response = await generateDraft({ user_description: description });
      setDraft({ project_background: response.project_background || '' });
      setStep('review');
    } catch {
      setStep('input');
    }
  }, [description, generateDraft]);

  const handleApprove = useCallback(async () => {
    const generated = draft.project_background || '';

    if (hasExistingContent && applyMode === APPLY_MODE.APPEND) {
      onApply(existingContent.trimEnd() + '\n\n' + generated);
    } else {
      onApply(generated);
    }

    handleClose();
  }, [draft, hasExistingContent, applyMode, existingContent, onApply, handleClose]);

  /* ── render ────────────────────────────────────────────────────────── */

  const content =
    step === 'loading' ? (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          padding: '2rem 0',
        }}
      >
        <CircularProgress size={24} />
        <Typography
          variant="bodyMedium"
          color="text.secondary"
        >
          {t('entities.projectContext.generateModal.generating', 'Generating project context...')}
        </Typography>
      </Box>
    ) : step === 'review' ? (
      <GenerateProjectContextReviewForm
        draft={draft}
        onChange={setDraft}
        onValidationChange={setIsDraftValid}
        hasExistingContent={hasExistingContent}
        existingContentLength={existingContentLength}
        applyMode={applyMode}
        onApplyModeChange={setApplyMode}
      />
    ) : (
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '16rem' }}>
        <TextField
          fullWidth
          multiline
          minRows={6}
          maxRows={10}
          placeholder={t(
            'entities.projectContext.generateModal.placeholder',
            'Describe your project: architecture, design decisions, workflows, terminology, constraints, coding standards, deployment process, or other important information.',
          )}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          variant="standard"
          slotProps={{ input: { disableUnderline: true } }}
        />
        {generateError !== undefined && (
          <Alert severity="error" sx={{ marginTop: '0.5rem' }}>
            {t('entities.projectContext.generateModal.generateFailed', 'Failed to generate. Please try again.')}
          </Alert>
        )}
      </Box>
    );

  const actions =
    step === 'loading' ? undefined : step === 'review' ? (
      <>
        <BaseBtn
          variant="secondary"
          onClick={handleBack}
        >
          {t('entities.projectContext.generateModal.backToPrompt', 'Back to prompt')}
        </BaseBtn>
        <BaseBtn
          variant="contained"
          color="primary"
          onClick={() => void handleApprove()}
          disabled={!isDraftValid}
        >
          {t('entities.projectContext.generateModal.apply', 'Apply')}
        </BaseBtn>
      </>
    ) : (
      <BaseBtn
        variant="contained"
        color="primary"
        disabled={!description.trim()}
        onClick={() => void handleGenerate()}
      >
        {t('entities.projectContext.generateModal.generate', 'Generate')}
      </BaseBtn>
    );

  return (
    <BaseModal
      open={open}
      title={t('entities.projectContext.generateModal.title', 'Generate project context')}
      onClose={handleClose}
      content={content}
      actions={{ node: actions }}
    />
  );
}
