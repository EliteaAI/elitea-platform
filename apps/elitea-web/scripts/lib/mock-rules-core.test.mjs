import { describe, expect, it } from 'vitest';

import { FIXTURE_MAX_AGE_DAYS, checkFixtureFreshness, checkHandlerSource } from './mock-rules-core.mjs';

describe('R-M2 — no inline handler bodies', () => {
  it('flags HttpResponse.json with an inline object literal', () => {
    const source = `
import { http, HttpResponse } from 'msw';
export const handlers = [
  http.get('/api/v2/users', () => HttpResponse.json({ id: 1, name: 'inline' })),
];`;
    const findings = checkHandlerSource('handlers.ts', source);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('R-M2');
  });

  it('flags array literals and Response.json too', () => {
    const source = `
export const handlers = [
  http.get('/api/v2/tags', () => Response.json([1, 2, 3])),
];`;
    expect(checkHandlerSource('handlers.ts', source)).toHaveLength(1);
  });

  it('passes fixture-derived bodies', () => {
    const source = `
import { http, HttpResponse } from 'msw';
import usersFixture from '../fixtures/users.list.200.json';
export const handlers = [
  http.get('/api/v2/users', () => HttpResponse.json(usersFixture.body)),
];`;
    expect(checkHandlerSource('handlers.ts', source)).toEqual([]);
  });

  it('ignores unrelated .json() calls', () => {
    const source = 'export async function read(r: Response) { return r.json(); }';
    expect(checkHandlerSource('read.ts', source)).toEqual([]);
  });

  it('parses .tsx handler modules (jsx plugin branch)', () => {
    const source = `
import { HttpResponse } from 'msw';
export const preview = <div />;
export const bad = () => HttpResponse.json({ inline: true });`;
    expect(checkHandlerSource('handlers.tsx', source)).toHaveLength(1);
  });
});

describe('R-M4 — fixture freshness', () => {
  const now = new Date('2026-07-26T00:00:00Z');

  it('passes a fixture recorded within 30 days', () => {
    expect(
      checkFixtureFreshness('f.json', { recordedAt: '2026-07-01T00:00:00Z', body: {} }, now),
    ).toEqual([]);
  });

  it('passes exactly at the 30-day boundary', () => {
    expect(
      checkFixtureFreshness('f.json', { recordedAt: '2026-06-26T00:00:00Z', body: {} }, now),
    ).toEqual([]);
  });

  it(`fails past ${FIXTURE_MAX_AGE_DAYS} days`, () => {
    const findings = checkFixtureFreshness('f.json', { recordedAt: '2026-01-01T00:00:00Z', body: {} }, now);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('R-M4');
    expect(findings[0].message).toContain('days ago');
  });

  it('fails a fixture with missing or unparseable recordedAt', () => {
    expect(checkFixtureFreshness('f.json', { body: {} }, now)).toHaveLength(1);
    expect(checkFixtureFreshness('f.json', { recordedAt: 'not-a-date', body: {} }, now)).toHaveLength(1);
  });
});
