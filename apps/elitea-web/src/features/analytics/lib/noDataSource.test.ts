import { describe, expect, it } from 'vitest';

import { EliteaApiError } from '@/shared/api/generated/mutator';

import { noDataSourceOf } from './noDataSource';

function httpFailure(status: number, body: unknown): EliteaApiError {
  return new EliteaApiError({ kind: 'http', status, url: 'https://example.test/api/v2/x', body });
}

describe('noDataSourceOf', () => {
  it('recognises the absent-source refusal and carries the reason through', () => {
    const error = httpFailure(501, {
      error: 'analytics is not available on this deployment',
      code: 'no_data_source',
      detail: 'analytics: no data source: tool analytics: no toolkit_id',
    });
    expect(noDataSourceOf(error)).toEqual({
      detail: 'analytics: no data source: tool analytics: no toolkit_id',
    });
  });

  /**
   * The distinction the whole module exists for. A 500 is a query that failed —
   * the data exists and this attempt did not reach it — and rendering it as
   * "not available on this deployment" would tell a user their platform lacks a
   * feature it has.
   */
  it('does not treat a query failure as an absent source', () => {
    expect(noDataSourceOf(httpFailure(500, { error: 'failed to query analytics', code: 'query_failed' }))).toBeUndefined();
  });

  /**
   * Branching on the STATUS ALONE would misread any 501 the platform grows
   * later — a route stubbed out, a proxy answering for an unimplemented
   * method — as this specific refusal, and print a "detail" that is not one.
   */
  it('requires the machine-readable code, not just the status', () => {
    expect(noDataSourceOf(httpFailure(501, { error: 'not implemented' }))).toBeUndefined();
  });

  /**
   * A 501 from a proxy carries an HTML body, not JSON. It is still a permanent
   * refusal, but this module cannot claim to know why — and must not throw on
   * the way to finding that out.
   */
  it('survives a body that is not the expected object', () => {
    expect(noDataSourceOf(httpFailure(501, '<html>Not Implemented</html>'))).toBeUndefined();
    expect(noDataSourceOf(httpFailure(501, null))).toBeUndefined();
  });

  it('ignores rejections that are not an API answer at all', () => {
    expect(noDataSourceOf(new Error('boom'))).toBeUndefined();
    expect(noDataSourceOf(undefined)).toBeUndefined();
    expect(
      noDataSourceOf(new EliteaApiError({ kind: 'network', url: 'https://example.test/x', message: 'offline', cause: undefined })),
    ).toBeUndefined();
  });
});
