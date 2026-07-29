import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useEditorStateStore } from '@/shared/lib/editorState';

import { isActiveParticipantBeingEdited, useIsActiveParticipantBeingEdited } from './useIsActiveParticipantBeingEdited';
import type { Participant } from './types';

const PARTICIPANT: Participant = { id: 'p1', entityName: 'application', entityMeta: { id: 'entity-1' } };

describe('isActiveParticipantBeingEdited (pure core)', () => {
  it('is false when neither isEditingAgent nor isEditingPipeline is set', () => {
    expect(isActiveParticipantBeingEdited(PARTICIPANT, 'entity-1', false, false)).toBe(false);
  });

  it('is false when there is no edited id or no active participant', () => {
    expect(isActiveParticipantBeingEdited(PARTICIPANT, undefined, true, false)).toBe(false);
    expect(isActiveParticipantBeingEdited(undefined, 'entity-1', true, false)).toBe(false);
  });

  it('matches on participant.id', () => {
    expect(isActiveParticipantBeingEdited(PARTICIPANT, 'p1', true, false)).toBe(true);
  });

  it('matches on entityMeta.id', () => {
    expect(isActiveParticipantBeingEdited(PARTICIPANT, 'entity-1', true, false)).toBe(true);
  });

  it('matches on meta.id', () => {
    const withMeta: Participant = { id: 'p1', entityName: 'application', meta: { id: 'meta-1' } };
    expect(isActiveParticipantBeingEdited(withMeta, 'meta-1', false, true)).toBe(true);
  });

  it('matches on entityId', () => {
    const withEntityId: Participant = { id: 'p1', entityName: 'application', entityId: 'legacy-1' };
    expect(isActiveParticipantBeingEdited(withEntityId, 'legacy-1', true, false)).toBe(true);
  });

  it('is false when no id field matches', () => {
    expect(isActiveParticipantBeingEdited(PARTICIPANT, 'someone-else', true, false)).toBe(false);
  });
});

describe('useIsActiveParticipantBeingEdited (hook wrapper)', () => {
  afterEach(() => {
    useEditorStateStore.setState({ isEditingAgent: false, isEditingPipeline: false, isAnyEditorOpen: false });
  });

  it('reads isEditingAgent/isEditingPipeline off the shared editor-state store', () => {
    const { result, rerender } = renderHook(() => useIsActiveParticipantBeingEdited(PARTICIPANT, 'entity-1'));
    expect(result.current).toBe(false);

    useEditorStateStore.setState({ isEditingAgent: true });
    rerender();
    expect(result.current).toBe(true);
  });
});
