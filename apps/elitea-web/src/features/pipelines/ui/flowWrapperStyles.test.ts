import { describe, expect, it } from 'vitest';

import { PipelineEditorMode } from '@/shared/lib/enums';

import { computeFlowWrapperSx } from './flowWrapperStyles';

const stubTheme = { vars: { palette: { border: { lines: 'mock-border-color' } }, shape: { radiusMd: '0.5rem' } } };

describe('computeFlowWrapperSx', () => {
  it('display is undefined (visible) in Flow mode', () => {
    const sx = computeFlowWrapperSx(false, false, PipelineEditorMode.Flow) as Record<string, unknown>;
    expect(sx.display).toBeUndefined();
  });

  it('display is "none" in Yaml mode', () => {
    const sx = computeFlowWrapperSx(false, false, PipelineEditorMode.Yaml) as Record<string, unknown>;
    expect(sx.display).toBe('none');
  });

  it('minHeight is set on a small window and undefined otherwise', () => {
    const small = computeFlowWrapperSx(true, false, PipelineEditorMode.Flow) as Record<string, unknown>;
    const large = computeFlowWrapperSx(false, false, PipelineEditorMode.Flow) as Record<string, unknown>;
    expect(small.minHeight).toBe('calc(100vh - 220px)');
    expect(large.minHeight).toBeUndefined();
  });

  it('noBorder=false renders a real border and no borderTop, with a token-driven radius', () => {
    const sx = computeFlowWrapperSx(false, false, PipelineEditorMode.Flow) as Record<string, unknown>;
    expect((sx.border as (t: typeof stubTheme) => string)(stubTheme)).toBe('0.0625rem solid mock-border-color');
    expect((sx.borderTop as (t: typeof stubTheme) => string)(stubTheme)).toBeUndefined();
    expect((sx.borderRadius as (t: typeof stubTheme) => string)(stubTheme)).toBe('0.5rem');
  });

  it('noBorder=true drops the border, moves it to borderTop, and flattens the radius', () => {
    const sx = computeFlowWrapperSx(false, true, PipelineEditorMode.Flow) as Record<string, unknown>;
    expect((sx.border as (t: typeof stubTheme) => string)(stubTheme)).toBe('none');
    expect((sx.borderTop as (t: typeof stubTheme) => string)(stubTheme)).toBe('0.0625rem solid mock-border-color');
    expect(sx.borderRadius).toBe('0');
  });
});
