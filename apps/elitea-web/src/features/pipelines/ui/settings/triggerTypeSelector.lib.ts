import { useCallback, useEffect, useRef } from 'react';

import { load } from 'js-yaml';

import { EliteaApiError } from '@/shared/api/generated/mutator';
import { t } from '@/shared/i18n';
import { buildErrorMessage } from '@/shared/lib/http-error';
import type { SingleSelectOption } from '@/shared/ui/SingleSelect';

import type { UsePipelineTriggerResult } from '../../api/usePipelineTrigger';
import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { pipelineErrorMessage } from '../../lib/hooks/pipelineErrorMessage';

/**
 * Split out of `TriggerTypeSelector.tsx` -- constants, pure functions, and
 * the two data-mutating custom hooks it composes -- purely to keep that
 * file under the §3.5 400-line budget (the component itself, with these
 * inlined, was 419 lines). See `TriggerTypeSelector.tsx`'s own doc comment
 * for the full baseline provenance and DEVIATIONS FROM BASELINE list; not
 * repeated here.
 */

/** Node types requiring user interaction and thus only supporting the Chat Message trigger (baseline: `INTERACTIVE_NODE_TYPES`). */
const INTERACTIVE_NODE_TYPES: readonly string[] = [
  FlowEditorConstants.PipelineNodeTypes.Hitl,
  FlowEditorConstants.PipelineNodeTypes.Printer,
];

export const TRIGGER_TYPES = {
  chat_message: 'chat_message',
  schedule: 'schedule',
  webhook: 'webhook',
} as const;

/** Not exported: no caller outside this module names it directly yet (R-D1, `knip --max-issues 0`) -- `WEBHOOK_TYPES.github` is only ever read as `parseTriggerSchedule`'s own default. */
const WEBHOOK_TYPES = {
  github: 'github',
  gitlab: 'gitlab',
  custom: 'custom',
} as const;

export const TRIGGER_OPTIONS: SingleSelectOption[] = [
  { label: 'Chat Message', value: TRIGGER_TYPES.chat_message },
  { label: 'Schedule', value: TRIGGER_TYPES.schedule },
  { label: 'Webhook', value: TRIGGER_TYPES.webhook },
];

interface ParsedPipelineYaml {
  readonly nodes?: readonly { readonly type?: string }[];
  readonly interrupt_before?: readonly unknown[];
  readonly interrupt_after?: readonly unknown[];
}

/** `TriggerTypeSelector.jsx:60-79`'s `hasInteractiveElements` computation. */
export function computeHasInteractiveElements(versionInstructions: string | undefined): boolean {
  if (!versionInstructions) return false;
  let parsed: ParsedPipelineYaml | undefined;
  try {
    parsed = load(versionInstructions) as ParsedPipelineYaml | undefined;
  } catch {
    return false;
  }
  if (!parsed) return false;

  const hasInteractiveNodes = (parsed.nodes ?? []).some(node => node.type !== undefined && INTERACTIVE_NODE_TYPES.includes(node.type));
  const hasInterrupts = (parsed.interrupt_before?.length ?? 0) > 0 || (parsed.interrupt_after?.length ?? 0) > 0;
  return hasInteractiveNodes || hasInterrupts;
}

export interface TriggerSchedule {
  readonly cron: string;
  readonly webhookType: string;
  readonly webhookUrl: string;
  readonly secretValue: string | undefined;
  readonly secretHeader: string | undefined;
  readonly secretInstructions: string | undefined;
}

/** One typed read of the `unknown`-typed `PipelineTrigger.schedule` jsonb column -- see `usePipelineTrigger.ts`'s own doc comment for why the generated type is `unknown`. */
export function parseTriggerSchedule(schedule: unknown): TriggerSchedule {
  const record = (schedule ?? {}) as Readonly<Record<string, unknown>>;
  const asString = (key: string): string | undefined => (typeof record[key] === 'string' ? record[key] : undefined);
  return {
    cron: asString('cron') ?? '0 0 * * 6',
    webhookType: asString('webhook_type') ?? WEBHOOK_TYPES.github,
    webhookUrl: asString('webhook_url') ?? '',
    secretValue: asString('secret_value'),
    secretHeader: asString('secret_header'),
    secretInstructions: asString('secret_instructions'),
  };
}

export function buildTriggerTooltip(hasInteractiveElements: boolean): string {
  const base = t(
    'pipelines.triggerTypeSelector.tooltipBase',
    'Choose how this pipeline is triggered.\n• Chat Message (default) requires user input.\n• Schedule runs automatically based on a cron expression.\n• Webhook allows external systems to trigger the pipeline via HTTP POST.',
  );
  if (!hasInteractiveElements) return base;
  return `${base}\n\n${t(
    'pipelines.triggerTypeSelector.tooltipInteractiveNote',
    'Note: This pipeline contains HITL, Printer nodes, or interrupts that require user interaction. Only Chat Message trigger is available.',
  )}`;
}

/** The auto-reset-to-Chat-Message effect (baseline: `TriggerTypeSelector.jsx:112-143`). */
export function useAutoResetTriggerOnInteractive(args: {
  readonly hasInteractiveElements: boolean;
  readonly currentTriggerType: string;
  readonly projectId: string | undefined;
  readonly versionId: number | undefined;
  readonly updateTrigger: UsePipelineTriggerResult['updateTrigger'];
  readonly onNotifySuccess: ((message: string) => void) | undefined;
  readonly onNotifyError: ((message: string) => void) | undefined;
}): void {
  const { hasInteractiveElements, currentTriggerType, projectId, versionId, updateTrigger, onNotifySuccess, onNotifyError } = args;
  const prevHasInteractiveRef = useRef(hasInteractiveElements);

  useEffect(() => {
    const becameInteractive = !prevHasInteractiveRef.current && hasInteractiveElements;
    const hasIncompatibleTrigger = currentTriggerType === TRIGGER_TYPES.schedule || currentTriggerType === TRIGGER_TYPES.webhook;

    if (becameInteractive && hasIncompatibleTrigger && projectId !== undefined && versionId !== undefined) {
      updateTrigger({ type: TRIGGER_TYPES.chat_message })
        .then(() => onNotifySuccess?.(t('pipelines.triggerTypeSelector.resetToChatMessage', 'Trigger reset to Chat Message (pipeline now contains interactive elements)')))
        .catch(() => onNotifyError?.(t('pipelines.triggerTypeSelector.resetFailed', 'Failed to reset trigger')));
    }

    prevHasInteractiveRef.current = hasInteractiveElements;
    // baseline's own deps array (`TriggerTypeSelector.jsx:135-143`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInteractiveElements, currentTriggerType, projectId, versionId]);
}

/**
 * **Confirmed regression fix (this cluster, A2-settings-panels, findings 3
 * & 4):** every trigger-mutation `catch` below used to report a fixed
 * generic message with no reference to the caught error at all, discarding
 * the backend's actual error text the old app surfaced
 * (`TriggerTypeSelector.jsx`'s `toastError(error?.data?.error || '...')`).
 *
 * The real Go backend's error envelope for these operations is the flat
 * `{"error": "message"}` shape (verified directly: `TriggerTypeSelector.
 * test.tsx`'s own pre-existing MSW mock, `HttpResponse.json({error: 'boom'},
 * {status: 400})`) -- `EliteaApiError.message` alone (`mutator.ts`'s
 * `describeFailure`) does NOT carry that text, only `status`/`url`, so
 * reading just `.message` (the simpler pattern `pipelineErrorMessage`/
 * `features/agents/lib/errorMessage.ts`'s `applicationErrorMessage` use for
 * every OTHER pipelines/agents call site) would still have silently dropped
 * the real backend text here. `shared/lib/http-error.ts`'s `buildErrorMessage`
 * already does exactly this envelope's `data.error`/`data.message`/
 * `data.errors` dispatch (ported for parity with the old app's own
 * `common/utils.jsx`) -- adapting `EliteaApiError.failure` into the
 * RTK-Query-shaped input it expects is the SAME established pattern
 * `features/chat-conversation-list/lib/errorMessage.ts`'s
 * `conversationListErrorMessage` and `features/notifications/lib/
 * errorMessage.ts` already use for this exact situation. Duplicated
 * (adapted locally, not imported) rather than reused from either of those
 * two -- both are a different feature slice (`no-sideways-features`/R-L3
 * forbid reaching into another feature's internals), the same established
 * precedent their own doc comments record for each other.
 *
 * Falls through to `pipelineErrorMessage(error) || fallback` for anything
 * that isn't an `EliteaApiError` with a real `data.error`/`data.message`
 * text (a non-`http` `HttpFailure` kind, a plain `Error`, or a non-`Error`/
 * non-`string` rejection) -- honest about when the fallback is actually
 * reachable, same fix `applicationErrorMessageOrFallback`'s own doc comment
 * applies for the identical `String(error)`-is-always-truthy gap.
 */
function pipelineTriggerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof EliteaApiError && error.failure.kind === 'http') {
    const built = buildErrorMessage({ status: error.failure.status, originalStatus: error.failure.status, data: error.failure.body });
    if (typeof built === 'string' && built) return built;
  }
  return error instanceof Error || typeof error === 'string' ? pipelineErrorMessage(error) || fallback : fallback;
}

export interface TriggerActions {
  readonly handleTriggerTypeChange: (newType: string) => Promise<void>;
  readonly handleScheduleSubmit: (cronExpression: string) => Promise<void>;
  readonly handleScheduleIconClick: () => void;
  readonly handleWebhookIconClick: () => Promise<void>;
  readonly handleWebhookSubmit: (webhookType: string, newSecretValue: string | null) => Promise<void>;
}

/** Every trigger-mutating handler (baseline: `TriggerTypeSelector.jsx:154-271`). */
export function useTriggerActions(args: {
  readonly currentTriggerType: string;
  readonly currentWebhookType: string;
  readonly secretValue: string | undefined;
  readonly updateTrigger: UsePipelineTriggerResult['updateTrigger'];
  readonly setIsUpdating: (value: boolean) => void;
  readonly setIsScheduleModalOpen: (value: boolean) => void;
  readonly setIsWebhookModalOpen: (value: boolean) => void;
  readonly onNotifySuccess: ((message: string) => void) | undefined;
  readonly onNotifyError: ((message: string) => void) | undefined;
}): TriggerActions {
  const { currentTriggerType, currentWebhookType, secretValue, updateTrigger, setIsUpdating, setIsScheduleModalOpen, setIsWebhookModalOpen, onNotifySuccess, onNotifyError } = args;

  const handleTriggerTypeChange = useCallback(
    async (newType: string) => {
      if (newType === currentTriggerType) return;
      if (newType === TRIGGER_TYPES.schedule) {
        setIsScheduleModalOpen(true);
        return;
      }
      if (newType === TRIGGER_TYPES.webhook) {
        try {
          setIsUpdating(true);
          await updateTrigger({ type: TRIGGER_TYPES.webhook, schedule: { webhook_type: currentWebhookType } });
          setIsWebhookModalOpen(true);
        } catch (error) {
          onNotifyError?.(pipelineTriggerErrorMessage(error, t('pipelines.triggerTypeSelector.webhookConfigureFailed', 'Failed to configure webhook')));
        } finally {
          setIsUpdating(false);
        }
        return;
      }
      try {
        setIsUpdating(true);
        await updateTrigger({ type: newType });
        onNotifySuccess?.(t('pipelines.triggerTypeSelector.updatedToChatMessage', 'Trigger updated to Chat Message'));
      } catch (error) {
        onNotifyError?.(pipelineTriggerErrorMessage(error, t('pipelines.triggerTypeSelector.updateFailed', 'Failed to update trigger')));
      } finally {
        setIsUpdating(false);
      }
    },
    [currentTriggerType, currentWebhookType, updateTrigger, setIsUpdating, setIsScheduleModalOpen, setIsWebhookModalOpen, onNotifySuccess, onNotifyError],
  );

  const handleScheduleSubmit = useCallback(
    async (cronExpression: string) => {
      try {
        setIsUpdating(true);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await updateTrigger({ type: TRIGGER_TYPES.schedule, schedule: { cron: cronExpression, timezone } });
        onNotifySuccess?.(t('pipelines.triggerTypeSelector.scheduleConfigured', 'Schedule configured successfully'));
      } catch (error) {
        onNotifyError?.(pipelineTriggerErrorMessage(error, t('pipelines.triggerTypeSelector.scheduleConfigureFailed', 'Failed to configure schedule')));
      } finally {
        setIsUpdating(false);
      }
    },
    [updateTrigger, setIsUpdating, onNotifySuccess, onNotifyError],
  );

  const handleScheduleIconClick = useCallback(() => {
    if (currentTriggerType === TRIGGER_TYPES.schedule) setIsScheduleModalOpen(true);
  }, [currentTriggerType, setIsScheduleModalOpen]);

  const handleWebhookIconClick = useCallback(async () => {
    if (currentTriggerType !== TRIGGER_TYPES.webhook) return;
    if (!secretValue) {
      try {
        setIsUpdating(true);
        await updateTrigger({ type: TRIGGER_TYPES.webhook, schedule: { webhook_type: currentWebhookType } });
      } catch (error) {
        onNotifyError?.(pipelineTriggerErrorMessage(error, t('pipelines.triggerTypeSelector.loadWebhookFailed', 'Failed to load webhook settings')));
        return;
      } finally {
        setIsUpdating(false);
      }
    }
    setIsWebhookModalOpen(true);
  }, [currentTriggerType, currentWebhookType, secretValue, updateTrigger, setIsUpdating, setIsWebhookModalOpen, onNotifyError]);

  const handleWebhookSubmit = useCallback(
    async (webhookType: string, newSecretValue: string | null) => {
      try {
        setIsUpdating(true);
        const schedule: Record<string, unknown> = { webhook_type: webhookType };
        if (newSecretValue) schedule['webhook_secret_value'] = newSecretValue;
        await updateTrigger({ type: TRIGGER_TYPES.webhook, schedule });
        onNotifySuccess?.(
          newSecretValue
            ? t('pipelines.triggerTypeSelector.webhookConfiguredNewSecret', 'Webhook configured with new secret')
            : t('pipelines.triggerTypeSelector.webhookConfigured', 'Webhook configured successfully'),
        );
      } catch (error) {
        onNotifyError?.(pipelineTriggerErrorMessage(error, t('pipelines.triggerTypeSelector.webhookConfigureFailed', 'Failed to configure webhook')));
      } finally {
        setIsUpdating(false);
      }
    },
    [updateTrigger, setIsUpdating, onNotifySuccess, onNotifyError],
  );

  return { handleTriggerTypeChange, handleScheduleSubmit, handleScheduleIconClick, handleWebhookIconClick, handleWebhookSubmit };
}
