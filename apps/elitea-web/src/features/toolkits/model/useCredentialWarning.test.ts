import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCredentialWarning } from './useCredentialWarning.hooks';

const CHANGED_CURRENT = { settings: { url: { elitea_title: 'New', private: true } } };
const ORIGINAL = { settings: { url: { elitea_title: 'Shared', private: false } } };

describe('useCredentialWarning', () => {
  it('checkBeforeSave proceeds immediately (returns true) when creating, even with a credential change', () => {
    const revertRef = { current: undefined };
    const { result } = renderHook(() =>
      useCredentialWarning({ isCreating: true, isTeamProject: true, editToolDetail: CHANGED_CURRENT, originalDetails: ORIGINAL, revertCredentialsRef: revertRef }),
    );
    const saveAction = vi.fn();
    let proceeded = false;
    act(() => {
      proceeded = result.current.checkBeforeSave(saveAction);
    });
    expect(proceeded).toBe(true);
    expect(result.current.showWarning).toBe(false);
  });

  it('checkBeforeSave proceeds immediately when not a team project', () => {
    const revertRef = { current: undefined };
    const { result } = renderHook(() =>
      useCredentialWarning({ isTeamProject: false, editToolDetail: CHANGED_CURRENT, originalDetails: ORIGINAL, revertCredentialsRef: revertRef }),
    );
    let proceeded = false;
    act(() => {
      proceeded = result.current.checkBeforeSave(vi.fn());
    });
    expect(proceeded).toBe(true);
  });

  it('checkBeforeSave blocks and shows the warning when editing a team project with a changed credential', () => {
    const revertRef = { current: undefined };
    const { result } = renderHook(() =>
      useCredentialWarning({ isTeamProject: true, editToolDetail: CHANGED_CURRENT, originalDetails: ORIGINAL, revertCredentialsRef: revertRef }),
    );
    let proceeded = true;
    act(() => {
      proceeded = result.current.checkBeforeSave(vi.fn());
    });
    expect(proceeded).toBe(false);
    expect(result.current.showWarning).toBe(true);
  });

  it('onConfirm runs the pending save action and hides the warning', () => {
    const revertRef = { current: undefined };
    const { result } = renderHook(() =>
      useCredentialWarning({ isTeamProject: true, editToolDetail: CHANGED_CURRENT, originalDetails: ORIGINAL, revertCredentialsRef: revertRef }),
    );
    const saveAction = vi.fn();
    act(() => {
      result.current.checkBeforeSave(saveAction);
    });
    act(() => {
      result.current.handlers.onConfirm();
    });
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(result.current.showWarning).toBe(false);
  });

  it('onCancel calls revertCredentialsRef.current and reverts editToolDetail via setEditToolDetail', () => {
    const revert = vi.fn();
    const revertRef = { current: revert };
    const setEditToolDetail = vi.fn();
    const { result } = renderHook(() =>
      useCredentialWarning({
        isTeamProject: true,
        editToolDetail: CHANGED_CURRENT,
        originalDetails: ORIGINAL,
        revertCredentialsRef: revertRef,
        setEditToolDetail,
      }),
    );
    act(() => {
      result.current.checkBeforeSave(vi.fn());
    });
    act(() => {
      result.current.handlers.onCancel();
    });
    expect(revert).toHaveBeenCalledTimes(1);
    expect(setEditToolDetail).toHaveBeenCalledWith(expect.objectContaining({ settings: { url: { elitea_title: 'Shared', private: false } } }));
    expect(result.current.showWarning).toBe(false);
  });

  it('onClose hides the warning without running the pending action', () => {
    const revertRef = { current: undefined };
    const { result } = renderHook(() =>
      useCredentialWarning({ isTeamProject: true, editToolDetail: CHANGED_CURRENT, originalDetails: ORIGINAL, revertCredentialsRef: revertRef }),
    );
    const saveAction = vi.fn();
    act(() => {
      result.current.checkBeforeSave(saveAction);
    });
    act(() => {
      result.current.handlers.onClose();
    });
    expect(saveAction).not.toHaveBeenCalled();
    expect(result.current.showWarning).toBe(false);
  });
});
