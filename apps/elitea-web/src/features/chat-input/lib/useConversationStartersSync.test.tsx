import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormProvider, useForm } from 'react-hook-form';

import type { AgentEditorProps } from '@/features/agents';

import { useConversationStartersSync } from './useConversationStartersSync';

interface FormValues {
  readonly version_details?: {
    readonly conversation_starters?: readonly unknown[] | undefined;
  };
}

function renderWithFormProvider(onChange: ((starters: readonly string[]) => void) | undefined, defaultStarters?: readonly unknown[]) {
  let setStarters: ((starters: readonly unknown[]) => void) | undefined;

  function Harness() {
    const form = useForm<FormValues>({
      defaultValues: { version_details: { conversation_starters: defaultStarters } },
    });
    setStarters = (starters: readonly unknown[]) => {
      form.setValue('version_details.conversation_starters', starters);
    };
    return (
      <FormProvider {...form}>
        <Consumer />
      </FormProvider>
    );
  }

  function Consumer() {
    useConversationStartersSync(onChange);
    return null;
  }

  renderHook(() => null, { wrapper: Harness });
  return {
    setStarters: (starters: readonly unknown[]) => {
      act(() => setStarters?.(starters));
    },
  };
}

describe('useConversationStartersSync', () => {
  it('calls onChange with the live form value, stringified, on mount', () => {
    const onChange = vi.fn();
    renderWithFormProvider(onChange, ['Hi there', 'How can I help?']);

    expect(onChange).toHaveBeenCalledWith(['Hi there', 'How can I help?']);
  });

  it('calls onChange again whenever the live value changes', () => {
    const onChange = vi.fn();
    const { setStarters } = renderWithFormProvider(onChange, []);
    onChange.mockClear();

    setStarters(['New starter']);

    expect(onChange).toHaveBeenCalledWith(['New starter']);
  });

  it('normalizes non-string/null/undefined entries via conversationStarterToString', () => {
    const onChange = vi.fn();
    const { setStarters } = renderWithFormProvider(onChange, []);
    onChange.mockClear();

    setStarters([42, null, undefined, 'ok']);

    expect(onChange).toHaveBeenCalledWith(['42', '', '', 'ok']);
  });

  it('defaults an unset field to an empty array', () => {
    const onChange = vi.fn();
    renderWithFormProvider(onChange, undefined);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('is safe when onChange is not supplied', () => {
    expect(() => renderWithFormProvider(undefined, ['a'])).not.toThrow();
  });

  it('throws when rendered outside a FormProvider (disclosed composition constraint — see the module doc comment)', () => {
    function Unwrapped() {
      useConversationStartersSync(undefined);
      return null;
    }
    expect(() => renderHook(() => null, { wrapper: Unwrapped })).toThrow();
  });
});

/**
 * Pins `useConversationStartersSync`'s assignability against `AgentEditor`'s
 * real, already-landed DI slot (`features/agents/ui/AgentEditor.tsx`'s
 * `AgentEditorDeps.useConversationStartersSync`) — a compile-time-only
 * check, so a future signature drift in EITHER file fails `tsc --noEmit`
 * (and this test file), not just a hopeful doc comment.
 *
 * `AgentEditorDeps` itself is not exported through `features/agents/index.ts`
 * (deliberately — see that barrel's own doc comment: "a caller assembling
 * the `deps` object types it structurally against `AgentEditor`'s own prop
 * type without needing a separate import"), so this indexes into the
 * exported `AgentEditorProps['deps']` instead of importing the type by
 * name — the same structural-typing move that barrel comment describes.
 *
 * Cross-slice import note: `features/agents` is a sibling `features/*`
 * slice, so this import would violate `no-sideways-features` in production
 * code — but `.dependency-cruiser.cjs`'s `options.exclude` already excludes
 * every `*.test.[jt]sx?` file from the whole dependency graph, the same
 * exemption `processes/chat/model/useRefetchAgentVersionDetailsOnClose.test.ts`
 * already relies on to import `useApplicationsStore` from `@/features/agents`.
 */
describe('useConversationStartersSync / AgentEditor DI slot compatibility', () => {
  it('is assignable to AgentEditorProps["deps"]["useConversationStartersSync"]', () => {
    const slot: NonNullable<AgentEditorProps['deps']['useConversationStartersSync']> = useConversationStartersSync;
    expect(slot).toBe(useConversationStartersSync);
  });
});
