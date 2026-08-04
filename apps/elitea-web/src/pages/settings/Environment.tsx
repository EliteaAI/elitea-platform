/**
 * Environment settings section — fetches field definitions from the server,
 * renders each as an `EnvironmentFieldRow`, and flushes changes on blur.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/environment/
 * EnvironmentSection.jsx`.
 *
 * Deviations from the baseline:
 *  - Uses `useSelectedProjectStore` instead of Redux hooks
 *  - Uses the handwritten `configurationsApi` instead of RTK Query slices
 *  - No `useToast` — errors surface inline on the field row itself (via
 *    `EnvironmentFieldRow`'s `error` prop) instead of a toast/snackbar;
 *    a real toast system is a future unit (see `ServicePrompts.tsx` for
 *    the same documented gap elsewhere in this settings area)
 *  - Edits are saved on blur (same as baseline) — no explicit save button
 *  - Creates a new configuration if none exists yet (same as baseline)
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { isPublicProject as isPublicProjectSelector } from '@/entities/project';
import type { AvailableConfigurationType, ConfigurationItem } from '@/shared/api/configurationsApi';
import { useCreateConfigurationMutation, useGetAvailableConfigurationsTypeQuery, useGetConfigurationsListQuery, useUpdateConfigurationMutation } from '@/shared/api/configurationsApi';
import { EliteaApiError } from '@/shared/api/generated/mutator';
import { getConfig } from '@/shared/config';
import type { EnvironmentFieldDefinition } from '@/features/settings';
import { environmentFeature } from '@/features/settings';
import { PERMISSIONS } from '@/shared/lib/permissions';
import { t } from '@/shared/i18n';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import { usePermissionSet } from '@/widgets/sidebar';

const { ENVIRONMENT_FIELD_DEFAULTS, ENVIRONMENT_FIELD_ORDER, ENVIRONMENT_SECTION, buildFieldDefinition, validateFieldValue, EnvironmentFieldRow } = environmentFeature;

/* ── helpers ──────────────────────────────────────────────────────────── */

/**
 * Check whether `projectId` is the tenant's public project. Reads the
 * per-deployment `VITE_PUBLIC_PROJECT_ID` runtime value (via `shared/config`)
 * instead of a hardcoded literal — same pattern as `pages/agents/lib/
 * isPublicAgentsProject.ts` (`entities/project`'s `isPublicProject` selector
 * + `shared/config`'s `getConfig()`), reproduced locally here because
 * `pages/` may not import `src/routes/-guards/publicProject.ts`.
 */
function isPublicProject(projectId: string): boolean {
  const config = getConfig();
  if (config.status !== 'ok') return false;
  return isPublicProjectSelector(projectId, config.config.vite_public_project_id);
}

/**
 * Coerce a raw (always-string) draft value to the field's declared type —
 * mirrors `environmentField.helpers.ts`'s `parseFieldValue` (old-app
 * parity: `EnvironmentFieldHelpers.parseFieldValue`). Duplicated locally,
 * not imported: `pages/` may only reach `features/settings` through its
 * curated barrel (`no-deep-slice-import`), which does not currently
 * re-export `parseFieldValue` (see this unit's fix report for the barrel
 * follow-up).
 */
function parseFieldValue(value: string, type: EnvironmentFieldDefinition['type']): string | number | boolean {
  if (type === 'integer') return parseInt(value, 10);
  if (type === 'number') return parseFloat(value);
  if (type === 'boolean') return value === 'true';
  return String(value ?? '').trim();
}

/** Extract a human-readable message from a save/restore failure. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof EliteaApiError && err.failure.kind === 'http') {
    const body = err.failure.body;
    if (body !== null && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      if (typeof record.error === 'string' && record.error) return record.error;
      if (typeof record.message === 'string' && record.message) return record.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * Render a raw config/default value (of otherwise-`unknown` type — the
 * server's `data` bag isn't statically typed) as a display string. Only
 * ever calls `String()` on values already narrowed to `string | number |
 * boolean` so it never risks `[object Object]`.
 */
function toDisplayString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Clear a single field's inline error, if it has one (no-op state update avoided). */
function clearFieldError(
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  fieldKey: string,
): void {
  setFieldErrors((prev) => {
    if (!(fieldKey in prev)) return prev;
    const next = { ...prev };
    delete next[fieldKey];
    return next;
  });
}

/**
 * Normalise a schema property map into ordered field definitions. Filters
 * `ENVIRONMENT_FIELD_ORDER` down to keys the backend schema actually
 * declares (matches the old app's `ENVIRONMENT_FIELD_ORDER.filter(key =>
 * key in dataProperties)`) instead of mapping over it unconditionally.
 */
function buildFields(
  availableTypes: AvailableConfigurationType[] | undefined,
): EnvironmentFieldDefinition[] {
  const raw = availableTypes?.find((item) => item.type === ENVIRONMENT_SECTION)?.config_schema;
  const schema = raw ?? {};
  const dataSchema = (schema?.properties as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined;
  const dataProperties = (dataSchema?.properties as Record<string, unknown> | undefined) ?? {};
  return ENVIRONMENT_FIELD_ORDER.filter((key) => key in dataProperties).map((key) => {
    const fieldSchema = dataProperties[key] as Record<string, unknown> | undefined;
    const defaults = ENVIRONMENT_FIELD_DEFAULTS[key];
    return buildFieldDefinition(key, fieldSchema, defaults);
  });
}

/* ── component ────────────────────────────────────────────────────────── */

/**
 * Full environment settings section. Renders nothing when the public project
 * is not selected (environment settings only apply to the public project).
 */
export const Environment = memo(function Environment() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');
  const isPublic = isPublicProject(projectId);

  const permissions = usePermissionSet(isPublic ? projectId : undefined);
  const canEdit = permissions.has(PERMISSIONS.configuration.update);

  const { data, isLoading, isFetching } = useGetConfigurationsListQuery(
    { projectId, section: ENVIRONMENT_SECTION, includeShared: false, pageSize: 100 },
    { enabled: !!projectId && isPublic },
  );

  const { data: availableTypes } = useGetAvailableConfigurationsTypeQuery(
    { section: ENVIRONMENT_SECTION },
    { enabled: !!projectId && isPublic },
  );

  const createMutation = useCreateConfigurationMutation(projectId);
  const updateMutation = useUpdateConfigurationMutation(projectId);

  const isBusy = isLoading || isFetching || createMutation.isPending || updateMutation.isPending;

  const schemaFields = useMemo(() => buildFields(availableTypes), [availableTypes]);

  // Current config from the server
  const currentConfig = useMemo(() => {
    const items: ConfigurationItem[] = data?.items ?? [];
    return items.find((item) => item.section === ENVIRONMENT_SECTION) ?? null;
  }, [data?.items]);

  // Draft values — single state object keyed by field key
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  // Inline per-field error messages (validation failures + save/restore failures)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Track the previous currentConfig reference so we can detect server-side changes
  const prevConfigRef = useRef(currentConfig);

  // Sync drafts with server data when it arrives
  useEffect(() => {
    if (!schemaFields.length) return;

    const configChanged = prevConfigRef.current !== currentConfig;
    prevConfigRef.current = currentConfig;

    setDraftValues((prev) => {
      const allInitialized = schemaFields.every((field) => prev[field.key] !== undefined);
      if (allInitialized && !configChanged) return prev;

      const next = { ...prev };
      for (const field of schemaFields) {
        if (next[field.key] === undefined || configChanged) {
          next[field.key] = toDisplayString(currentConfig?.data?.[field.key] ?? field.defaultValue);
        }
      }
      return next;
    });
  }, [currentConfig, schemaFields]);

  // Flush pending edits on page reload by blurring the active input (same as
  // baseline `EnvironmentSection.jsx:77-84`) — otherwise a field the user is
  // still focused in when they reload/close the tab never gets its
  // onBlur-triggered save invoked.
  useEffect(() => {
    const handleBeforeUnload = () => {
      (document.activeElement as HTMLElement | null)?.blur();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleChange = useCallback((fieldKey: string, value: string) => {
    setDraftValues((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  const handleBlur = useCallback(
    async (fieldKey: string) => {
      if (!canEdit) return;

      const field = schemaFields.find((f) => f.key === fieldKey);
      if (!field) return;

      const rawValue = String(draftValues[fieldKey] || '').trim();
      const parsedValue = parseFieldValue(rawValue, field.type);
      const savedValue = currentConfig?.data?.[fieldKey];

      if (parsedValue === savedValue) return;

      const validationError = validateFieldValue(rawValue, field);
      if (validationError) {
        setFieldErrors((prev) => ({
          ...prev,
          [fieldKey]: t('shared.ui.settings.environment.validationError', '{{label}}: {{error}}', {
            label: field.label,
            error: validationError,
          }),
        }));
        setDraftValues((prev) => ({ ...prev, [fieldKey]: toDisplayString(savedValue ?? field.defaultValue) }));
        return;
      }

      try {
        if (currentConfig?.id) {
          await updateMutation.mutateAsync({
            configId: String(currentConfig.id),
            body: {
              label: currentConfig.label,
              shared: true,
              data: { ...currentConfig.data, [fieldKey]: parsedValue },
            },
          });
        } else {
          await createMutation.mutateAsync({
            elitea_title: ENVIRONMENT_SECTION,
            label: ENVIRONMENT_SECTION,
            type: ENVIRONMENT_SECTION,
            shared: true,
            data: { [fieldKey]: parsedValue },
          });
        }
        clearFieldError(setFieldErrors, fieldKey);
      } catch (err) {
        setFieldErrors((prev) => ({
          ...prev,
          [fieldKey]: extractErrorMessage(err, t('shared.ui.settings.environment.saveError', 'Failed to save configuration')),
        }));
      }
    },
    [canEdit, createMutation, currentConfig, draftValues, schemaFields, updateMutation],
  );

  const handleRestore = useCallback(
    async (fieldKey: string) => {
      const field = schemaFields.find((f) => f.key === fieldKey);
      if (!canEdit || !field || !currentConfig?.id || field.defaultValue === undefined) return;

      setDraftValues((prev) => ({ ...prev, [fieldKey]: String(field.defaultValue) }));

      try {
        await updateMutation.mutateAsync({
          configId: String(currentConfig.id),
          body: {
            label: currentConfig.label,
            shared: true,
            data: { ...currentConfig.data, [fieldKey]: field.defaultValue },
          },
        });
        clearFieldError(setFieldErrors, fieldKey);
      } catch (err) {
        setFieldErrors((prev) => ({
          ...prev,
          [fieldKey]: extractErrorMessage(err, t('shared.ui.settings.environment.restoreError', 'Failed to restore configuration')),
        }));
      }
    },
    [canEdit, currentConfig, schemaFields, updateMutation],
  );

  // Don't render outside the public project
  if (!isPublic) return null;

  return (
    <Box sx={styles.content}>
      {schemaFields.map((field) => (
        <EnvironmentFieldRow
          key={field.key}
          field={field}
          value={draftValues[field.key] ?? ''}
          disabled={!canEdit || isBusy}
          error={fieldErrors[field.key]}
          onChange={handleChange}
          onBlur={(...args) => void handleBlur(...args)}
          onRestore={(...args) => void handleRestore(...args)}
        />
      ))}
    </Box>
  );
});

/* ── styles ───────────────────────────────────────────────────────────── */

const styles: Record<string, SxProps<Theme>> = {
  content: ({ palette, spacing }) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: `${spacing(2.75)}rem`,
    gap: spacing(3),
    backgroundColor: palette.background.tabPanel,
    height: '100%',
    overflowY: 'auto',
  }),
};
