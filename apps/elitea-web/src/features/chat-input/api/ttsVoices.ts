/**
 * `GET /configurations/tts_voices/{projectId}?model_name=...` — hand-rolled
 * fetcher for `useReadAloud`/`VoicePersonalizationSection`'s voice-list
 * lookup (`apps/elitea-ui/src/api/configurations.js`'s `getTtsVoices`).
 *
 * Near-duplicate, disclosed (same rationale as this slice's sibling
 * `./models.ts`, ASR unit's own doc comment there): `features/credentials/
 * api/configurationConnections.ts`'s `getTtsVoices` covers the exact same
 * route already, but `no-sideways-features` forbids importing a
 * `features/credentials` internal from `features/chat-input`. This unit's
 * report asks for `features/chat-input` to be added to the existing
 * `credentials.getTtsVoices` manifest entry's `usedBy` array rather than a
 * new entry — same route, same shape. Typed here (as `{voices:
 * TtsVoice[]}`) rather than left `unknown` (the credentials copy's own
 * responseSchema) because this module's own callers actually read
 * `.voices` — see `useReadAloud.hooks.ts`/`VoiceConfigControls.tsx`.
 */
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

/** One server-side TTS voice — `id`/`name` are what `VoiceConfigControls` renders as a `SingleSelect` option. */
export interface TtsVoice {
  readonly id?: string;
  readonly name: string;
  readonly [key: string]: unknown;
}

export interface TtsVoicesResult {
  readonly voices: readonly TtsVoice[];
}

interface TtsVoicesWire {
  readonly voices?: readonly TtsVoice[];
}

export async function getTtsVoices(projectId: string | number, modelName: string | undefined, signal?: AbortSignal): Promise<TtsVoicesResult> {
  const search = new URLSearchParams();
  if (modelName !== undefined) search.append('model_name', modelName);
  const response = await fetchData<TtsVoicesWire>(`/configurations/tts_voices/${projectId}?${search.toString()}`, signal ? { signal } : {});
  return { voices: response.voices ?? [] };
}

export interface UseTtsVoicesParams {
  readonly projectId: string | number | undefined;
  readonly modelName: string | undefined;
}

export function useTtsVoices(params: UseTtsVoicesParams, options: { enabled?: boolean } = {}): UseQueryResult<TtsVoicesResult> {
  const { projectId, modelName } = params;
  return useQuery({
    queryKey: ['chat-input', 'tts-voices', projectId, modelName],
    queryFn: ({ signal }) => getTtsVoices(projectId as string | number, modelName, signal),
    enabled: (options.enabled ?? true) && projectId !== undefined,
  });
}
