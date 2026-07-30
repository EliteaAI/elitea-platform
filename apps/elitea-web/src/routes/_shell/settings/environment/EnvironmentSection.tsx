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
 *  - No `useToast` — errors surface in the UI layer (toast integration
 *    is a future unit)
 *  - Edits are saved on blur (same as baseline) — no explicit save button
 *  - Creates a new configuration if none exists yet (same as baseline)
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { AvailableConfigurationType, ConfigurationItem } from '@/shared/api/configurationsApi';
import { useCreateConfigurationMutation, useGetAvailableConfigurationsTypeQuery, useGetConfigurationsListQuery, useUpdateConfigurationMutation } from '@/shared/api/configurationsApi';
import type { EnvironmentFieldDefinition } from '@/routes/_shell/settings/environment/environmentField.helpers';
import { ENVIRONMENT_FIELD_DEFAULTS, ENVIRONMENT_FIELD_ORDER, ENVIRONMENT_SECTION } from '@/routes/_shell/settings/environment/environment.constants';
import { EnvironmentFieldRow } from '@/routes/_shell/settings/environment/EnvironmentFieldRow';
import { buildFieldDefinition, validateFieldValue } from '@/routes/_shell/settings/environment/environmentField.helpers';
import { useSelectedProjectStore } from '@/widgets/app-shell';

/* ── helpers ──────────────────────────────────────────────────────────── */

/** Check whether the public project is selected. */
function isPublicProject(projectId: string | null | undefined): boolean {
  return projectId === '1' || projectId === undefined;
}

/**
 * Normalise a schema property map into ordered field definitions.
 */
function buildFields(
  availableTypes: AvailableConfigurationType[] | undefined,
): EnvironmentFieldDefinition[] {
  const raw = availableTypes?.find((item) => item.type === ENVIRONMENT_SECTION)?.config_schema;
  const schema = (raw ?? {}) as Record<string, unknown>;
  const props = (schema?.properties as Record<string, unknown>)?.data as Record<string, unknown>;
  if (!props) return [];
  return ENVIRONMENT_FIELD_ORDER.map((key) => {
    const fieldSchema = props[key] as Record<string, unknown> | undefined;
    const defaults = ENVIRONMENT_FIELD_DEFAULTS[key];
    return buildFieldDefinition(key, fieldSchema, (defaults ?? {}) as Record<string, { minimum?: number; maximum?: number }>);
  });
}

/* ── component ────────────────────────────────────────────────────────── */

/**
 * Full environment settings section. Renders nothing when the public project
 * is not selected (environment settings only apply to the public project).
 */
export const EnvironmentSection = memo(function EnvironmentSection() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');

  const { data, isLoading, isFetching } = useGetConfigurationsListQuery(
    { projectId, section: ENVIRONMENT_SECTION, includeShared: false, pageSize: 100 },
    { enabled: !!projectId && isPublicProject(projectId) },
  );

  const { data: availableTypes } = useGetAvailableConfigurationsTypeQuery(
    { section: ENVIRONMENT_SECTION },
    { enabled: !!projectId && isPublicProject(projectId) },
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
          const rawDefault = field.defaultValue;
          next[field.key] = String(rawDefault ?? '');
        }
      }
      return next;
    });
  }, [currentConfig, schemaFields]);

  const handleChange = useCallback((fieldKey: string, value: string) => {
    setDraftValues((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  const handleBlur = useCallback(
    async (fieldKey: string) => {
      const field = schemaFields.find((f) => f.key === fieldKey);
      if (!field) return;

      const rawValue = String(draftValues[fieldKey] || '').trim();

      const validationError = validateFieldValue(rawValue, field);
      if (validationError) {
        return; // TODO: show toast
      }

      const savedValue = currentConfig?.data?.[fieldKey];

      // Check if value actually changed
      if (savedValue === undefined) return;

      let isDifferent = false;
      if (field.type === 'integer') {
        isDifferent = parseInt(String(savedValue), 10) !== parseInt(rawValue, 10);
      } else if (field.type === 'number') {
        isDifferent = parseFloat(String(savedValue)) !== parseFloat(rawValue);
      } else if (field.type === 'boolean') {
        isDifferent = String(savedValue) !== rawValue;
      } else {
        isDifferent = String(savedValue) !== rawValue;
      }
      if (!isDifferent) return;

      try {
        if (currentConfig?.id) {
          await updateMutation.mutateAsync({
            configId: String(currentConfig.id),
            body: {
              label: currentConfig.label,
              shared: true,
              data: { ...currentConfig.data, [fieldKey]: rawValue },
            },
          });
        } else {
          await createMutation.mutateAsync({
            elitea_title: ENVIRONMENT_SECTION,
            label: ENVIRONMENT_SECTION,
            type: ENVIRONMENT_SECTION,
            shared: true,
            data: { [fieldKey]: rawValue },
          });
        }
      } catch {
        // TODO: show toast error
      }
    },
    [currentConfig, createMutation, draftValues, schemaFields, updateMutation],
  );

  const handleRestore = useCallback(
    async (fieldKey: string) => {
      const field = schemaFields.find((f) => f.key === fieldKey);
      if (!field || !currentConfig || field.defaultValue === undefined) return;

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
      } catch {
        // TODO: show toast error
      }
    },
    [currentConfig, schemaFields, updateMutation],
  );

  // Don't render outside the public project
  if (!isPublicProject(projectId)) return null;

  return (
    <Box sx={styles.content}>
      {schemaFields.map((field) => (
        <EnvironmentFieldRow
          key={field.key}
          field={field}
          value={draftValues[field.key] ?? ''}
          disabled={isBusy}
          onChange={handleChange}
          onBlur={handleBlur}
          onRestore={handleRestore}
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
