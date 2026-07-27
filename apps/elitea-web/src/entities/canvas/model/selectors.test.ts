import { describe, expect, it } from 'vitest';

import { isCanvasReadOnlyForUser, isCodeCanvas, realCanvasEditors } from './selectors';
import type { Canvas, CanvasEditorPresence } from './types';

const editor = (userName: string): CanvasEditorPresence => ({ userName });

describe('realCanvasEditors', () => {
  it('filters out the synthetic admin and system usernames', () => {
    const editors = [editor('admin@centry.user'), editor('alice'), editor('system@centry.user')];
    expect(realCanvasEditors(editors).map((e) => e.userName)).toEqual(['alice']);
  });

  it('returns an empty array when only synthetic users are present', () => {
    expect(realCanvasEditors([editor('admin@centry.user'), editor('system@centry.user')])).toEqual([]);
  });

  it('leaves a list of only real editors untouched', () => {
    const editors = [editor('alice'), editor('bob')];
    expect(realCanvasEditors(editors)).toEqual(editors);
  });
});

describe('isCanvasReadOnlyForUser', () => {
  it('is editable by anyone when no real editors are present', () => {
    expect(isCanvasReadOnlyForUser([editor('admin@centry.user')], 'alice')).toBe(false);
  });

  it('is editable by anyone when the editors list is empty', () => {
    expect(isCanvasReadOnlyForUser([], 'alice')).toBe(false);
  });

  it('is NOT read-only for a user who is among the real editors', () => {
    expect(isCanvasReadOnlyForUser([editor('alice'), editor('bob')], 'alice')).toBe(false);
  });

  it('IS read-only for a user who is not among the real editors', () => {
    expect(isCanvasReadOnlyForUser([editor('alice')], 'bob')).toBe(true);
  });
});

describe('isCodeCanvas', () => {
  it('is true only when canvasType is exactly "code"', () => {
    const canvas = (canvasType?: string): Canvas => ({ uuid: '1', ...(canvasType !== undefined ? { canvasType } : {}) });
    expect(isCodeCanvas(canvas('code'))).toBe(true);
    expect(isCodeCanvas(canvas('markdown'))).toBe(false);
    expect(isCodeCanvas(canvas())).toBe(false);
  });
});
