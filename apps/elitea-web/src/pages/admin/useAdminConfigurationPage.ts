/**
 * State and handlers for `pages/admin/Configuration.tsx` (unit A14, issue #200).
 *
 * Separated from the view in the same shape as `./useAdminSchedulesPage.ts`, so
 * the page file is layout and this file is behaviour.
 *
 * Two decisions are worth naming.
 *
 * **Only CHANGED keys are sent.** `draft` holds the operator's edits and
 * nothing else; the form reads `{...serverValues, ...draft}`. The reference
 * keeps a full copy of the section and PUTs all of it, which means a save of one
 * card re-asserts every other field — and a field the server would now refuse
 * (a link that was stored before the scheme check existed) would make an
 * unrelated save fail. Sending the delta also makes "is there anything to save"
 * a fact rather than a deep comparison.
 *
 * **The baseline is the SERVER's answer, always.** After a successful save the
 * draft is cleared and the query is invalidated, so what the form shows next is
 * what the server stored — not what was typed. A page that keeps showing the
 * typed value after a save cannot distinguish a write that landed from one that
 * was silently transformed.
 */
import { useCallback, useMemo, useState } from 'react';

import { withoutBlankLinks, type ConfigLink } from './ConfigurationLinksEditor';
import {
  configFailureReason,
  configFailureStatus,
  useAdminConfigSections,
  useAdminConfigValues,
  useSaveAdminConfigValues,
  type AdminConfigSection,
} from './api/adminConfigurationApi';

export interface AdminConfigurationPageState {
  readonly sections: readonly AdminConfigSection[];
  readonly isLoadingSections: boolean;
  readonly sectionsError: string | undefined;
  readonly activeSection: AdminConfigSection | undefined;
  readonly onSelectSection: (sectionId: string) => void;
  /** The server's reason this section cannot be edited, when it gave one. */
  readonly unavailableReason: string | undefined;
  readonly values: Readonly<Record<string, unknown>>;
  readonly isLoadingValues: boolean;
  readonly valuesError: string | undefined;
  readonly onFieldChange: (key: string, next: unknown) => void;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly saveError: string | undefined;
  readonly savedAt: number | undefined;
  readonly onDismissSaved: () => void;
  readonly onDismissError: () => void;
}

/** Strips blank rows out of every links field, matching the server's tolerance. */
function cleanForSave(draft: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    cleaned[key] =
      key.endsWith('_links') && Array.isArray(value)
        ? withoutBlankLinks(value as ConfigLink[])
        : value;
  }
  return cleaned;
}

export function useAdminConfigurationPage(): AdminConfigurationPageState {
  const sectionsQuery = useAdminConfigSections();
  const sections = useMemo(() => sectionsQuery.data ?? [], [sectionsQuery.data]);

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);

  // The FIRST AVAILABLE section is the default, not simply the first. Opening on
  // a pane that can only display a refusal reads as a broken page, and on this
  // deployment the first section in schema order is one of the unavailable ones.
  const activeSection = useMemo((): AdminConfigSection | undefined => {
    if (selectedId !== undefined) {
      const chosen = sections.find((section) => section.id === selectedId);
      if (chosen !== undefined) return chosen;
    }
    return sections.find((section) => section.unavailable_reason === undefined) ?? sections[0];
  }, [sections, selectedId]);

  const isAvailable =
    activeSection !== undefined && (activeSection.unavailable_reason ?? '') === '';

  const valuesQuery = useAdminConfigValues(activeSection?.id, isAvailable);
  const serverValues = valuesQuery.data;

  const values = useMemo(
    (): Readonly<Record<string, unknown>> => ({ ...serverValues, ...draft }),
    [serverValues, draft],
  );

  const saveMutation = useSaveAdminConfigValues();

  const onSelectSection = useCallback((sectionId: string) => {
    setSelectedId(sectionId);
    // Edits belong to the section they were made in. Carrying them across would
    // send another section's keys, which the server refuses as unknown — an
    // accurate refusal for a request the operator never meant to make.
    setDraft({});
    setSaveError(undefined);
    setSavedAt(undefined);
  }, []);

  const onFieldChange = useCallback((key: string, next: unknown) => {
    setDraft((previous) => ({ ...previous, [key]: next }));
  }, []);

  const onDiscard = useCallback(() => {
    setDraft({});
    setSaveError(undefined);
  }, []);

  const onSave = useCallback(() => {
    if (activeSection === undefined) return;
    setSaveError(undefined);
    saveMutation.mutate(
      { sectionId: activeSection.id, values: cleanForSave(draft) },
      {
        onSuccess: () => {
          setDraft({});
          setSavedAt(Date.now());
        },
        onError: (error: unknown) => {
          setSaveError(configFailureReason(error) ?? 'save');
        },
      },
    );
  }, [activeSection, draft, saveMutation]);

  // A 501 on the VALUES read is the server saying the section is unavailable, so
  // it is reported as the reason rather than as a load failure. It should not
  // normally be reachable — the query is disabled for a section that declared
  // one — and reaching it means the schema and the value endpoint disagree,
  // which the operator is better told than shown as a spinner.
  const valuesError = useMemo((): string | undefined => {
    const error = valuesQuery.error;
    if (error == null) return undefined;
    return configFailureReason(error) ?? 'load';
  }, [valuesQuery.error]);

  return {
    sections,
    isLoadingSections: sectionsQuery.isLoading,
    sectionsError:
      sectionsQuery.error == null
        ? undefined
        : (configFailureReason(sectionsQuery.error) ?? 'load'),
    activeSection,
    onSelectSection,
    unavailableReason:
      activeSection?.unavailable_reason ??
      (configFailureStatus(valuesQuery.error) === 501
        ? configFailureReason(valuesQuery.error)
        : undefined),
    values,
    isLoadingValues: valuesQuery.isLoading && isAvailable,
    valuesError,
    onFieldChange,
    isDirty: Object.keys(draft).length > 0,
    isSaving: saveMutation.isPending,
    onSave,
    onDiscard,
    saveError,
    savedAt,
    onDismissSaved: useCallback(() => {
      setSavedAt(undefined);
    }, []),
    onDismissError: useCallback(() => {
      setSaveError(undefined);
    }, []),
  };
}
