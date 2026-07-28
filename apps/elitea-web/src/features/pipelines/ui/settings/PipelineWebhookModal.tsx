import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseModal } from '@/shared/ui/BaseModal';
import { InputBase } from '@/shared/ui/InputBase';
import { RadioButtonGroup } from '@/shared/ui/RadioButtonGroup';

const WEBHOOK_TYPE_OPTIONS = [
  { label: 'GitHub', value: 'github' },
  { label: 'GitLab', value: 'gitlab' },
  { label: 'Custom', value: 'custom' },
] as const;

const WEBHOOK_TYPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  github: 'Uses x-hub-signature-256 header with HMAC-SHA256 signature',
  gitlab: 'Uses x-gitlab-token header with secret token',
  custom: 'Uses X-Webhook-Token header with secret token',
};

/** Matches the backend's `secrets.token_urlsafe`-shaped secret (baseline: `generateSecretToken`). */
function generateSecretToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildExampleRequest(webhookType: string, webhookUrl: string, secretValue: string | undefined, secretHeader: string | undefined, showSecret: boolean): string | null {
  if (!webhookUrl) return null;
  const payload = 'Your message or data here';
  const maskedSecret = '<your_secret>';
  const displaySecret = showSecret ? (secretValue ?? maskedSecret) : maskedSecret;

  if (webhookType === 'github') {
    return `curl -X POST "${webhookUrl}" \\\n  -H "Content-Type: text/plain" \\\n  -H "X-Hub-Signature-256: sha256=<computed_hmac>" \\\n  -d '${payload}'\n\n# To compute HMAC-SHA256 signature:\n# echo -n '${payload}' | openssl dgst -sha256 -hmac "${displaySecret}"`;
  }
  if (webhookType === 'gitlab') {
    return `curl -X POST "${webhookUrl}" \\\n  -H "Content-Type: text/plain" \\\n  -H "X-Gitlab-Token: ${displaySecret}" \\\n  -d '${payload}'`;
  }
  if (webhookType === 'custom') {
    const header = secretHeader ?? 'X-Webhook-Token';
    return `curl -X POST "${webhookUrl}" \\\n  -H "Content-Type: text/plain" \\\n  -H "${header}: ${displaySecret}" \\\n  -d '${payload}'`;
  }
  return null;
}

export interface PipelineWebhookModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (webhookType: string, newSecretValue: string | null) => void;
  readonly webhookType?: string | undefined;
  readonly webhookUrl?: string | undefined;
  readonly secretValue?: string | undefined;
  readonly secretHeader?: string | undefined;
  readonly secretInstructions?: string | undefined;
  readonly isLoading?: boolean | undefined;
  /** Fires with a short confirmation message on copy/regenerate actions (baseline: `toastSuccess`). See `TriggerTypeSelector.tsx`'s doc comment for the "no global toast hook" convention this replaces. */
  readonly onNotify?: ((message: string) => void) | undefined;
}

const contentWrapperSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: '25rem' };
const sectionSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: '0.5rem' };
const descriptionSx: SxProps<Theme> = { color: 'text.secondary' };
const helperTextSx: SxProps<Theme> = { color: 'text.secondary', fontStyle: 'italic' };
const urlContainerSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: '0.5rem' };
function urlInputSx(theme: Theme) {
  return { flex: 1, '& input': { fontSize: theme.typography.bodySmall.fontSize, fontFamily: 'monospace' } };
}
const exampleHeaderSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
function codeBlockSx(theme: Theme) {
  return { backgroundColor: theme.vars.palette.background.secondary, border: `1px solid ${theme.vars.palette.border.lines}`, borderRadius: theme.vars.shape.radiusMd, padding: '0.75rem', overflow: 'auto', maxHeight: '12rem' };
}
function codeTextSx(theme: Theme) {
  return { fontFamily: 'monospace', fontSize: theme.typography.bodySmall2.fontSize, color: theme.vars.palette.text.secondary, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const, margin: 0 };
}

interface WebhookUrlSectionProps {
  readonly webhookUrl: string;
  readonly onCopy: () => void;
}

function WebhookUrlSection({ webhookUrl, onCopy }: WebhookUrlSectionProps): ReactNode {
  return (
    <Box sx={sectionSx}>
      <Typography variant="labelMedium">{t('pipelines.pipelineWebhookModal.webhookUrl', 'Webhook URL')}</Typography>
      <Box sx={urlContainerSx}>
        <InputBase
          value={webhookUrl}
          slotProps={{ htmlInput: { readOnly: true } }}
          sx={urlInputSx}
        />
        <Tooltip
          title={t('pipelines.pipelineWebhookModal.copyUrl', 'Copy URL')}
          placement="top"
        >
          <IconButton onClick={onCopy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

interface WebhookSecretSectionProps {
  readonly secretValue: string;
  readonly displaySecretValue: string | undefined;
  readonly showSecretValue: boolean;
  readonly isPendingRegenerate: boolean;
  readonly displayedSecretInstructions: string | undefined;
  readonly onToggleVisibility: () => void;
  readonly onCopy: () => void;
  readonly onRegenerate: () => void;
}

function WebhookSecretSection(props: WebhookSecretSectionProps): ReactNode {
  const { displaySecretValue, showSecretValue, isPendingRegenerate, displayedSecretInstructions, onToggleVisibility, onCopy, onRegenerate } = props;

  return (
    <Box sx={sectionSx}>
      <Typography variant="labelMedium">
        {t('pipelines.pipelineWebhookModal.secretValue', 'Secret Value')}{' '}
        {isPendingRegenerate && (
          <Typography
            component="span"
            variant="bodySmall2"
            color="warning.main"
          >
            {t('pipelines.pipelineWebhookModal.newPending', '(new - click Apply to save)')}
          </Typography>
        )}
      </Typography>
      <Box sx={urlContainerSx}>
        <InputBase
          value={showSecretValue ? (displaySecretValue ?? '') : '•'.repeat(displaySecretValue?.length ?? 32)}
          slotProps={{ htmlInput: { readOnly: true } }}
          sx={urlInputSx}
        />
        <Tooltip
          title={showSecretValue ? t('pipelines.pipelineWebhookModal.hideSecret', 'Hide secret') : t('pipelines.pipelineWebhookModal.showSecret', 'Show secret')}
          placement="top"
        >
          <IconButton onClick={onToggleVisibility}>{showSecretValue ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}</IconButton>
        </Tooltip>
        <Tooltip
          title={t('pipelines.pipelineWebhookModal.copySecret', 'Copy secret')}
          placement="top"
        >
          <IconButton onClick={onCopy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip
          title={t('pipelines.pipelineWebhookModal.regenerateSecret', 'Regenerate secret')}
          placement="top"
        >
          <IconButton onClick={onRegenerate}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {!isPendingRegenerate && displayedSecretInstructions && (
        <Typography
          variant="bodySmall"
          sx={helperTextSx}
        >
          {displayedSecretInstructions}
        </Typography>
      )}
    </Box>
  );
}

interface WebhookExampleSectionProps {
  readonly exampleRequest: string;
  readonly onCopy: () => void;
}

function WebhookExampleSection({ exampleRequest, onCopy }: WebhookExampleSectionProps): ReactNode {
  return (
    <Box sx={sectionSx}>
      <Box sx={exampleHeaderSx}>
        <Typography variant="labelMedium">{t('pipelines.pipelineWebhookModal.exampleRequest', 'Example Request')}</Typography>
        <Tooltip
          title={t('pipelines.pipelineWebhookModal.copyExample', 'Copy example')}
          placement="top"
        >
          <IconButton onClick={onCopy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={codeBlockSx}>
        <Typography
          component="pre"
          sx={codeTextSx}
        >
          {exampleRequest}
        </Typography>
      </Box>
    </Box>
  );
}

/** Every `navigator.clipboard.writeText` + `onNotify` pairing this modal needs -- split out to keep {@link PipelineWebhookModal} under the §3.5 complexity budget. */
function useWebhookClipboardActions(onNotify: ((message: string) => void) | undefined) {
  const copy = useCallback(
    (value: string | undefined, message: string) => {
      if (!value) return;
      void navigator.clipboard.writeText(value);
      onNotify?.(message);
    },
    [onNotify],
  );
  return copy;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/PipelineWebhookModal.jsx` (unit A2h). `useToast()` -> `onNotify`
 * prop, matching `TriggerTypeSelector.tsx`'s convention (this app's own).
 * `WebhookUrlSection`/`WebhookSecretSection`/`WebhookExampleSection` split
 * out purely to keep this function's own complexity under the §3.5 budget
 * (12) -- same technique `features/agents/ui/ToolCard.tsx` uses for its
 * own oversized JSX body.
 */
export function PipelineWebhookModal(props: PipelineWebhookModalProps): ReactNode {
  const { open, onClose, onSubmit, webhookType: initialWebhookType, webhookUrl, secretValue, secretHeader, secretInstructions, isLoading = false, onNotify } = props;

  const [selectedWebhookType, setSelectedWebhookType] = useState('github');
  const [showSecretValue, setShowSecretValue] = useState(false);
  const [pendingSecretValue, setPendingSecretValue] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialWebhookType) setSelectedWebhookType(initialWebhookType);
    if (open) {
      setShowSecretValue(false);
      setPendingSecretValue(null);
    }
  }, [open, initialWebhookType]);

  const copyToClipboard = useWebhookClipboardActions(onNotify);

  const handleRegenerateClick = useCallback(() => {
    setPendingSecretValue(generateSecretToken());
    onNotify?.(t('pipelines.pipelineWebhookModal.newSecretGenerated', 'New secret generated. Click Apply to save.'));
  }, [onNotify]);

  const displaySecretValue = pendingSecretValue ?? secretValue;
  const isPendingRegenerate = pendingSecretValue !== null;

  const fullWebhookUrl = useMemo(() => {
    if (!webhookUrl) return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}${webhookUrl.replace(/\/[^/]+$/, `/${selectedWebhookType}`)}`;
  }, [webhookUrl, selectedWebhookType]);

  const handleCopyUrl = useCallback(
    () => copyToClipboard(fullWebhookUrl, t('pipelines.pipelineWebhookModal.urlCopied', 'Webhook URL copied to clipboard')),
    [copyToClipboard, fullWebhookUrl],
  );
  const handleCopySecret = useCallback(
    () => copyToClipboard(displaySecretValue, t('pipelines.pipelineWebhookModal.secretCopied', 'Secret copied to clipboard')),
    [copyToClipboard, displaySecretValue],
  );

  const handleToggleSecretVisibility = useCallback(() => setShowSecretValue(prev => !prev), []);

  const displayedSecretInstructions = useMemo(() => {
    if (!secretInstructions || !displaySecretValue) return secretInstructions;
    if (showSecretValue) return secretInstructions;
    return secretInstructions.replace(secretValue ?? '', '•'.repeat(Math.min(displaySecretValue.length, 32)));
  }, [secretInstructions, secretValue, displaySecretValue, showSecretValue]);

  const exampleRequest = useMemo(
    () => buildExampleRequest(selectedWebhookType, fullWebhookUrl, displaySecretValue, secretHeader, showSecretValue),
    [selectedWebhookType, fullWebhookUrl, displaySecretValue, secretHeader, showSecretValue],
  );

  const handleCopyExample = useCallback(
    () => copyToClipboard(exampleRequest ?? undefined, t('pipelines.pipelineWebhookModal.exampleCopied', 'Example request copied to clipboard')),
    [copyToClipboard, exampleRequest],
  );

  const applyChanges = useCallback(() => {
    onSubmit(selectedWebhookType, pendingSecretValue);
    onClose();
  }, [onSubmit, selectedWebhookType, pendingSecretValue, onClose]);

  const currentDescription = WEBHOOK_TYPE_DESCRIPTIONS[selectedWebhookType];

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title={t('pipelines.pipelineWebhookModal.title', 'Webhook settings')}
      content={
        <Box sx={contentWrapperSx}>
          <Box sx={sectionSx}>
            <Typography variant="labelMedium">{t('pipelines.pipelineWebhookModal.webhookType', 'Webhook Type')}</Typography>
            <RadioButtonGroup
              aria-label={t('pipelines.pipelineWebhookModal.webhookTypeAriaLabel', 'Webhook type')}
              value={selectedWebhookType}
              items={WEBHOOK_TYPE_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
              onChange={setSelectedWebhookType}
            />
            {currentDescription && (
              <Typography
                variant="bodySmall"
                sx={descriptionSx}
              >
                {currentDescription}
              </Typography>
            )}
          </Box>

          {webhookUrl && (
            <WebhookUrlSection
              webhookUrl={fullWebhookUrl}
              onCopy={handleCopyUrl}
            />
          )}

          {secretValue && (
            <WebhookSecretSection
              secretValue={secretValue}
              displaySecretValue={displaySecretValue}
              showSecretValue={showSecretValue}
              isPendingRegenerate={isPendingRegenerate}
              displayedSecretInstructions={displayedSecretInstructions}
              onToggleVisibility={handleToggleSecretVisibility}
              onCopy={handleCopySecret}
              onRegenerate={handleRegenerateClick}
            />
          )}

          <Box sx={sectionSx}>
            <Typography variant="labelMedium">{t('pipelines.pipelineWebhookModal.payloadFormat', 'Payload Format')}</Typography>
            <Typography
              variant="bodySmall"
              sx={descriptionSx}
            >
              {t('pipelines.pipelineWebhookModal.payloadDescription', 'Send a POST request with any body content. The raw request body will be passed directly to the pipeline as user input.')}
            </Typography>
          </Box>

          {exampleRequest && (
            <WebhookExampleSection
              exampleRequest={exampleRequest}
              onCopy={handleCopyExample}
            />
          )}
        </Box>
      }
      actions={{
        confirming: isLoading,
        confirmText: t('pipelines.pipelineWebhookModal.apply', 'Apply'),
        cancelText: t('pipelines.pipelineWebhookModal.cancel', 'Cancel'),
      }}
      onConfirm={applyChanges}
    />
  );
}
