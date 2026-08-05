import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAttachmentToolChange } from './useAttachmentToolChange.hooks';

describe('useAttachmentToolChange', () => {
  it('refetches when the changed participant matches entity_meta.id', async () => {
    const refetchParticipantDetails = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAttachmentToolChange({
        activeParticipant: { entity_meta: { id: 'p1' } },
        refetchParticipantDetails,
      }),
    );
    await result.current.handleAttachmentToolChange('p1');
    expect(refetchParticipantDetails).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the changed participant does not match', async () => {
    const refetchParticipantDetails = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAttachmentToolChange({
        activeParticipant: { entity_meta: { id: 'p1' } },
        refetchParticipantDetails,
      }),
    );
    await result.current.handleAttachmentToolChange('p2');
    expect(refetchParticipantDetails).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active participant id', async () => {
    const refetchParticipantDetails = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAttachmentToolChange({ activeParticipant: undefined, refetchParticipantDetails }),
    );
    await result.current.handleAttachmentToolChange('p1');
    expect(refetchParticipantDetails).not.toHaveBeenCalled();
  });
});
