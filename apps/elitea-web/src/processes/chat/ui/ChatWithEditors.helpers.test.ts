import { describe, expect, it } from 'vitest';

import type { ApplicationCreatedResponse } from '@/shared/api/generated/model';

import { toCreatedResult } from './ChatWithEditors.helpers';

const BASE_RESPONSE: ApplicationCreatedResponse = {
  id: '1',
  name: 'New Agent',
  description: '',
  type: 'application',
  icon: '',
  owner_id: 'u1',
  created_at: '2024-01-01T00:00:00Z',
};

describe('toCreatedResult', () => {
  it('carries id/name straight through, omitting version_details entirely when absent', () => {
    expect(toCreatedResult(BASE_RESPONSE)).toEqual({ id: '1', name: 'New Agent' });
  });

  it('includes version_details.id, and variables when present, without ever assigning an explicit undefined', () => {
    const withVersion: ApplicationCreatedResponse = {
      ...BASE_RESPONSE,
      version_details: {
        id: 'v9',
        application_id: '1',
        name: 'v1',
        status: 'draft',
        variables: [{ name: 'x', value: '1' }],
      },
    };

    const result = toCreatedResult(withVersion);
    expect(result).toEqual({
      id: '1',
      name: 'New Agent',
      version_details: { id: 'v9', variables: [{ name: 'x', value: '1' }] },
    });
    expect(result.version_details).not.toHaveProperty('variables', undefined);
  });

  it('omits variables when the version has none, rather than setting it to undefined', () => {
    const withVersion: ApplicationCreatedResponse = {
      ...BASE_RESPONSE,
      version_details: { id: 'v9', application_id: '1', name: 'v1', status: 'draft' },
    };

    const result = toCreatedResult(withVersion);
    expect(result.version_details).toEqual({ id: 'v9' });
    expect(Object.keys(result.version_details ?? {})).not.toContain('variables');
  });
});
