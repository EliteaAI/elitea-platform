import type { ChangeEvent, FocusEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { MAX_NAME_LENGTH } from '@/shared/lib/limits';
import { PROMPT_PAYLOAD_KEY } from '@/shared/lib/prompt-payload';

import { useFieldFocus } from '../lib/useFieldFocus';
import type { AgentDraftValues, AgentFieldChange, AgentVariable } from './types';

/**
 * Split out of `ui/CreateAgentForm.tsx` into `model/` purely to keep that
 * file under the oxlint `max-lines` budget (400) — same content, moved, not
 * rewritten. Owns every piece of local state + the Formik-
 * `setFieldValue`-replacement callbacks `CreateAgentForm` needs (see
 * `../model/types.ts`'s own "DISCLOSED REDESIGN" doc comment for why these
 * are plain callbacks instead of ambient form context). A custom hook's
 * complexity is counted separately from the component that calls it — the
 * same effect `ui/CreateAgentForm.tsx`'s own `GeneralFields` split achieves
 * for JSX, applied here to state/handlers instead.
 */
export interface CreateAgentFormState {
  readonly name: string;
  readonly description: string;
  readonly nameAtMax: boolean;
  readonly nameFocused: boolean;
  readonly descriptionFocused: boolean;
  readonly variables: readonly AgentVariable[];
  readonly onChangeName: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onNameFocus: () => void;
  readonly onNameBlur: () => void;
  readonly onDescriptionChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onDescriptionFocus: () => void;
  readonly onDescriptionBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onChangeVariable: (label: string, newValue: string) => void;
  readonly onInstructionsChange: (value: string) => void;
  readonly onWelcomeMessageChange: (value: string) => void;
  readonly onStepLimitChange: (value: number | undefined) => void;
  /** #307 — replaces the baseline's `setFieldValue('version_details.conversation_starters', ...)` inside `ConversationStarters.jsx` itself. */
  readonly onConversationStartersChange: (next: readonly string[]) => void;
}

export function useCreateAgentFormState(values: AgentDraftValues, onFieldChange: AgentFieldChange): CreateAgentFormState {
  const [name, setName] = useState(values.name ?? '');
  const { toggleFieldFocus, isFocused } = useFieldFocus();
  const versionDetails = values.version_details;
  // Memoized (not `?? []` inline): a fresh `[]` reference every render would
  // defeat `onChangeVariable`'s own memoization below (react-hooks/exhaustive-deps).
  const variables = useMemo(() => versionDetails?.variables ?? [], [versionDetails?.variables]);

  // Sync local state when the caller's value changes externally (e.g. on form reset/discard).
  useEffect(() => {
    if ((values.name ?? '') !== name) {
      setName(values.name ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync only when the caller's own value changes, matching the baseline's identical dependency list.
  }, [values.name]);

  const onChangeVariable = useCallback(
    (label: string, newValue: string) => {
      onFieldChange(
        'version_details.variables',
        variables.map((variable: AgentVariable) => (variable.name === label ? { ...variable, value: newValue } : variable)),
      );
    },
    [onFieldChange, variables],
  );

  const onChangeName = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setName(event.target.value);
      onFieldChange('name', event.target.value);
    },
    [onFieldChange],
  );

  const onNameFocus = useCallback(() => toggleFieldFocus(PROMPT_PAYLOAD_KEY.name), [toggleFieldFocus]);

  const onNameBlur = useCallback(() => {
    const trimmedName = name.trim();
    setName(trimmedName);
    onFieldChange('name', trimmedName);
    toggleFieldFocus(null);
  }, [name, onFieldChange, toggleFieldFocus]);

  const onDescriptionChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onFieldChange('description', event.target.value);
    },
    [onFieldChange],
  );

  const onDescriptionFocus = useCallback(() => toggleFieldFocus(PROMPT_PAYLOAD_KEY.description), [toggleFieldFocus]);

  const onDescriptionBlur = useCallback(
    (_event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      toggleFieldFocus(null);
    },
    [toggleFieldFocus],
  );

  const onInstructionsChange = useCallback(
    (value: string) => onFieldChange('version_details.instructions', value),
    [onFieldChange],
  );

  const onWelcomeMessageChange = useCallback(
    (value: string) => onFieldChange('version_details.welcome_message', value),
    [onFieldChange],
  );

  const onStepLimitChange = useCallback(
    (value: number | undefined) => onFieldChange('version_details.meta.step_limit', value),
    [onFieldChange],
  );

  const onConversationStartersChange = useCallback(
    (next: readonly string[]) => onFieldChange('version_details.conversation_starters', next),
    [onFieldChange],
  );

  return {
    name,
    description: values.description ?? '',
    nameAtMax: name.length === MAX_NAME_LENGTH,
    nameFocused: isFocused(PROMPT_PAYLOAD_KEY.name),
    descriptionFocused: isFocused(PROMPT_PAYLOAD_KEY.description),
    variables,
    onChangeName,
    onNameFocus,
    onNameBlur,
    onDescriptionChange,
    onDescriptionFocus,
    onDescriptionBlur,
    onChangeVariable,
    onInstructionsChange,
    onWelcomeMessageChange,
    onStepLimitChange,
    onConversationStartersChange,
  };
}
