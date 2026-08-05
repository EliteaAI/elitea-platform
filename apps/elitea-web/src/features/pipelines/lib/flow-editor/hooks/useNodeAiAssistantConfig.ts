/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * hooks/useNodeAiAssistantConfig.hooks.js` (13 lines, unit A2d).
 *
 * DISCLOSED REDESIGN: the baseline pulls `formikValues.version_details.
 * llm_settings` from ambient `useFormikContext()`. This app has no Formik
 * dependency (react-hook-form + zod, `package.json`) -- the established
 * convention for this exact situation (`features/mcps/ui/
 * McpAuthStatusBadge.tsx`'s own "DEVIATION FROM BASELINE" doc comment,
 * `features/agents/model/useCreateApplication.ts`'s "DISCLOSED REDESIGN")
 * is a plain typed parameter instead of ambient form context. The caller
 * (a pipeline-editor form component built on react-hook-form, out of this
 * pure-lib sub-unit's scope) reads its own `version_details.llm_settings`
 * field value (e.g. via `useWatch`) and passes it in, like any other
 * controlled value.
 */
export function useNodeAiAssistantConfig(llmSettings: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  return llmSettings ?? null;
}
