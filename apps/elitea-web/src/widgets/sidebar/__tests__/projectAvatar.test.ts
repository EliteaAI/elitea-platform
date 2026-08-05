import { describe, expect, it } from 'vitest';

import { projectAvatarColor, projectInitial } from '../lib/projectAvatar';

const FALLBACK_COLOR = projectAvatarColor(undefined);

describe('projectAvatarColor', () => {
  it('is deterministic: the same first letter always maps to the same colour', () => {
    expect(projectAvatarColor('Alpha')).toBe(projectAvatarColor('Apple'));
    expect(projectAvatarColor('Echo')).toBe(projectAvatarColor('Elephant'));
  });

  it('is case-insensitive: the first letter is uppercased before matching', () => {
    expect(projectAvatarColor('alpha')).toBe(projectAvatarColor('Alpha'));
    expect(projectAvatarColor('ALPHA')).toBe(projectAvatarColor('Alpha'));
  });

  it('assigns a DIFFERENT colour to letters from different groups', () => {
    // A (group 1) vs E (group 2) vs I (group 3) vs M (group 4) — spot-checks
    // that the palette actually partitions the alphabet, not that every
    // possible pair differs (six colours, twenty-six letters).
    const colors = new Set(['A', 'E', 'I', 'M'].map((letter) => projectAvatarColor(letter)));
    expect(colors.size).toBe(4);
  });

  it('every letter A-Z resolves to a real (non-fallback) colour', () => {
    for (const code of Array.from({ length: 26 }, (_, i) => 65 + i)) {
      const letter = String.fromCharCode(code);
      expect(projectAvatarColor(letter)).not.toBe(FALLBACK_COLOR);
    }
  });

  it('falls back to the default colour for an empty/undefined name', () => {
    expect(projectAvatarColor(undefined)).toBe(FALLBACK_COLOR);
    expect(projectAvatarColor('')).toBe(FALLBACK_COLOR);
  });

  it('falls back to the default colour for a name starting with a non-letter', () => {
    expect(projectAvatarColor('123 Project')).toBe(FALLBACK_COLOR);
  });
});

describe('projectInitial', () => {
  it('uppercases the first character', () => {
    expect(projectInitial('mango')).toBe('M');
  });

  it('falls back to "?" when no name is given', () => {
    expect(projectInitial(undefined)).toBe('?');
    expect(projectInitial('')).toBe('?');
  });
});
