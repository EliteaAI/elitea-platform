/**
 * ui/canvas/MermaidQuickFixButton.tsx — the canvas mermaid quick-fix control
 * (Canvas slice 2b), replacing `CanvasEditor.tsx:188-212`'s commented-out
 * `handleQuickFix` and its four toast branches.
 *
 * THE WHOLE POINT OF THIS COMPONENT: it renders `null` unless the capability
 * is actually available. Three of the baseline's four toast branches ("no
 * model", "service prompt not configured", "select a project") are not user
 * mistakes — they are a deployment with `ELITEA_CONFIGURATIONS_ENABLED`
 * false, which is the default. See `../../model/useMermaidQuickFix.ts` for
 * the exact four conditions. The remaining failures — the model answering
 * nothing usable, the 60s blocking window expiring, the network — are real
 * runtime errors and DO surface, through `onError` (this app has no toast
 * hook yet; see `processes/chat/model/useChatCopyToClipboard.ts`'s note).
 */
import { useCallback, useState } from 'react';

import { Button, CircularProgress, Tooltip } from '@mui/material';

import { AiMagicIcon } from '@/shared/ui/icons/ai-magic-icon';
import { t } from '@/shared/i18n';

import type { UseMermaidQuickFixResult } from '../../model/useMermaidQuickFix';

export interface MermaidQuickFixButtonProps {
  /** Straight from `useMermaidQuickFix`. */
  readonly quickFix: UseMermaidQuickFixResult;
  /** The renderer's error text for the current diagram; `''` until a renderer reports one. */
  readonly error?: string | undefined;
  /** The diagram source to repair. */
  readonly code: string;
  /** Receives the repaired mermaid source. */
  readonly onFixed: (code: string) => void;
  readonly onError?: ((error: unknown) => void) | undefined;
}

/** Renders the quick-fix control, or nothing at all when quick-fix cannot run here. */
export function MermaidQuickFixButton({
  quickFix,
  error = '',
  code,
  onFixed,
  onError,
}: MermaidQuickFixButtonProps): React.ReactElement | null {
  const [isRunning, setIsRunning] = useState(false);

  const onClick = useCallback(() => {
    setIsRunning(true);
    quickFix
      .run({ error, code })
      .then(onFixed)
      .catch((cause: unknown) => onError?.(cause))
      .finally(() => setIsRunning(false));
  }, [code, error, onError, onFixed, quickFix]);

  if (!quickFix.capability.isAvailable) return null;

  const label = t('features.chatMessages.canvas.mermaid.quickFix', 'Quick Fix');

  return (
    <Tooltip
      title={quickFix.capability.tooltip}
      placement="top"
    >
      <span>
        <Button
          size="small"
          onClick={onClick}
          disabled={isRunning}
          data-testid="canvas-mermaid-quick-fix"
          startIcon={isRunning ? <CircularProgress size={14} /> : <AiMagicIcon />}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );
}
