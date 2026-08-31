import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { EVAL_ENGINE, EVAL_POLARITY, EVAL_SCALE_TYPE, EVAL_TIER } from '../model/types';
import {
  createEvalDimension,
  deleteEvalDimension,
  fetchEvalDimensions,
  updateEvalDimension,
} from './evaluationApi';

const BASE = '/api/v2';

const dimension = {
  id: '1',
  uuid: 'e0f1',
  name: 'Faithfulness',
  description: 'Grounded in the retrieved context?',
  tier: EVAL_TIER.project,
  application_id: null,
  allowed_engines: [EVAL_ENGINE.ai],
  scale_type: EVAL_SCALE_TYPE.continuous,
  scale_min: 0,
  scale_max: 100,
  polarity: EVAL_POLARITY.higherBetter,
  default_weight: 1,
  default_target: null,
  default_target_operator: '',
  code: '',
  return_contract: '',
};

const writeInput = {
  name: 'Faithfulness',
  description: 'Grounded in the retrieved context?',
  tier: EVAL_TIER.project,
  application_id: null,
  allowed_engines: [EVAL_ENGINE.ai],
  scale_type: EVAL_SCALE_TYPE.continuous,
  scale_min: 0,
  scale_max: 100,
  polarity: EVAL_POLARITY.higherBetter,
  default_weight: 1,
  default_target: null,
  default_target_operator: '' as const,
  code: '',
  return_contract: '' as const,
};

beforeEach(() => configureGeneratedClient({ baseUrl: BASE }));
afterEach(() => resetGeneratedClient());

describe('evaluation dimension API', () => {
  /*
   * THE ENVELOPE. The server answers `{rows, total}` and this module reads it
   * through `unwrapList`. A call site that hardcoded the wrong key would return
   * `undefined`, coerce to `[]`, and render an empty library behind a 200 with
   * nothing in the console — the defect class #132 catalogues. The Go handler's
   * TestListAnswersRowsEnvelope pins the other half.
   */
  it('unwraps the `{rows,total}` envelope the server sends', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, () =>
        HttpResponse.json({ rows: [dimension], total: 1 }),
      ),
    );
    await expect(fetchEvalDimensions('1')).resolves.toEqual([dimension]);
  });

  it('also survives a bare-array body, which this API serves elsewhere', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, () =>
        HttpResponse.json([dimension]),
      ),
    );
    await expect(fetchEvalDimensions('1')).resolves.toEqual([dimension]);
  });

  it('narrows the listing to one agent and keeps the platform flag explicit', async () => {
    let query = '';
    server.use(
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({ rows: [], total: 0 });
      }),
    );

    await fetchEvalDimensions('1', { applicationId: 42 });
    expect(query).toContain('agent_id=42');
    expect(query).toContain('include_platform=true');

    await fetchEvalDimensions('1', { includePlatform: false });
    expect(query).toContain('include_platform=false');
    // An absent agent means "the project library alone" — never "every agent's
    // ad-hoc rubrics", which would leak each agent's private criteria into
    // every other agent's editor.
    expect(query).not.toContain('agent_id');
  });

  /*
   * THE READ-BACK, client-side. A create that resolves proves the request was
   * made; it proves nothing about what is stored. This asserts the created row
   * appears in the very next listing, over the same routes the UI uses.
   */
  it('returns a created dimension that the listing then reports', async () => {
    const stored: (typeof dimension)[] = [];
    server.use(
      http.post(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, async ({ request }) => {
        const body = (await request.json()) as typeof writeInput;
        const created = { ...dimension, name: body.name };
        stored.push(created);
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, () =>
        HttpResponse.json({ rows: stored, total: stored.length }),
      ),
    );

    const created = await createEvalDimension('1', writeInput);
    expect(created.name).toBe('Faithfulness');
    await expect(fetchEvalDimensions('1')).resolves.toEqual([created]);
  });

  it('updates through the singular path and returns the stored row', async () => {
    let seenPath = '';
    server.use(
      http.put(`${BASE}/elitea_core/eval_dimension/prompt_lib/:projectId/:id`, ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({ ...dimension, name: 'Renamed' });
      }),
    );
    await expect(updateEvalDimension('1', '7', writeInput)).resolves.toMatchObject({ name: 'Renamed' });
    expect(seenPath).toBe(`${BASE}/elitea_core/eval_dimension/prompt_lib/1/7`);
  });

  it('deletes through the singular path', async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/elitea_core/eval_dimension/prompt_lib/:projectId/:id`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deleteEvalDimension('1', '7');
    expect(called).toBe(true);
  });
});
