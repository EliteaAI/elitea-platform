/**
 * Service prompts section — displays prompt cards, supports create/edit/restore
 * via a modal dialog.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/system-prompts/
 * ServicePromptsSection.jsx`.
 *
 * Deviations from the baseline:
 *  - Uses `useSelectedProjectStore` instead of Redux hooks
 *  - Uses the handwritten `configurationsApi` instead of RTK Query slices
 *  - Uses `CodeMirrorEditor` without extensions (markdown support not
 *    installed in this app; plain text editing only)
 *  - No `useToast` — errors surface as inline feedback (toast integration
 *    is a future unit)
 *  - Uses `ExpandedViewerModal` for the create/edit dialog
 *  - No tour IDs
 *  - Key validation is client-side only (matches baseline behavior)
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';

import type { ConfigurationItem } from '@/shared/api/configurationsApi';
import {
  useCreateConfigurationMutation,
  useGetAvailableConfigurationsTypeQuery,
  useGetConfigurationsListQuery,
  useUpdateConfigurationMutation,
} from '@/shared/api/configurationsApi';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import { t } from '@/shared/ui/lib/t';
import { ServicePromptsBody } from './ServicePromptsBody';

export interface PromptConfig {
  id: number;
  key: string;
  label: string;
  prompt: string;
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function isPublicProject(projectId: string | null | undefined): boolean {
  return projectId === '1' || projectId === undefined;
}

function deriveLabelFromKey(key: string): string {
  const safe = String(key || '').trim();
  if (!safe) return t('shared.ui.settings.prompts.defaultLabel', 'Service prompt');
  return safe
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/* ── component ────────────────────────────────────────────────────────── */
export const ServicePromptsSection = memo(function ServicePromptsSection() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');
  const enabled = !!projectId && isPublicProject(projectId);

  /* ── data fetching ─────────────────────────────────────────────────── */
  const { data: configsData, isLoading, isFetching } = useGetConfigurationsListQuery(
    { projectId, section: 'service_prompts', includeShared: false, pageSize: 100 },
    { enabled },
  );

  const { data: availableTypes } = useGetAvailableConfigurationsTypeQuery(
    { section: 'service_prompt' },
    { enabled },
  );

  const createMutation = useCreateConfigurationMutation(projectId);
  const updateMutation = useUpdateConfigurationMutation(projectId);
  const isBusy = isLoading || isFetching || createMutation.isPending || updateMutation.isPending;

  /* ── derived data ──────────────────────────────────────────────────── */
  const prompts = useMemo<PromptConfig[]>(() => {
    const items: ConfigurationItem[] = configsData?.items ?? [];
    return items
      .filter((item) => item.section === 'service_prompts')
      .map((item) => {
        const key = (item.data?.key as string | undefined) ?? item.elitea_title ?? '';
        const prompt = (item.data?.prompt as string | undefined) ?? '';
        return {
          id: item.id,
          key: String(key),
          label: item.label ?? deriveLabelFromKey(String(key)),
          prompt: String(prompt),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [configsData?.items]);
  const allowedKeys = useMemo(() => {
    const raw = availableTypes?.find((item) => item.type === 'service_prompt')?.config_schema;
    const schema = raw ?? {};
    const data = (schema?.properties as Record<string, unknown>)?.data as Record<string, unknown>;
    const props = (data?.properties as Record<string, unknown>) ?? {};
    const keys = (props?.key as { enum?: unknown[] })?.enum;
    if (Array.isArray(keys) && keys.length) {
      return Array.from(new Set(keys.map((v) => String(v).trim().toLowerCase()).filter(Boolean)));
    }
    return ['mermaid_quick_fix'];
  }, [availableTypes]);

  const usedKeys = useMemo(() => new Set(prompts.map((p) => p.key.toLowerCase())), [prompts]);

  const availableKeys = useMemo(
    () => allowedKeys.filter((key) => !usedKeys.has(key)),
    [allowedKeys, usedKeys],
  );
  const defaultPromptsByKey = useMemo(() => {
    const raw = availableTypes?.find((item) => item.type === 'service_prompt')?.config_schema;
    const schema = raw ?? {};
    const data = (schema?.properties as Record<string, unknown>)?.data as Record<string, unknown>;
    const props = (data?.properties as Record<string, unknown>) ?? {};
    const defaults = (props?.prompt as { default_by_key?: unknown })?.default_by_key;
    if (defaults && typeof defaults === 'object') return defaults;
    return {};
  }, [availableTypes]);

  const getDefaultPrompt = useCallback(
    (key: string): string | null => {
      if (!key) return null;
      const normalized = String(key).toLowerCase();
      const obj = defaultPromptsByKey as Record<string, unknown>;
      return (
        (obj[normalized] as string) ??
        (obj[key] as string) ??
        (obj[key.toLowerCase()] as string) ??
        null
      );
    },
    [defaultPromptsByKey],
  );
  /* ── local state (refs to reduce hook deps) ────────────────────────── */
  const [isOpen, setIsOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<PromptConfig | null>(null);
  const modeRef = useRef<'create' | 'edit' | null>(null);
  const draftKeyRef = useRef('');
  const draftPromptRef = useRef('');
  const hasAvailableKeys = availableKeys.length > 0;
  const availableKeysRef = useRef(availableKeys);
  availableKeysRef.current = availableKeys;
  const usedKeysRef = useRef(usedKeys);
  usedKeysRef.current = usedKeys;

  const handleOpenCreate = useCallback(() => {
    if (!enabled) return;
    modeRef.current = 'create';
    setSelectedConfig(null);
    draftKeyRef.current = availableKeysRef.current[0] ?? '';
    draftPromptRef.current = '';
    setIsOpen(true);
  }, [enabled]);

  const handleOpenEdit = useCallback((config: PromptConfig) => {
    modeRef.current = 'edit';
    setSelectedConfig(config);
    draftKeyRef.current = config.key;
    draftPromptRef.current = config.prompt;
    setIsOpen(true);
  }, []);

  const handleDiscard = useCallback(() => {
    setIsOpen(false);
    modeRef.current = null;
    setSelectedConfig(null);
    draftKeyRef.current = '';
    draftPromptRef.current = '';
  }, []);

  /* ── validate key (caches deps) ────────────────────────────────────── */
  const validateKey = useCallback(
    (key: string, { disallowUsed = false } = {}): { ok: boolean; message?: string; key?: string } => {
      const normalized = String(key || '').trim();
      if (!normalized) return { ok: false, message: t('shared.ui.settings.prompts.keyEmpty', 'Key cannot be empty') };
      if (normalized.length > 128) return { ok: false, message: t('shared.ui.settings.prompts.keyTooLong', 'Key must not exceed 128 characters') };
      if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
        return { ok: false, message: t('shared.ui.settings.prompts.keyInvalid', 'Key must contain only letters, numbers, underscores, or dashes') };
      }
      const lowered = normalized.toLowerCase();
      if (allowedKeys.length && !allowedKeys.includes(lowered)) {
        return { ok: false, message: t('shared.ui.settings.prompts.keyNotAllowed', 'Key must be selected from the predefined list') };
      }
      if (disallowUsed && usedKeysRef.current.has(lowered)) {
        return { ok: false, message: t('shared.ui.settings.prompts.keyAlreadyUsed', 'This key is already configured') };
      }
      return { ok: true, key: lowered };
    },
    [allowedKeys],
  );

  /* ── save (ref-based deps → ≤ 8) ───────────────────────────────────── */

  /* ── build create body helper ──────────────────────────────────────── */
  const buildCreateBody = useCallback(
    (key: string, promptText: string) => ({
      elitea_title: key,
      label: deriveLabelFromKey(key),
      type: 'service_prompt',
      shared: true,
      data: { key, prompt: promptText },
    }),
    [],
  );

  const buildEditBody = useCallback(
    (config: PromptConfig, key: string, promptText: string) => ({
      label: config.label ?? deriveLabelFromKey(key),
      shared: true,
      data: { key, prompt: promptText },
    }),
    [],
  );

  const handleSave = useCallback(async () => {
    if (!enabled) return;

    const promptText = String(draftPromptRef.current || '').trim();
    if (!promptText) return;

    const keyValidation = validateKey(draftKeyRef.current);
    if (!keyValidation.ok) return;

    const key = keyValidation.key ?? String(draftKeyRef.current || '').trim();

    try {
      if (modeRef.current === 'edit' && selectedConfig) {
        await updateMutation.mutateAsync({
          configId: String(selectedConfig.id),
          body: buildEditBody(selectedConfig, key, promptText),
        });
      } else {
        const createKeyValidation = validateKey(draftKeyRef.current, { disallowUsed: true });
        if (!createKeyValidation.ok) return;

        await createMutation.mutateAsync(
          buildCreateBody(createKeyValidation.key ?? draftKeyRef.current, promptText),
        );
      }
      handleDiscard();
    } catch {
      // TODO: show toast error
    }
  }, [enabled, selectedConfig, validateKey, createMutation, updateMutation, handleDiscard, buildEditBody, buildCreateBody]);

  /* ── restore ───────────────────────────────────────────────────────── */
  const handleRestoreToDefault = useCallback(
    async (config: PromptConfig) => {
      if (!enabled || !config.id) return;
      const defaultPromptValue = getDefaultPrompt(config.key);
      if (!defaultPromptValue) return;

      try {
        await updateMutation.mutateAsync({
          configId: String(config.id),
          body: {
            label: config.label ?? deriveLabelFromKey(config.key),
            shared: true,
            data: { key: config.key, prompt: defaultPromptValue },
          },
        });
      } catch {
        // TODO: show toast error
      }
    },
    [enabled, getDefaultPrompt, updateMutation],
  );

  const handleRestoreInModal = useCallback(() => {
    if (!selectedConfig) return;
    const defaultPromptValue = getDefaultPrompt(selectedConfig.key);
    if (defaultPromptValue) draftPromptRef.current = defaultPromptValue;
  }, [selectedConfig, getDefaultPrompt]);

  const hasDefaultPrompt = useCallback((key: string) => Boolean(getDefaultPrompt(key)), [getDefaultPrompt]);

  const hasChanges = useMemo(() => {
    if (modeRef.current === 'create') return draftPromptRef.current.trim().length > 0;
    if (modeRef.current === 'edit' && selectedConfig) {
      return draftKeyRef.current !== selectedConfig.key || draftPromptRef.current !== selectedConfig.prompt;
    }
    return false;
  }, [selectedConfig]);

  /* ── render ────────────────────────────────────────────────────────── */
  if (!enabled) return null;

  const createTooltip = hasAvailableKeys
    ? t('shared.ui.settings.prompts.createTooltip', 'Create service prompt')
    : t('shared.ui.settings.prompts.allConfiguredTooltip', 'All service prompt keys are already configured');

  const modalTitle = modeRef.current === 'create'
    ? t('shared.ui.settings.prompts.newPromptTitle', 'New Service Prompt')
    : (selectedConfig?.label ?? draftKeyRef.current ?? t('shared.ui.settings.prompts.editPromptTitle', 'Edit Service Prompt'));

  return (
    <ServicePromptsBody
      createTooltip={createTooltip}
      modalTitle={modalTitle}
      handleOpenCreate={handleOpenCreate}
      handleOpenEdit={handleOpenEdit}
      handleDiscard={handleDiscard}
      handleSave={handleSave}
      handleRestoreToDefault={handleRestoreToDefault}
      hasDefaultPrompt={hasDefaultPrompt}
      prompts={prompts}
      isBusy={isBusy}
      hasAvailableKeys={hasAvailableKeys}
      isOpen={isOpen}
      allowedKeys={allowedKeys}
      usedKeysRef={usedKeysRef}
      hasDefault={hasDefaultPrompt(draftKeyRef.current)}
      hasChanges={hasChanges}
      onRestoreInModal={handleRestoreInModal}
      modeRef={modeRef}
      draftKeyRef={draftKeyRef}
      draftPromptRef={draftPromptRef}
      onDraftKeyChange={(val) => { draftKeyRef.current = val; }}
      onDraftPromptChange={(val) => { draftPromptRef.current = val; }}
    />
  );
});
