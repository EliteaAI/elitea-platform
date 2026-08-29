import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useActiveParticipantSelection } from './useActiveParticipantSelection';

const AGENT_ROW = { id: '101', entity_name: 'application', entity_meta: { id: '12', project_id: '2' } };
const OTHER_ROW = { id: '202', entity_name: 'application', entity_meta: { id: '9', project_id: '2' } };

describe('useActiveParticipantSelection', () => {
  it('forwards every pick to the host', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useActiveParticipantSelection({ onChange }, [AGENT_ROW]));

    act(() => { result.current.onChangeParticipant(AGENT_ROW); });

    expect(onChange).toHaveBeenCalledWith(AGENT_ROW);
  });

  it("keeps the pick visible after the host's own restore effect clears it", () => {
    // The exact sequence on a new chat: the pick attaches the agent, the page
    // navigates to the conversation it created, and the restore effect there
    // sets `activeParticipant` back to `undefined` because nothing was stored
    // under a route id that did not exist yet.
    const { result } = renderHook(() => useActiveParticipantSelection({ active: undefined }, [AGENT_ROW]));

    expect(result.current.activeParticipant).toBeUndefined();
    act(() => { result.current.onChangeParticipant({ id: '101' }); });

    expect(result.current.activeParticipant).toBe(AGENT_ROW);
  });

  it("lets the host's own active participant win", () => {
    const { result } = renderHook(() => useActiveParticipantSelection({ active: OTHER_ROW }, [AGENT_ROW, OTHER_ROW]));

    act(() => { result.current.onChangeParticipant({ id: '101' }); });

    expect(result.current.activeParticipant).toBe(OTHER_ROW);
  });

  it('drops the remembered pick once that participant is no longer on the conversation', () => {
    const { result, rerender } = renderHook(
      ({ participants }: { participants: readonly unknown[] }) => useActiveParticipantSelection({ active: undefined }, participants),
      { initialProps: { participants: [AGENT_ROW] as readonly unknown[] } },
    );

    act(() => { result.current.onChangeParticipant({ id: '101' }); });
    expect(result.current.activeParticipant).toBe(AGENT_ROW);

    rerender({ participants: [OTHER_ROW] });

    expect(result.current.activeParticipant).toBeUndefined();
  });

  it('remembers a deselection rather than resurrecting the previous pick', () => {
    const { result } = renderHook(() => useActiveParticipantSelection({ active: undefined }, [AGENT_ROW]));

    act(() => { result.current.onChangeParticipant({ id: '101' }); });
    act(() => { result.current.onChangeParticipant(undefined); });

    expect(result.current.activeParticipant).toBeUndefined();
  });
});
