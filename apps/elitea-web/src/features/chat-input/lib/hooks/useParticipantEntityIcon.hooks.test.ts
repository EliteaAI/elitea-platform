import { describe, expect, it } from 'vitest';

import { useParticipantEntityIcon } from './useParticipantEntityIcon.hooks';

describe('useParticipantEntityIcon', () => {
  it('returns undefined for a participant with no entitySettings.iconMeta', () => {
    expect(useParticipantEntityIcon({ entityName: 'application' })).toBeUndefined();
    expect(useParticipantEntityIcon(undefined)).toBeUndefined();
    expect(useParticipantEntityIcon(null)).toBeUndefined();
  });

  it('returns the icon meta verbatim when present', () => {
    const iconMeta = { url: 'https://example.com/icon.png' };
    expect(
      useParticipantEntityIcon({ entityName: 'application', entitySettings: { iconMeta } }),
    ).toEqual(iconMeta);
  });
});
