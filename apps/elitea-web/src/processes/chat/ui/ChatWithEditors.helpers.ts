import type { ApplicationCreatedResponse } from '@/shared/api/generated/model';

/**
 * Pure, non-hook helpers for `ChatWithEditors.tsx` — split out purely to
 * keep that file focused on composition/JSX.
 */

/** Builds a `{[key]: value}` fragment only when `value` is defined — the same `exactOptionalPropertyTypes`-safe idiom `../lib/editorParticipantAdapters.ts`'s own `optField` already establishes (duplicated locally rather than imported: a one-line generic, and importing it would be a deep cross-file reach into a sibling for a single helper). */
function optField<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return (value !== undefined ? { [key]: value } : {}) as { readonly [P in K]?: V };
}

/**
 * `AgentEditor`'s/`PipelineEditor`'s `onAgentCreated`/`onPipelineCreated`
 * both hand back a real, generated `ApplicationCreatedResponse` — but its
 * zod-derived optional fields (e.g. `version_details?: ApplicationVersionDetail
 * | undefined`) are typed with an EXPLICIT `| undefined`, while
 * `useAgentCreation`'s/`usePipelineCreation`'s own `CreatedAgentResult`/
 * `CreatedPipelineResult` (`features/agents/model/useAgentCreation.ts`/
 * `features/pipelines/model/usePipelineCreation.ts`) declare their optional
 * fields WITHOUT it — two different (if structurally near-identical)
 * shapes that `exactOptionalPropertyTypes` treats as genuinely
 * incompatible (a source field allowed to be explicitly `undefined` cannot
 * satisfy a target field that promises "present means real value").
 * `optField` above rebuilds a clean, conditionally-spread object that
 * satisfies the stricter (unexported, but still real) target shape.
 */
export function toCreatedResult(response: ApplicationCreatedResponse): {
  readonly id: string;
  readonly name: string;
  readonly version_details?: { readonly id: string; readonly variables?: readonly unknown[] };
} {
  const versionDetails = response.version_details;
  return {
    id: response.id,
    name: response.name,
    ...optField(
      'version_details',
      versionDetails ? { id: versionDetails.id, ...optField('variables', versionDetails.variables) } : undefined,
    ),
  };
}
