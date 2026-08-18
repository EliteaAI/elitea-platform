import { useCallback, useMemo, useRef, useState } from 'react';

import type { ApplicationVersionDetail } from '@/shared/api/generated/model';

/**
 * The version-level fields `CreateAgentForm` renders on the agent EDIT page
 * that `applicationCreationSchema` does not validate — held outside the RHF
 * form, exactly as `pages/agents/CreateApplication.tsx` already holds them
 * for the CREATE page (see its `CreateAgentFormExtraFields` doc comment for
 * why widening the form's generic would need an unsound resolver cast for
 * fields nothing ever validates).
 *
 * #307: before this hook existed these four fields were rendered from the
 * server response and routed nowhere — `useEditApplicationEditorBridge`
 * early-returned for every path except `name`/`description`, so typing in
 * instructions or the welcome message updated nothing at all and the Save
 * button reported success having sent only `conversation_starters`.
 */
export interface EditApplicationVersionFields {
  readonly instructions: string;
  readonly welcomeMessage: string;
  readonly variables: readonly { readonly name: string; readonly value: string }[];
  readonly stepLimit: number | undefined;
  /**
   * `meta.internal_tools` — the Tools panel's internal-tool switches (#307's
   * mount). Held here with the other version-level fields because it is
   * saved the same way they are: inside the `meta` blob the Go
   * `UpdateVersion` handler assigns wholesale, which
   * `toVersionSaveBody` merges rather than replaces. Unlike the attached
   * TOOLKITS (immediate `entity_tool_mapping` writes, no Save involved),
   * these switches are ordinary unsaved form state until Save.
   */
  readonly internalTools: readonly string[];
}

export interface EditApplicationVersionFieldsState {
  readonly fields: EditApplicationVersionFields;
  /**
   * Applies one `CreateAgentForm` field change. Returns `true` when `path`
   * is one this hook owns, so the bridge can fall through to the RHF form
   * for the paths it does not (`name`/`description`) without duplicating
   * the path list in two places.
   */
  readonly applyFieldChange: (path: string, value: unknown) => boolean;
  /** Feeds the page's `useUnsavedChangesNavBlocker` — RHF's own `isDirty` cannot see these fields (#133's create-page half made the same point). */
  readonly isDirty: boolean;
  /** Called after a successful save so the edits just persisted stop counting as unsaved (mirrors `form.reset(form.getValues())` on the RHF half). */
  readonly markSaved: () => void;
}

function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function fromVersion(version: ApplicationVersionDetail | undefined): EditApplicationVersionFields {
  const metaRecord: Record<string, unknown> = version?.meta ?? {};
  return {
    instructions: version?.instructions ?? '',
    welcomeMessage: version?.welcome_message ?? '',
    variables: (version?.variables ?? []).map((variable) => ({
      name: variable.name ?? '',
      value: variable.value ?? '',
    })),
    stepLimit: typeof metaRecord['step_limit'] === 'number' ? metaRecord['step_limit'] : undefined,
    internalTools: toStringArray(metaRecord['internal_tools']),
  };
}

function areEqual(a: EditApplicationVersionFields, b: EditApplicationVersionFields): boolean {
  if (a.instructions !== b.instructions) return false;
  if (a.welcomeMessage !== b.welcomeMessage) return false;
  if (a.stepLimit !== b.stepLimit) return false;
  if (a.internalTools.length !== b.internalTools.length) return false;
  if (a.internalTools.some((name, index) => b.internalTools[index] !== name)) return false;
  if (a.variables.length !== b.variables.length) return false;
  return a.variables.every((variable, index) => {
    const other = b.variables[index];
    return other !== undefined && variable.name === other.name && variable.value === other.value;
  });
}

function toVariables(value: unknown, previous: EditApplicationVersionFields['variables']) {
  return Array.isArray(value) ? (value as { name: string; value: string }[]) : previous;
}

/**
 * @param activeVersion The version whose fields are being edited. Seeded
 * from it on first arrival and RE-seeded only when the version's IDENTITY
 * changes (a version switch), NOT on every new response object: the detail
 * query refetches (window focus, a sibling mutation) return a fresh object
 * for the same version, and keying the resync on object identity would
 * clobber whatever the user had typed since. Same reasoning
 * `features/agents/ui/WelcomeMessageInput.tsx` already applies to its own
 * `versionId` resync dependency.
 */
export function useEditApplicationVersionFields(
  activeVersion: ApplicationVersionDetail | undefined,
): EditApplicationVersionFieldsState {
  const [fields, setFields] = useState<EditApplicationVersionFields>(() => fromVersion(activeVersion));
  const [baseline, setBaseline] = useState<EditApplicationVersionFields>(fields);
  // The identity this state was seeded from. `undefined` while the detail
  // fetch is still in flight, which is the normal first render — the seed
  // below fires as soon as the real version resolves.
  const seededFrom = useRef<string | undefined>(activeVersion?.id);

  // Render-phase resync rather than an effect: an effect would render one
  // frame of blank inputs over a version that has already arrived, which is
  // the exact staleness `useEditApplicationEditorBridge`'s own `useWatch`
  // doc comment records hitting on this page.
  if (seededFrom.current !== activeVersion?.id) {
    seededFrom.current = activeVersion?.id;
    const seeded = fromVersion(activeVersion);
    setFields(seeded);
    setBaseline(seeded);
  }

  const applyFieldChange = useCallback((path: string, value: unknown): boolean => {
    switch (path) {
      case 'version_details.instructions':
        setFields((previous) => ({ ...previous, instructions: typeof value === 'string' ? value : '' }));
        return true;
      case 'version_details.welcome_message':
        setFields((previous) => ({ ...previous, welcomeMessage: typeof value === 'string' ? value : '' }));
        return true;
      case 'version_details.variables':
        setFields((previous) => ({ ...previous, variables: toVariables(value, previous.variables) }));
        return true;
      case 'version_details.meta.internal_tools':
        setFields((previous) => ({ ...previous, internalTools: toStringArray(value) }));
        return true;
      case 'version_details.meta.step_limit':
        setFields((previous) => ({ ...previous, stepLimit: typeof value === 'number' ? value : undefined }));
        return true;
      default:
        return false;
    }
  }, []);

  const markSaved = useCallback(() => setBaseline(fields), [fields]);

  const isDirty = useMemo(() => !areEqual(fields, baseline), [fields, baseline]);

  return { fields, applyFieldChange, isDirty, markSaved };
}
