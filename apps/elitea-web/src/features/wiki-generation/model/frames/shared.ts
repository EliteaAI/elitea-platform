/**
 * Shared helpers for the per-family frame handlers.
 *
 * The reducer is split per frame FAMILY rather than being one switch, which is
 * how the chat stream's own ~15 `chatStream*Frames.ts` modules are organised.
 * Each family is a function of (state, frame) with no knowledge of the others,
 * so a change to how tool frames are read cannot alter how error frames are.
 */
import type { GenerationState, ThinkingStep } from '../types';

/** Append one thinking step, advancing the id counter. */
export function addStep(
  state: GenerationState,
  message: string,
  type: string,
  metadata: Record<string, unknown> | undefined,
  now: () => number,
): { steps: readonly ThinkingStep[]; counter: number } {
  const counter = state.stepCounter + 1;
  const step: ThinkingStep = {
    id: `step-${String(counter)}`,
    message,
    timestamp: now(),
    type,
    metadata,
  };
  return { steps: [...state.thinkingSteps, step], counter };
}

/** A plain object, or undefined. Arrays are not records here. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The first string among `names` on `source`. */
export function firstString(
  source: Record<string, unknown> | undefined,
  ...names: readonly string[]
): string | undefined {
  if (!source) return undefined;
  for (const name of names) {
    const value = source[name];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}
