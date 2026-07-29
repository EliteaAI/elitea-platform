import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { getTtsVoices } from './ttsVoices';

const BASE = '/api/v2';

afterEach(() => {
  resetGeneratedClient();
});

function setup(): void {
  configureGeneratedClient({ baseUrl: BASE });
}

describe('getTtsVoices', () => {
  it('GETs /tts_voices/{projectId} with model_name as a query param and unwraps { voices }', async () => {
    setup();
    let url = '';
    server.use(
      http.get(`${BASE}/configurations/tts_voices/7`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ voices: [{ id: 'v1', name: 'Alloy' }] });
      }),
    );
    const result = await getTtsVoices(7, 'gpt-4o-mini');
    expect(url).toContain('model_name=gpt-4o-mini');
    expect(result).toEqual({ voices: [{ id: 'v1', name: 'Alloy' }] });
  });

  it('omits model_name when undefined', async () => {
    setup();
    let url = '';
    server.use(
      http.get(`${BASE}/configurations/tts_voices/7`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ voices: [] });
      }),
    );
    await getTtsVoices(7, undefined);
    expect(url).not.toContain('model_name');
  });

  it('defaults to an empty voices array when the response omits the field', async () => {
    setup();
    server.use(http.get(`${BASE}/configurations/tts_voices/7`, () => HttpResponse.json({})));
    await expect(getTtsVoices(7, 'x')).resolves.toEqual({ voices: [] });
  });
});
