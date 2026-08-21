/**
 * useDefaultModelSaving — saves a section's default model and keeps the
 * message when a save fails.
 *
 * DEFECT this replaces: `useSetProjectDefaultModelMutation` reported a
 * failure only through `console.error`. The select is controlled from query
 * data with no optimistic update, so the value snapped back to the old
 * default and the user saw a silent revert with no reason.
 *
 * The errors are held per section, not per hook. One mutation serves eight
 * selects, so `mutation.isError` alone would flag every section when one
 * failed.
 */
import { useCallback, useState } from 'react';

import {
  modelConfigurationErrorMessage,
  useSetProjectDefaultModelMutation,
} from '../../api/ai-configuration/api';

/** Parses a `<<>>`-joined Select value back into `name`/`targetProjectId`,
 * mirroring old app's `const [modelName, project_id] = value.split('<<>>')`
 * (`ModelConfiguration.jsx:211`). Returns `null` for an empty/unset value. */
function parseDefaultModelValue(value: string): { name: string; targetProjectId: string } | null {
  const [name, targetProjectId] = value.split('<<>>');
  if (!name) return null;
  return { name, targetProjectId: targetProjectId ?? '' };
}

export interface DefaultModelSaving {
  /** Section name → the message from that section's last failed save. */
  readonly saveErrors: Record<string, string>;
  readonly handleDefaultChange: (section: string) => (value: string) => void;
}

export function useDefaultModelSaving(projectId: string): DefaultModelSaving {
  const setDefaultModel = useSetProjectDefaultModelMutation(projectId);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const clearSectionError = useCallback((section: string) => {
    setSaveErrors((previous) => {
      if (previous[section] === undefined) return previous;
      const next = { ...previous };
      delete next[section];
      return next;
    });
  }, []);

  const handleDefaultChange = useCallback(
    (section: string) => (value: string) => {
      const parsed = parseDefaultModelValue(value);
      if (!parsed) return;
      clearSectionError(section);
      setDefaultModel.mutate(
        { ...parsed, section },
        {
          onError: (error) => {
            setSaveErrors((previous) => ({ ...previous, [section]: modelConfigurationErrorMessage(error) }));
          },
          onSuccess: () => clearSectionError(section),
        },
      );
    },
    [setDefaultModel, clearSectionError],
  );

  return { saveErrors, handleDefaultChange };
}
