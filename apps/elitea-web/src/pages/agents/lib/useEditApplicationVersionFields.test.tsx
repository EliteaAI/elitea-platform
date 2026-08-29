import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ApplicationVersionDetail } from '@/shared/api/generated/model';

import { useEditApplicationVersionFields } from './useEditApplicationVersionFields';

function version(overrides: Record<string, unknown> = {}): ApplicationVersionDetail {
  return {
    id: '7',
    name: 'base',
    instructions: 'Be helpful.',
    llm_settings: { model_name: 'qwen3.5', model_project_id: 17, max_tokens: -1, temperature: 0.6 },
    meta: { step_limit: 25, internal_tools: [] },
    ...overrides,
  } as unknown as ApplicationVersionDetail;
}

const PICKED = { model_name: 'gpt-4o', model_project_id: 3, max_tokens: 4096, temperature: 0.2 };

describe('useEditApplicationVersionFields — llmSettings', () => {
  it('seeds from the version, coercing a stringified model_project_id', () => {
    const { result } = renderHook(() =>
      useEditApplicationVersionFields(version({ llm_settings: { model_name: 'qwen3.5', model_project_id: '17' } })),
    );
    expect(result.current.fields.llmSettings).toEqual({
      model_name: 'qwen3.5',
      model_project_id: 17,
      max_tokens: -1,
    });
    expect(result.current.isDirty).toBe(false);
  });

  it('leaves llmSettings undefined for the empty object a pre-picker version stores', () => {
    const { result } = renderHook(() => useEditApplicationVersionFields(version({ llm_settings: {} })));
    expect(result.current.fields.llmSettings).toBeUndefined();
  });

  it('owns version_details.llm_settings and replaces the whole object', () => {
    const { result } = renderHook(() => useEditApplicationVersionFields(version()));

    let owned = false;
    act(() => {
      owned = result.current.applyFieldChange('version_details.llm_settings', PICKED);
    });

    expect(owned).toBe(true);
    expect(result.current.fields.llmSettings).toEqual(PICKED);
  });

  /*
   * The blocker's whole job. Without a key-by-key comparison in `areEqual`
   * this stays `false` and navigating away discards the picked model in
   * silence — #133's exact failure on the sibling create page.
   */
  it('reports dirty once the model changes, and clean again once saved', () => {
    const { result } = renderHook(() => useEditApplicationVersionFields(version()));
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.applyFieldChange('version_details.llm_settings', PICKED);
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.markSaved();
    });
    expect(result.current.isDirty).toBe(false);
  });

  // Object identity would report dirty forever: the settings dialog hands back
  // a fresh object on every Apply, including one that changed nothing.
  it('stays clean when the same values arrive as a new object', () => {
    const { result } = renderHook(() => useEditApplicationVersionFields(version()));

    act(() => {
      result.current.applyFieldChange('version_details.llm_settings', {
        model_name: 'qwen3.5',
        model_project_id: 17,
        max_tokens: -1,
        temperature: 0.6,
      });
    });

    expect(result.current.isDirty).toBe(false);
  });

  // `useApplicationChat.hooks.ts`'s `onSetLLMSettings` fans a settings object
  // out one key at a time rather than sending it whole.
  it('merges a fanned-out version_details.llm_settings.<key> write onto the held settings', () => {
    const { result } = renderHook(() => useEditApplicationVersionFields(version()));

    let owned = false;
    act(() => {
      owned = result.current.applyFieldChange('version_details.llm_settings.max_tokens', 8192);
    });

    expect(owned).toBe(true);
    expect(result.current.fields.llmSettings).toEqual({
      model_name: 'qwen3.5',
      model_project_id: 17,
      max_tokens: 8192,
      temperature: 0.6,
    });
    expect(result.current.isDirty).toBe(true);
  });

  // temperature and reasoning_effort are mutually exclusive on the wire, so
  // a per-key write of one must REPLACE the other — the XOR inside
  // toAgentLlmSettings keeps the effort on a collision, which used to eat a
  // temperature write on a version that stored an effort.
  it('a fanned-out temperature write replaces a stored reasoning_effort, and the reverse', () => {
    const { result } = renderHook(() =>
      useEditApplicationVersionFields(
        version({ llm_settings: { model_name: 'qwen3.5', model_project_id: 17, reasoning_effort: 'high' } }),
      ),
    );

    act(() => {
      result.current.applyFieldChange('version_details.llm_settings.temperature', 0.4);
    });
    expect(result.current.fields.llmSettings).toMatchObject({ temperature: 0.4 });
    expect(result.current.fields.llmSettings).not.toHaveProperty('reasoning_effort');

    act(() => {
      result.current.applyFieldChange('version_details.llm_settings.reasoning_effort', 'low');
    });
    expect(result.current.fields.llmSettings).toMatchObject({ reasoning_effort: 'low' });
    expect(result.current.fields.llmSettings).not.toHaveProperty('temperature');
  });

  // A partial fan-out that has not yet supplied a model must not leave a
  // half-built profile behind — the worker refuses one without a project id.
  it('keeps llmSettings undefined when a fanned-out key cannot complete a profile', () => {
    const { result } = renderHook(() => useEditApplicationVersionFields(version({ llm_settings: {} })));

    act(() => {
      result.current.applyFieldChange('version_details.llm_settings.temperature', 0.9);
    });

    expect(result.current.fields.llmSettings).toBeUndefined();
  });

  it('still refuses a path it does not own', () => {
    const { result } = renderHook(() => useEditApplicationVersionFields(version()));
    let owned = true;
    act(() => {
      owned = result.current.applyFieldChange('name', 'Renamed');
    });
    expect(owned).toBe(false);
  });

  // The detail query refetches (window focus, a sibling mutation) hand back a
  // fresh object for the SAME version; re-seeding on those would clobber the
  // model the user just picked.
  it('does not clobber a picked model when the same version refetches', () => {
    const { result, rerender } = renderHook(({ active }) => useEditApplicationVersionFields(active), {
      initialProps: { active: version() },
    });

    act(() => {
      result.current.applyFieldChange('version_details.llm_settings', PICKED);
    });
    rerender({ active: version() });

    expect(result.current.fields.llmSettings).toEqual(PICKED);
    expect(result.current.isDirty).toBe(true);
  });

  it('re-seeds when the version identity changes', () => {
    const { result, rerender } = renderHook(({ active }) => useEditApplicationVersionFields(active), {
      initialProps: { active: version() },
    });

    act(() => {
      result.current.applyFieldChange('version_details.llm_settings', PICKED);
    });
    rerender({
      active: version({ id: '8', llm_settings: { model_name: 'claude', model_project_id: 5 } }),
    });

    expect(result.current.fields.llmSettings).toEqual({
      model_name: 'claude',
      model_project_id: 5,
      max_tokens: -1,
    });
    expect(result.current.isDirty).toBe(false);
  });
});
