import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  TRIGGER_TYPES,
  buildTriggerTooltip,
  computeHasInteractiveElements,
  parseTriggerSchedule,
  useAutoResetTriggerOnInteractive,
  useTriggerActions,
} from './triggerTypeSelector.lib';

describe('computeHasInteractiveElements', () => {
  it('returns false for undefined instructions', () => {
    expect(computeHasInteractiveElements(undefined)).toBe(false);
  });

  it('returns false for unparsable YAML', () => {
    expect(computeHasInteractiveElements('{{{not: valid: yaml')).toBe(false);
  });

  it('returns false when the parsed YAML is a literal null document (parses successfully, but falsy — distinct from the parse-failure catch branch)', () => {
    expect(computeHasInteractiveElements('null')).toBe(false);
  });

  it('returns false when there are no interactive nodes or interrupts', () => {
    expect(computeHasInteractiveElements('nodes:\n  - id: a\n    type: agent\n')).toBe(false);
  });

  it('returns true when a node has an interactive type (hitl)', () => {
    expect(computeHasInteractiveElements('nodes:\n  - id: a\n    type: hitl\n')).toBe(true);
  });

  it('returns true when a node has an interactive type (printer)', () => {
    expect(computeHasInteractiveElements('nodes:\n  - id: a\n    type: printer\n')).toBe(true);
  });

  it('returns true when interrupt_before is non-empty', () => {
    expect(computeHasInteractiveElements('nodes: []\ninterrupt_before:\n  - a\n')).toBe(true);
  });

  it('returns true when interrupt_after is non-empty', () => {
    expect(computeHasInteractiveElements('nodes: []\ninterrupt_after:\n  - a\n')).toBe(true);
  });
});

describe('parseTriggerSchedule', () => {
  it('returns full defaults for null/undefined schedule', () => {
    expect(parseTriggerSchedule(undefined)).toEqual({
      cron: '0 0 * * 6',
      webhookType: 'github',
      webhookUrl: '',
      secretValue: undefined,
      secretHeader: undefined,
      secretInstructions: undefined,
    });
    expect(parseTriggerSchedule(null)).toEqual({
      cron: '0 0 * * 6',
      webhookType: 'github',
      webhookUrl: '',
      secretValue: undefined,
      secretHeader: undefined,
      secretInstructions: undefined,
    });
  });

  it('reads every string field verbatim when present', () => {
    expect(
      parseTriggerSchedule({
        cron: '0 12 * * *',
        webhook_type: 'gitlab',
        webhook_url: '/hook/gitlab',
        secret_value: 'abc',
        secret_header: 'X-Secret',
        secret_instructions: 'paste here',
      }),
    ).toEqual({
      cron: '0 12 * * *',
      webhookType: 'gitlab',
      webhookUrl: '/hook/gitlab',
      secretValue: 'abc',
      secretHeader: 'X-Secret',
      secretInstructions: 'paste here',
    });
  });

  it('falls back to defaults for non-string field values', () => {
    expect(parseTriggerSchedule({ cron: 42, webhook_type: false })).toEqual({
      cron: '0 0 * * 6',
      webhookType: 'github',
      webhookUrl: '',
      secretValue: undefined,
      secretHeader: undefined,
      secretInstructions: undefined,
    });
  });
});

describe('buildTriggerTooltip', () => {
  it('returns just the base tooltip when there are no interactive elements', () => {
    const tooltip = buildTriggerTooltip(false);
    expect(tooltip).toContain('Choose how this pipeline is triggered.');
    expect(tooltip).not.toContain('Note:');
  });

  it('appends the interactive-elements note when there are interactive elements', () => {
    const tooltip = buildTriggerTooltip(true);
    expect(tooltip).toContain('Choose how this pipeline is triggered.');
    expect(tooltip).toContain('Note: This pipeline contains HITL, Printer nodes, or interrupts');
  });
});

describe('useAutoResetTriggerOnInteractive', () => {
  function setup(overrides: Partial<Parameters<typeof useAutoResetTriggerOnInteractive>[0]> = {}) {
    const updateTrigger = vi.fn().mockResolvedValue({});
    const onNotifySuccess = vi.fn();
    const onNotifyError = vi.fn();
    const initialProps = {
      hasInteractiveElements: false,
      currentTriggerType: TRIGGER_TYPES.chat_message,
      projectId: 'p1',
      versionId: 7,
      updateTrigger,
      onNotifySuccess,
      onNotifyError,
      ...overrides,
    };
    const rendered = renderHook((props: typeof initialProps) => useAutoResetTriggerOnInteractive(props), { initialProps });
    return { ...rendered, updateTrigger, onNotifySuccess, onNotifyError, initialProps };
  }

  it('does nothing when it was already interactive on mount (no true transition edge)', () => {
    const { updateTrigger } = setup({ hasInteractiveElements: true, currentTriggerType: TRIGGER_TYPES.schedule });
    expect(updateTrigger).not.toHaveBeenCalled();
  });

  it('does nothing on a transition to interactive when the current trigger is already chat_message', () => {
    const { rerender, updateTrigger, initialProps } = setup({ hasInteractiveElements: false, currentTriggerType: TRIGGER_TYPES.chat_message });
    rerender({ ...initialProps, hasInteractiveElements: true });
    expect(updateTrigger).not.toHaveBeenCalled();
  });

  it('resets to chat_message and reports success when becoming interactive with an incompatible (schedule) trigger', async () => {
    const { rerender, updateTrigger, onNotifySuccess, onNotifyError, initialProps } = setup({
      hasInteractiveElements: false,
      currentTriggerType: TRIGGER_TYPES.schedule,
    });

    await act(async () => {
      rerender({ ...initialProps, hasInteractiveElements: true, currentTriggerType: TRIGGER_TYPES.schedule });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateTrigger).toHaveBeenCalledWith({ type: TRIGGER_TYPES.chat_message });
    expect(onNotifySuccess).toHaveBeenCalledWith(
      'Trigger reset to Chat Message (pipeline now contains interactive elements)',
    );
    expect(onNotifyError).not.toHaveBeenCalled();
  });

  it('resets to chat_message when becoming interactive with an incompatible (webhook) trigger', async () => {
    const { rerender, updateTrigger, initialProps } = setup({
      hasInteractiveElements: false,
      currentTriggerType: TRIGGER_TYPES.webhook,
    });

    await act(async () => {
      rerender({ ...initialProps, hasInteractiveElements: true, currentTriggerType: TRIGGER_TYPES.webhook });
      await Promise.resolve();
    });

    expect(updateTrigger).toHaveBeenCalledWith({ type: TRIGGER_TYPES.chat_message });
  });

  it('reports an error when the reset-trigger update fails', async () => {
    const updateTrigger = vi.fn().mockRejectedValue(new Error('boom'));
    const onNotifyError = vi.fn();
    const onNotifySuccess = vi.fn();
    const initialProps = {
      hasInteractiveElements: false,
      currentTriggerType: TRIGGER_TYPES.schedule,
      projectId: 'p1',
      versionId: 7,
      updateTrigger,
      onNotifySuccess,
      onNotifyError,
    };
    const { rerender } = renderHook((props: typeof initialProps) => useAutoResetTriggerOnInteractive(props), { initialProps });

    await act(async () => {
      rerender({ ...initialProps, hasInteractiveElements: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onNotifyError).toHaveBeenCalledWith('Failed to reset trigger');
    expect(onNotifySuccess).not.toHaveBeenCalled();
  });

  it('does not reset when projectId is undefined', () => {
    const { rerender, updateTrigger, initialProps } = setup({
      hasInteractiveElements: false,
      currentTriggerType: TRIGGER_TYPES.schedule,
      projectId: undefined,
    });
    rerender({ ...initialProps, hasInteractiveElements: true, projectId: undefined });
    expect(updateTrigger).not.toHaveBeenCalled();
  });

  it('does not reset when versionId is undefined', () => {
    const { rerender, updateTrigger, initialProps } = setup({
      hasInteractiveElements: false,
      currentTriggerType: TRIGGER_TYPES.schedule,
      versionId: undefined,
    });
    rerender({ ...initialProps, hasInteractiveElements: true, versionId: undefined });
    expect(updateTrigger).not.toHaveBeenCalled();
  });
});

describe('useTriggerActions', () => {
  function setup(overrides: Partial<Parameters<typeof useTriggerActions>[0]> = {}) {
    const updateTrigger = vi.fn().mockResolvedValue({});
    const setIsUpdating = vi.fn();
    const setIsScheduleModalOpen = vi.fn();
    const setIsWebhookModalOpen = vi.fn();
    const onNotifySuccess = vi.fn();
    const onNotifyError = vi.fn();
    const args = {
      currentTriggerType: TRIGGER_TYPES.chat_message,
      currentWebhookType: 'github',
      secretValue: undefined,
      updateTrigger,
      setIsUpdating,
      setIsScheduleModalOpen,
      setIsWebhookModalOpen,
      onNotifySuccess,
      onNotifyError,
      ...overrides,
    };
    const { result } = renderHook(() => useTriggerActions(args));
    return { result, updateTrigger, setIsUpdating, setIsScheduleModalOpen, setIsWebhookModalOpen, onNotifySuccess, onNotifyError };
  }

  describe('handleTriggerTypeChange', () => {
    it('is a no-op when newType matches currentTriggerType', async () => {
      const { result, updateTrigger, setIsScheduleModalOpen } = setup({ currentTriggerType: TRIGGER_TYPES.schedule });
      await result.current.handleTriggerTypeChange(TRIGGER_TYPES.schedule);
      expect(updateTrigger).not.toHaveBeenCalled();
      expect(setIsScheduleModalOpen).not.toHaveBeenCalled();
    });

    it('opens the schedule modal (no updateTrigger call) for schedule', async () => {
      const { result, updateTrigger, setIsScheduleModalOpen } = setup();
      await result.current.handleTriggerTypeChange(TRIGGER_TYPES.schedule);
      expect(setIsScheduleModalOpen).toHaveBeenCalledWith(true);
      expect(updateTrigger).not.toHaveBeenCalled();
    });

    it('configures the webhook trigger and opens the webhook modal on success', async () => {
      const { result, updateTrigger, setIsUpdating, setIsWebhookModalOpen } = setup({ currentWebhookType: 'gitlab' });
      await result.current.handleTriggerTypeChange(TRIGGER_TYPES.webhook);
      expect(updateTrigger).toHaveBeenCalledWith({ type: TRIGGER_TYPES.webhook, schedule: { webhook_type: 'gitlab' } });
      expect(setIsWebhookModalOpen).toHaveBeenCalledWith(true);
      expect(setIsUpdating).toHaveBeenCalledWith(true);
      expect(setIsUpdating).toHaveBeenLastCalledWith(false);
    });

    it('reports an error and does not open the webhook modal when the webhook update fails', async () => {
      const updateTrigger = vi.fn().mockRejectedValue(new Error('nope'));
      const { result, setIsWebhookModalOpen, onNotifyError } = setup({ updateTrigger });
      await result.current.handleTriggerTypeChange(TRIGGER_TYPES.webhook);
      expect(onNotifyError).toHaveBeenCalledWith('Failed to configure webhook');
      expect(setIsWebhookModalOpen).not.toHaveBeenCalled();
    });

    it('updates to chat_message and reports success (the default branch)', async () => {
      const { result, updateTrigger, onNotifySuccess } = setup({ currentTriggerType: TRIGGER_TYPES.schedule });
      await result.current.handleTriggerTypeChange(TRIGGER_TYPES.chat_message);
      expect(updateTrigger).toHaveBeenCalledWith({ type: TRIGGER_TYPES.chat_message });
      expect(onNotifySuccess).toHaveBeenCalledWith('Trigger updated to Chat Message');
    });

    it('reports an error for the default branch when the update fails', async () => {
      const updateTrigger = vi.fn().mockRejectedValue(new Error('nope'));
      const { result, onNotifyError } = setup({ currentTriggerType: TRIGGER_TYPES.schedule, updateTrigger });
      await result.current.handleTriggerTypeChange(TRIGGER_TYPES.chat_message);
      expect(onNotifyError).toHaveBeenCalledWith('Failed to update trigger');
    });
  });

  describe('handleScheduleSubmit', () => {
    it('updates the trigger with the cron expression + timezone and reports success', async () => {
      const { result, updateTrigger, onNotifySuccess } = setup();
      await result.current.handleScheduleSubmit('0 9 * * 1');
      const call = updateTrigger.mock.calls[0]?.[0] as { type: string; schedule: { cron: string; timezone: string } };
      expect(call.type).toBe(TRIGGER_TYPES.schedule);
      expect(call.schedule.cron).toBe('0 9 * * 1');
      expect(onNotifySuccess).toHaveBeenCalledWith('Schedule configured successfully');
    });

    it('reports an error when the schedule update fails', async () => {
      const updateTrigger = vi.fn().mockRejectedValue(new Error('nope'));
      const { result, onNotifyError } = setup({ updateTrigger });
      await result.current.handleScheduleSubmit('0 9 * * 1');
      expect(onNotifyError).toHaveBeenCalledWith('Failed to configure schedule');
    });
  });

  describe('handleScheduleIconClick', () => {
    it('opens the schedule modal when the current trigger is already schedule', () => {
      const { result, setIsScheduleModalOpen } = setup({ currentTriggerType: TRIGGER_TYPES.schedule });
      result.current.handleScheduleIconClick();
      expect(setIsScheduleModalOpen).toHaveBeenCalledWith(true);
    });

    it('is a no-op when the current trigger is not schedule', () => {
      const { result, setIsScheduleModalOpen } = setup({ currentTriggerType: TRIGGER_TYPES.chat_message });
      result.current.handleScheduleIconClick();
      expect(setIsScheduleModalOpen).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhookIconClick', () => {
    it('is a no-op when the current trigger is not webhook', async () => {
      const { result, updateTrigger, setIsWebhookModalOpen } = setup({ currentTriggerType: TRIGGER_TYPES.chat_message });
      await result.current.handleWebhookIconClick();
      expect(updateTrigger).not.toHaveBeenCalled();
      expect(setIsWebhookModalOpen).not.toHaveBeenCalled();
    });

    it('opens the modal directly (no fetch) when a secretValue is already known', async () => {
      const { result, updateTrigger, setIsWebhookModalOpen } = setup({ currentTriggerType: TRIGGER_TYPES.webhook, secretValue: 'abc' });
      await result.current.handleWebhookIconClick();
      expect(updateTrigger).not.toHaveBeenCalled();
      expect(setIsWebhookModalOpen).toHaveBeenCalledWith(true);
    });

    it('fetches the webhook settings then opens the modal when no secretValue is known yet', async () => {
      const { result, updateTrigger, setIsWebhookModalOpen } = setup({
        currentTriggerType: TRIGGER_TYPES.webhook,
        currentWebhookType: 'custom',
        secretValue: undefined,
      });
      await result.current.handleWebhookIconClick();
      expect(updateTrigger).toHaveBeenCalledWith({ type: TRIGGER_TYPES.webhook, schedule: { webhook_type: 'custom' } });
      expect(setIsWebhookModalOpen).toHaveBeenCalledWith(true);
    });

    it('reports an error and does not open the modal when the fetch fails', async () => {
      const updateTrigger = vi.fn().mockRejectedValue(new Error('nope'));
      const { result, setIsWebhookModalOpen, onNotifyError } = setup({
        currentTriggerType: TRIGGER_TYPES.webhook,
        secretValue: undefined,
        updateTrigger,
      });
      await result.current.handleWebhookIconClick();
      expect(onNotifyError).toHaveBeenCalledWith('Failed to load webhook settings');
      expect(setIsWebhookModalOpen).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhookSubmit', () => {
    it('sends webhook_secret_value and reports the "new secret" message when a new secret is supplied', async () => {
      const { result, updateTrigger, onNotifySuccess } = setup();
      await result.current.handleWebhookSubmit('gitlab', 'new-secret');
      expect(updateTrigger).toHaveBeenCalledWith({
        type: TRIGGER_TYPES.webhook,
        schedule: { webhook_type: 'gitlab', webhook_secret_value: 'new-secret' },
      });
      expect(onNotifySuccess).toHaveBeenCalledWith('Webhook configured with new secret');
    });

    it('omits the secret field and reports the plain success message when newSecretValue is null', async () => {
      const { result, updateTrigger, onNotifySuccess } = setup();
      await result.current.handleWebhookSubmit('github', null);
      expect(updateTrigger).toHaveBeenCalledWith({ type: TRIGGER_TYPES.webhook, schedule: { webhook_type: 'github' } });
      expect(onNotifySuccess).toHaveBeenCalledWith('Webhook configured successfully');
    });

    it('reports an error when the webhook submit fails', async () => {
      const updateTrigger = vi.fn().mockRejectedValue(new Error('nope'));
      const { result, onNotifyError } = setup({ updateTrigger });
      await result.current.handleWebhookSubmit('github', null);
      expect(onNotifyError).toHaveBeenCalledWith('Failed to configure webhook');
    });
  });
});
