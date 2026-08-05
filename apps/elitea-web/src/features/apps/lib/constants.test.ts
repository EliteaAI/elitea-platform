import { describe, expect, it } from 'vitest';

import { APPLICATION_CATALOG, APPLICATION_REQUEST_SUPPORT_EMAIL, REQUEST_STATUS } from './constants';

describe('APPLICATION_CATALOG', () => {
  it('has exactly the two baseline entries, in order, each with a real icon component', () => {
    expect(APPLICATION_CATALOG.map((entry) => entry.type)).toEqual(['wikis_Wikis', 'inventory']);
    for (const entry of APPLICATION_CATALOG) {
      expect(entry.Icon).toBeDefined();
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.documentation).toMatch(/^https:\/\/docs\.elitea\.ai\//);
      expect(entry.capabilities.length).toBeGreaterThan(0);
    }
  });
});

describe('REQUEST_STATUS', () => {
  it('has the four baseline states', () => {
    expect(REQUEST_STATUS).toEqual({
      NONE: 'none',
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected',
    });
  });
});

describe('APPLICATION_REQUEST_SUPPORT_EMAIL', () => {
  it('matches the baseline support address', () => {
    expect(APPLICATION_REQUEST_SUPPORT_EMAIL).toBe('SupportAlita@epam.com');
  });
});
