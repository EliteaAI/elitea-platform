import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCredentialWarningModal } from './useCredentialWarningModal';

const CHANGED = {
  editToolDetail: { settings: { cred: { elitea_title: 'b', private: true } } },
  originalDetails: { settings: { cred: { elitea_title: 'a', private: false } } },
};

describe('useCredentialWarningModal', () => {
  it('checkBeforeSave proceeds immediately when creating', () => {
    const { result } = renderHook(() => useCredentialWarningModal({ isCreating: true, isTeamProject: true, ...CHANGED }));
    const saveAction = vi.fn();
    let proceeded = false;
    act(() => {
      proceeded = result.current.checkBeforeSave(saveAction);
    });
    expect(proceeded).toBe(true);
    expect(result.current.showWarning).toBe(false);
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('checkBeforeSave proceeds immediately outside a team project', () => {
    const { result } = renderHook(() => useCredentialWarningModal({ isTeamProject: false, ...CHANGED }));
    const saveAction = vi.fn();
    let proceeded = false;
    act(() => {
      proceeded = result.current.checkBeforeSave(saveAction);
    });
    expect(proceeded).toBe(true);
  });

  it('checkBeforeSave proceeds immediately when nothing changed', () => {
    const unchanged = {
      editToolDetail: { settings: { cred: { elitea_title: 'a', private: false } } },
      originalDetails: { settings: { cred: { elitea_title: 'a', private: false } } },
    };
    const { result } = renderHook(() => useCredentialWarningModal({ isTeamProject: true, ...unchanged }));
    const saveAction = vi.fn();
    let proceeded = false;
    act(() => {
      proceeded = result.current.checkBeforeSave(saveAction);
    });
    expect(proceeded).toBe(true);
  });

  it('checkBeforeSave defers and shows the warning on a team-project credential change', () => {
    const { result } = renderHook(() => useCredentialWarningModal({ isTeamProject: true, ...CHANGED }));
    const saveAction = vi.fn();
    let proceeded = true;
    act(() => {
      proceeded = result.current.checkBeforeSave(saveAction);
    });
    expect(proceeded).toBe(false);
    expect(result.current.showWarning).toBe(true);
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('onConfirm runs the pending save and closes the modal', () => {
    const { result } = renderHook(() => useCredentialWarningModal({ isTeamProject: true, ...CHANGED }));
    const saveAction = vi.fn();
    act(() => {
      result.current.checkBeforeSave(saveAction);
    });
    act(() => {
      result.current.onConfirm();
    });
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(result.current.showWarning).toBe(false);
  });

  it('onCancel closes the modal, reverts form fields, and reverts editToolDetail', () => {
    const onRevertFormFields = vi.fn();
    const onSetEditToolDetail = vi.fn();
    const { result } = renderHook(() =>
      useCredentialWarningModal({ isTeamProject: true, ...CHANGED, onRevertFormFields, onSetEditToolDetail }),
    );
    act(() => {
      result.current.checkBeforeSave(vi.fn());
    });
    act(() => {
      result.current.onCancel();
    });
    expect(result.current.showWarning).toBe(false);
    expect(onRevertFormFields).toHaveBeenCalledTimes(1);
    expect(onSetEditToolDetail).toHaveBeenCalledWith({ settings: { cred: { elitea_title: 'a', private: false } } });
  });

  it('onClose closes the modal without running the pending save', () => {
    const { result } = renderHook(() => useCredentialWarningModal({ isTeamProject: true, ...CHANGED }));
    const saveAction = vi.fn();
    act(() => {
      result.current.checkBeforeSave(saveAction);
    });
    act(() => {
      result.current.onClose();
    });
    expect(result.current.showWarning).toBe(false);
    expect(saveAction).not.toHaveBeenCalled();
    act(() => {
      result.current.onConfirm();
    });
    expect(saveAction).not.toHaveBeenCalled();
  });
});
