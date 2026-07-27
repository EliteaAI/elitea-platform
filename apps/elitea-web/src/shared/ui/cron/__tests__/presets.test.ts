import { describe, expect, it, vi } from 'vitest';

import {
  applyPresetSelection,
  CRON_PRESETS,
  CUSTOM_PRESET_VALUE,
  findMatchingPresetId,
  presetLabel,
  resolvePresetExpression,
} from '../presets';

describe('CRON_PRESETS', () => {
  it('includes the old app\'s shared schedule default ("0 0 * * 6") as a named preset', () => {
    const preset = CRON_PRESETS.find((candidate) => candidate.id === 'weekly-saturday');
    expect(preset?.expression).toBe('0 0 * * 6');
  });

  it('has no duplicate ids', () => {
    const ids = CRON_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate expressions', () => {
    const expressions = CRON_PRESETS.map((preset) => preset.expression);
    expect(new Set(expressions).size).toBe(expressions.length);
  });
});

describe('presetLabel', () => {
  it('returns the fallback label (the interim t() shim always returns fallback)', () => {
    const preset = CRON_PRESETS[0];
    if (!preset) throw new Error('CRON_PRESETS must not be empty');
    expect(presetLabel(preset)).toBe(preset.fallback);
  });
});

describe('findMatchingPresetId', () => {
  it('matches the exact expression of a known preset', () => {
    expect(findMatchingPresetId('0 0 * * 6')).toBe('weekly-saturday');
    expect(findMatchingPresetId('* * * * *')).toBe('every-minute');
  });

  it('matches after canonicalising a redundant list to its single value', () => {
    // dayOfMonth "1,1" dedupes to "1" on parse -> serialize, so this is
    // textually different from the 'monthly' preset's own expression string
    // but canonicalises to the same one — exercising the normalisation this
    // function exists for.
    expect(findMatchingPresetId('0 0 1,1 * *')).toBe('monthly');
  });

  it('returns null for an expression that matches no preset', () => {
    expect(findMatchingPresetId('15 3 * * 2')).toBeNull();
  });

  it('returns null for an unparseable expression', () => {
    expect(findMatchingPresetId('not a cron')).toBeNull();
  });
});

describe('resolvePresetExpression', () => {
  it('resolves a known preset id to its expression', () => {
    expect(resolvePresetExpression('hourly')).toBe('0 * * * *');
  });

  it('resolves the "Custom" placeholder value to null', () => {
    expect(resolvePresetExpression(CUSTOM_PRESET_VALUE)).toBeNull();
  });

  it('resolves an unknown id to null', () => {
    expect(resolvePresetExpression('does-not-exist')).toBeNull();
  });
});

describe('applyPresetSelection', () => {
  it('calls onSelect with the resolved expression for a known preset id', () => {
    const onSelect = vi.fn();
    applyPresetSelection('hourly', onSelect);
    expect(onSelect).toHaveBeenCalledWith('0 * * * *');
  });

  it('does not call onSelect for the "Custom" placeholder', () => {
    const onSelect = vi.fn();
    applyPresetSelection(CUSTOM_PRESET_VALUE, onSelect);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not call onSelect for an unknown id', () => {
    const onSelect = vi.fn();
    applyPresetSelection('does-not-exist', onSelect);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
