import * as yup from 'yup';

import { DEFAULT_CONTEXT_STRATEGY, VALIDATION_LIMITS } from './contextBudget/constants';

export const PROFILE_INITIAL_VALUES = {
  persona: 'generic',
  default_instructions: '',
  context_enabled: DEFAULT_CONTEXT_STRATEGY.ENABLED,
  max_context_tokens: DEFAULT_CONTEXT_STRATEGY.MAX_CONTEXT_TOKENS,
  preserve_recent_messages: DEFAULT_CONTEXT_STRATEGY.PRESERVE_RECENT_MESSAGES,
  enable_summarization: DEFAULT_CONTEXT_STRATEGY.ENABLE_SUMMARIZATION,
  summary_llm_settings: {
    instructions: '',
    model_name: '',
    model_project_id: null as string | null,
    max_tokens: 4096,
  },
};

interface SocialAuthorData {
  name?: string;
  email?: string;
  avatar?: string;
  description?: string;
  personalization?: Record<string, unknown>;
  default_context_management?: Record<string, unknown>;
  default_summarization?: Record<string, unknown>;
}

export function serializeProfileFormData(
  authorData: SocialAuthorData | undefined,
  defaultModel: { name: string; project_id: string; default?: boolean; display_name?: string } | null,
) {
  if (!authorData) {
    return {
      ...PROFILE_INITIAL_VALUES,
      persona: '',
      summary_llm_settings: {
        ...PROFILE_INITIAL_VALUES.summary_llm_settings,
        model_name: defaultModel?.name || '',
        model_project_id: defaultModel?.project_id ?? null,
      },
    };
  }

  const p = authorData.personalization || {};
  const cm = authorData.default_context_management || {};
  const s = authorData.default_summarization || {};

  return {
    persona: ((p.persona as string) || 'generic') as string,
    default_instructions: ((p.default_instructions as string) || '') as string,
    context_enabled: (cm.enabled ?? DEFAULT_CONTEXT_STRATEGY.ENABLED) as boolean,
    max_context_tokens: (cm.max_context_tokens ?? DEFAULT_CONTEXT_STRATEGY.MAX_CONTEXT_TOKENS) as number,
    preserve_recent_messages: (cm.preserve_recent_messages ?? DEFAULT_CONTEXT_STRATEGY.PRESERVE_RECENT_MESSAGES) as number,
    enable_summarization: (s.enable_summarization ?? DEFAULT_CONTEXT_STRATEGY.ENABLE_SUMMARIZATION) as boolean,
    summary_llm_settings: {
      instructions: ((s.summary_instructions as string) || '') as string,
      model_name: ((s.summary_model_name as string) || defaultModel?.name || '') as string,
      model_project_id: ((s.summary_model_project_id as string) ?? defaultModel?.project_id ?? null) as string | null,
      max_tokens: ((s.target_summary_tokens as number) ?? 4096) as number,
    },
  };
}

export function deserializeProfileFormData(formValues: Record<string, unknown>): Record<string, unknown> {
  const s = formValues.summary_llm_settings as Record<string, unknown> | undefined;
  return {
    personalization: {
      persona: formValues.persona,
      default_instructions: formValues.default_instructions,
    },
    default_context_management: {
      enabled: formValues.context_enabled,
      max_context_tokens: formValues.max_context_tokens,
      preserve_recent_messages: formValues.preserve_recent_messages,
    },
    default_summarization: {
      enable_summarization: formValues.enable_summarization,
      summary_instructions: s?.instructions,
      summary_model_name: s?.model_name,
      summary_model_project_id: s?.model_project_id,
      target_summary_tokens: s?.max_tokens,
    },
  };
}

export function createContextStrategyFormData(formikValues: Record<string, unknown>): Record<string, unknown> {
  const s = formikValues.summary_llm_settings as Record<string, unknown> | undefined;
  return {
    enabled: formikValues.context_enabled,
    max_context_tokens: formikValues.max_context_tokens,
    preserve_recent_messages: formikValues.preserve_recent_messages,
    enable_summarization: formikValues.enable_summarization,
    summary_llm_settings: s,
  };
}

export function parseModelValue(value: string): { modelName: string; modelProjectId: number | null } {
  const parts = value.split('$$$');
  return {
    modelName: parts[0] ?? '',
    modelProjectId: parts[1] ? Number(parts[1]) : null,
  };
}

/** Initial form values for the profile settings form. */
export type ProfileFormValues = typeof PROFILE_INITIAL_VALUES;

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
export const ProfileValidationSchema: yup.ObjectSchema<ProfileFormValues> =
  yup.object({
    persona: yup.string().required('Please select a personality'),
    default_instructions: yup.string().notRequired(),
    context_enabled: yup.boolean().notRequired(),
    max_context_tokens: yup
      .number()
      .typeError('Please enter a valid number')
      .integer('Must be a whole number'),
    preserve_recent_messages: yup
      .number()
      .typeError('Please enter a valid number')
      .integer('Must be a whole number'),
    enable_summarization: yup.boolean().notRequired(),
    summary_llm_settings: yup.object({
      instructions: yup.string(),
      model_name: yup.string(),
      model_project_id: yup.number().nullable(),
      max_tokens: yup
        .number()
        .typeError('Please enter a valid number')
        .integer('Must be a whole number')
        .required('This field is required')
        .min(
          VALIDATION_LIMITS.MAX_TOKENS.MIN,
          `Target tokens must be at least ${VALIDATION_LIMITS.MAX_TOKENS.MIN}`,
        )
        .max(
          VALIDATION_LIMITS.MAX_TOKENS.MAX,
          `Target tokens cannot exceed ${VALIDATION_LIMITS.MAX_TOKENS.MAX.toLocaleString()}`,
        ),
    }),
  }) as any;
