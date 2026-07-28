import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { ApplicationCreatedResponse } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseModal } from '@/shared/ui/BaseModal';

import { useGenerateAgentDraftMutation } from '../../api/generateAgentDraft';
import { applicationErrorMessage } from '../../lib/errorMessage';
import { EMPTY_AGENT_DRAFT, mapPredictResponseToAgentDraft, type AgentDraft } from '../../lib/agentDraft';
import { GenerateAgentReviewForm } from './GenerateAgentReviewForm';
import { useAgentDraftApproval } from './useAgentDraftApproval';
import { useToggleSet } from './useToggleSet';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/generate-agent-modal/GenerateAgentModal.jsx`,
 * merged with the entity-agnostic step machine of `apps/elitea-ui/src/[fsd]/
 * entities/generate-entity-with-ai/ui/GenerateEntityModal.jsx`.
 *
 * **DISCLOSED REDESIGN — the generic `entities/generate-entity-with-ai`
 * layer was not promoted.** The Wave-2 promotion pass promoted exactly two
 * slices (`entities/application-form`, `entities/toolkit` — see this
 * sub-unit's own mission brief). `entities/generate-entity-with-ai`
 * (`GenerateEntityButton`/`GenerateEntityModal`) was NOT one of them, and
 * this sub-unit has exactly one consumer for that generic step machine
 * (agents) — duplicating an entities-layer abstraction nobody else can
 * reach yet (features/ may not create a NEW entities/ slice; that is a
 * cross-cutting promotion decision outside this sub-unit's ownership
 * fence) would just be dead generality. Every state/step the baseline's
 * `GenerateEntityModal` implements (`input` → `loading` → `review`,
 * abort-on-close, back-to-prompt) is preserved verbatim, inlined into this
 * agent-specific component instead of a separate generic wrapper.
 *
 * **REAL, CONFIRMED BACKEND GAP — the "generate agent draft" endpoint
 * returns a generic chat completion, not a structured draft. See
 * `../../lib/agentDraft.ts`'s module doc comment for the full trace (old
 * app's `generateAgentDraftApi.js` vs. this app's `useGenerateAgentDraft`
 * routing to the exact same generic `predictHandler.Predict` used for
 * webchat, verified against `services/elitea-main/internal/api/
 * router.go:481-486` and `internal/api/v2/predict/handler.go:41-61`).**
 * `handleGenerate` below calls the REAL generated endpoint, via
 * `../../api/generateAgentDraft.ts`'s `useGenerateAgentDraftMutation` (the
 * network plumbing is genuine, not stubbed) but treats its response honestly —
 * `mapPredictResponseToAgentDraft` seeds only `instructions` from the raw
 * generated text; `suggested_*` are always empty until a real
 * structured-draft endpoint exists.
 *
 * **No-toast-system-yet convention** (`features/notifications/lib/
 * errorMessage.ts`'s own doc comment: dependency-inject the error sink,
 * `console.error`/`console.warn` fallback) applies to `onApproveError`
 * (approve-step failures) exactly as it does to `useAgentDraftApproval`'s
 * own `onAssociationWarning`.
 */

type Step = 'input' | 'loading' | 'review';

export interface GenerateAgentModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectId: string | undefined;
  readonly onAgentCreated: (result: ApplicationCreatedResponse) => void;
  /** Optional — falls back to `console.error` per the no-toast-system-yet convention (see module doc comment). */
  readonly onApproveError?: ((message: string) => void) | undefined;
  /** Forwarded to `useAgentDraftApproval` — see that hook's own doc comment. */
  readonly onAssociationWarning?: ((message: string) => void) | undefined;
}

function generateErrorMessage(error: unknown): string {
  return applicationErrorMessage(error) || t('features.agents.generateAgentModal.generateFailed', 'Failed to generate. Please try again.');
}

export function GenerateAgentModal({
  open,
  onClose,
  projectId,
  onAgentCreated,
  onApproveError,
  onAssociationWarning,
}: GenerateAgentModalProps): ReactNode {
  const { approve, isApproving } = useAgentDraftApproval({ projectId, onAssociationWarning });
  const { generateDraft, error: generateError, reset: resetGenerateError } = useGenerateAgentDraftMutation();

  const [step, setStep] = useState<Step>('input');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_AGENT_DRAFT);
  const [isDraftValid, setIsDraftValid] = useState(true);

  const toolkits = useToggleSet<number | string>();
  const mcp = useToggleSet<number | string>();
  const pipelines = useToggleSet<number | string>();
  const agents = useToggleSet<number | string>();
  const skills = useToggleSet<number | string>();

  const resetSelections = useCallback(() => {
    toolkits.reset();
    mcp.reset();
    pipelines.reset();
    agents.reset();
    skills.reset();
  }, [toolkits, mcp, pipelines, agents, skills]);

  const handleClose = useCallback(() => {
    setStep('input');
    setDescription('');
    setDraft(EMPTY_AGENT_DRAFT);
    resetGenerateError();
    resetSelections();
    onClose();
  }, [onClose, resetSelections, resetGenerateError]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || projectId === undefined) return;

    setStep('loading');
    resetGenerateError();

    const response = await generateDraft({ projectId, user_description: description });
    if (response === undefined) {
      setStep('input');
      return;
    }

    setDraft(mapPredictResponseToAgentDraft(response.content));
    resetSelections();
    setStep('review');
  }, [description, projectId, generateDraft, resetGenerateError, resetSelections]);

  const handleBack = useCallback(() => {
    setStep('input');
    setDraft(EMPTY_AGENT_DRAFT);
    resetGenerateError();
  }, [resetGenerateError]);

  const handleApprove = useCallback(async () => {
    try {
      const result = await approve(draft, { selectedAgentIds: agents.selectedIds, selectedPipelineIds: pipelines.selectedIds });
      onAgentCreated(result);
      handleClose();
    } catch (error) {
      const message = generateErrorMessage(error);
      if (onApproveError) onApproveError(message);
      else console.error(message);
    }
  }, [approve, draft, agents.selectedIds, pipelines.selectedIds, onAgentCreated, handleClose, onApproveError]);

  const content =
    step === 'loading' ? (
      <Box sx={loadingContainerSx}>
        <CircularProgress size={24} />
        <Typography
          variant="bodyMedium"
          color="text.secondary"
        >
          {t('features.agents.generateAgentModal.generating', 'Generating agent draft...')}
        </Typography>
      </Box>
    ) : step === 'review' ? (
      <GenerateAgentReviewForm
        draft={draft}
        onChange={setDraft}
        onValidationChange={setIsDraftValid}
        selection={{
          toolkits: { selectedIds: toolkits.selectedIds, onToggle: toolkits.toggle },
          mcp: { selectedIds: mcp.selectedIds, onToggle: mcp.toggle },
          pipelines: { selectedIds: pipelines.selectedIds, onToggle: pipelines.toggle },
          agents: { selectedIds: agents.selectedIds, onToggle: agents.toggle },
          skills: { selectedIds: skills.selectedIds, onToggle: skills.toggle },
        }}
      />
    ) : (
      <Box sx={inputContainerSx}>
        <TextField
          fullWidth
          multiline
          minRows={10}
          maxRows={16}
          placeholder={t(
            'features.agents.generateAgentModal.placeholder',
            "Describe your agent's goal, key tasks, and preferred tone or behavior.",
          )}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          variant="standard"
          slotProps={{ input: { disableUnderline: true } }}
        />
        {generateError !== undefined && (
          <Alert
            severity="error"
            sx={errorAlertSx}
          >
            {generateErrorMessage(generateError)}
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
          disabled={isApproving}
        >
          {t('features.agents.generateAgentModal.backToPrompt', 'Back to prompt')}
        </BaseBtn>
        <BaseBtn
          variant="contained"
          color="primary"
          onClick={() => void handleApprove()}
          disabled={isApproving || !isDraftValid}
        >
          {isApproving
            ? t('features.agents.generateAgentModal.creating', 'Creating...')
            : t('features.agents.generateAgentModal.createAgent', 'Create Agent')}
        </BaseBtn>
      </>
    ) : (
      <BaseBtn
        variant="contained"
        color="primary"
        disabled={!description.trim()}
        onClick={() => void handleGenerate()}
      >
        {t('features.agents.generateAgentModal.generate', 'Generate')}
      </BaseBtn>
    );

  return (
    <BaseModal
      open={open}
      title={t('features.agents.generateAgentModal.title', 'Build with AI')}
      onClose={handleClose}
      content={content}
      actions={{ node: actions }}
    />
  );
}

const loadingContainerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.75rem',
  padding: '2rem 0',
};
const inputContainerSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', minHeight: '16rem' };
const errorAlertSx: SxProps<Theme> = { marginTop: '0.5rem' };
