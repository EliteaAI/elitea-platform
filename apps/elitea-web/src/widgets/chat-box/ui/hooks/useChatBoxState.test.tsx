import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useResetRecommendationsOnParticipantChange } from './useChatBoxState';

describe('useChatBoxState participant changes', () => {
  it('resets recommendations once after the active participant changes', () => {
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ participantId }: { participantId: string | undefined }) =>
        useResetRecommendationsOnParticipantChange(participantId, reset),
      { initialProps: { participantId: undefined as string | undefined } },
    );

    rerender({ participantId: 'toolkit-20' });
    rerender({ participantId: 'toolkit-20' });

    expect(reset).toHaveBeenCalledOnce();
  });
});
