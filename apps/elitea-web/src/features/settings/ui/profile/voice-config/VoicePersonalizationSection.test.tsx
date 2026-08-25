/**
 * Regression coverage for two defects in the Settings > Profile > Voice
 * Personalization panel.
 *
 * 1. The panel resolved its "TTS model" from the UNSECTIONED model list.
 *    It called `useListModelsQuery({projectId, include_shared:true})`, whose
 *    fetcher sends no `section` at all, then took the first / default row of
 *    that mixed list. In a project that owns an LLM configuration and a TTS
 *    configuration, the LLM row won, so the voice request asked for the
 *    voices of an LLM and came back empty.
 *
 * 2. The browser-voice fallback was gated on `hasModelTTS`, so it was skipped
 *    exactly when the model voice list came back empty. The Voice dropdown
 *    then had nothing in it and Preview was a silent no-op. The voice route
 *    answers 501 for every project today (#466), so this is the normal case,
 *    not an edge case.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../../../test/setup';

import { VoicePersonalizationSection } from './VoicePersonalizationSection';

const BASE = '/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderPanel(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const socket = createTestSocketClient();
  render(
    <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <SocketClientContext.Provider value={socket}>
          <VoicePersonalizationSection projectId="1" />
        </SocketClientContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/** Reports every model-catalogue URL the panel requested. */
function captureModelRequests(): string[] {
  const requested: string[] = [];
  server.use(
    http.get(`${BASE}/configurations/models/1`, ({ request }) => {
      requested.push(request.url);
      const section = new URL(request.url).searchParams.get('section');
      // The backend answers the section it was asked for. With no `section`
      // the caller gets the mixed catalogue, LLM row first — the defect.
      const items = section === 'tts'
        ? [{ name: 'azure-tts', project_id: '1', default: true }]
        : [{ name: 'gpt-4o', project_id: '1', default: true }];
      return HttpResponse.json({ items, total: items.length });
    }),
  );
  return requested;
}

/** Serves the voice list for `modelName`; every other model gets an empty list. Reports every voice URL requested. */
function serveVoices(modelName: string, voices: readonly { id: string; name: string }[]): string[] {
  const requested: string[] = [];
  server.use(
    http.get(`${BASE}/configurations/tts_voices/1`, ({ request }) => {
      requested.push(request.url);
      const asked = new URL(request.url).searchParams.get('model_name');
      return HttpResponse.json({ voices: asked === modelName ? voices : [] });
    }),
  );
  return requested;
}

// jsdom ships no Web Speech API. Installed once for the whole file, not per
// test: React's unmount cleanup runs inside `afterEach` and reads
// `window.speechSynthesis` again, so a per-test teardown of the stub throws.
Object.defineProperty(window, 'speechSynthesis', {
  configurable: true,
  value: {
    getVoices: () => [{ name: 'Daniel', localService: true }],
    addEventListener: () => {},
    removeEventListener: () => {},
    speak: () => {},
  },
});

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('VoicePersonalizationSection', () => {
  it('asks the model catalogue for the tts section, so an LLM cannot be picked as the TTS model', async () => {
    const requested = captureModelRequests();
    const voiceRequests = serveVoices('azure-tts', [{ id: 'v1', name: 'Aria' }]);

    renderPanel();

    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(requested[0]).toContain('section=tts');
    await waitFor(() => expect(voiceRequests.length).toBeGreaterThan(0));

    // "Aria" is only reachable when the panel asked for `azure-tts`, the TTS
    // row. The LLM row (`gpt-4o`) resolves to an empty voice list.
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox'));
    expect(await screen.findByRole('option', { name: 'Aria' })).toBeInTheDocument();
  });

  it('falls back to the browser voices when the model voice list resolves empty', async () => {
    captureModelRequests();
    // The live route answers 501 / an empty list for every project (#466).
    const voiceRequests = serveVoices('nothing-matches', []);

    renderPanel();

    // The select unmounts while the voice list is in flight, so settle the
    // network before querying it.
    await waitFor(() => expect(voiceRequests.length).toBeGreaterThan(0));

    // Before the fix `hasModelTTS` stayed true, so the browser voices were
    // never offered and the Voice select never rendered at all.
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox'));
    expect(await screen.findByRole('option', { name: 'Daniel' })).toBeInTheDocument();
  });
});
