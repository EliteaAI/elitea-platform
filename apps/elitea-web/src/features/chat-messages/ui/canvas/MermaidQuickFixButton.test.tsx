/**
 * THE gate for Canvas slice 2b: the quick-fix control must be ABSENT — not
 * present-and-broken — whenever its service prompt or its model is
 * unavailable.
 *
 * Two independent reasons it cannot run, and BOTH are the state of a real
 * build:
 *
 *  - `POST /elitea_core/predict_llm/prompt_lib/{projectId}` is not routed at
 *    all. It stood behind a nil `RouterConfig.Predictor` gate nothing ever
 *    assigned, so chi 404s it in every deployment (`internal/api/router.go`'s
 *    NOTE(#126); backend gap #194). `hasBackendCapability('llmPredictBlocking')`
 *    records that, and it is `false` in this build — so the FIRST test below
 *    is the one that describes what ships today, and every other test in this
 *    file has to turn the capability on to reach the case it is about.
 *  - `/configurations/*` sits behind `ELITEA_CONFIGURATIONS_ENABLED`, which is
 *    false in a default install, so the model and service-prompt reads 404.
 *
 * The baseline's button would have toasted "No model is available for Quick
 * Fix" on every single click in both situations.
 *
 * Substitution stops at the network boundary (§6.2 / R-M1): these drive the
 * real `useMermaidQuickFix` hook and the real `eliteaFetch` transport against
 * MSW, not a mocked API module.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import {
  resetBackendCapabilitiesForTests,
  setBackendCapabilityForTests,
} from '@/shared/config/backendCapabilities';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { server } from '@/test/setup';
import { useMermaidQuickFix } from '../../model/useMermaidQuickFix';
import { MermaidQuickFixButton } from './MermaidQuickFixButton';

const MODELS_URL = '/api/v2/configurations/models/1';
const CONFIGS_URL = '/api/v2/configurations/configurations/1';
const PREDICT_URL = '/api/v2/elitea_core/predict_llm/prompt_lib/1';

const MODELS_OK = { low_tier_default_model_name: 'small', low_tier_default_model_project_id: '7' };
const PROMPT_OK = { items: [{ data: { key: 'MERMAID_QUICK_FIX', prompt: 'Repair this diagram.' } }] };

/** Installs the two capability reads; `null` for either means "this deployment does not serve it" (404). */
function installReads(models: unknown, prompts: unknown): void {
  server.use(
    http.get(MODELS_URL, () => (models === null ? new HttpResponse(null, { status: 404 }) : HttpResponse.json(models))),
    http.get(CONFIGS_URL, () =>
      prompts === null ? new HttpResponse(null, { status: 404 }) : HttpResponse.json(prompts),
    ),
  );
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Renders the button through the real hook and waits for both reads to settle. */
async function renderButton(options: { readOnly?: boolean; projectId?: string | undefined } = {}) {
  const onFixed = vi.fn();
  const onError = vi.fn();
  const { result } = renderHook(
    () =>
      useMermaidQuickFix({
        projectId: 'projectId' in options ? options.projectId : '1',
        readOnly: options.readOnly,
      }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.capability.reason).not.toBe('loading'));

  renderWithTheme(
    <MermaidQuickFixButton
      quickFix={result.current}
      code="graph TD"
      error="Parse error"
      onFixed={onFixed}
      onError={onError}
    />,
  );
  return { result, onFixed, onError };
}

describe('MermaidQuickFixButton', () => {
  beforeEach(() => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    // Every case EXCEPT the first is about a condition further down the gate,
    // so the route capability is turned on to reach it. The first case turns it
    // back off, because that is what this build actually serves.
    setBackendCapabilityForTests('llmPredictBlocking', true);
    installReads(MODELS_OK, PROMPT_OK);
  });

  afterEach(() => {
    resetGeneratedClient();
    resetBackendCapabilitiesForTests();
  });

  it('is ABSENT when this build serves no blocking predict_llm', async () => {
    // Stated, not inherited from the module default. This build DOES serve the
    // blocking route now, so relying on the default would make this test assert
    // the opposite of its name the moment the capability flipped -- which is
    // exactly what happened.
    setBackendCapabilityForTests('llmPredictBlocking', false);

    const { result } = await renderButton();

    expect(result.current.capability.isAvailable).toBe(false);
    expect(result.current.capability.reason).toBe('no-backend');
    expect(screen.queryByTestId('canvas-mermaid-quick-fix')).toBeNull();
  });

  it('makes no configurations request at all when the route is unavailable', async () => {
    setBackendCapabilityForTests('llmPredictBlocking', false);
    let asked = 0;
    server.use(
      http.get(MODELS_URL, () => {
        asked += 1;
        return HttpResponse.json(MODELS_OK);
      }),
      http.get(CONFIGS_URL, () => {
        asked += 1;
        return HttpResponse.json(PROMPT_OK);
      }),
    );

    await renderButton();

    // Asking which model would serve an endpoint this build cannot reach is two
    // requests spent on a question that cannot matter.
    expect(asked).toBe(0);
  });

  it('is ABSENT when the MERMAID_QUICK_FIX service prompt does not exist', async () => {
    installReads(MODELS_OK, { items: [] });

    const { result } = await renderButton();

    expect(result.current.capability.isAvailable).toBe(false);
    expect(result.current.capability.reason).toBe('no-prompt');
    expect(screen.queryByTestId('canvas-mermaid-quick-fix')).toBeNull();
  });

  it('is ABSENT when the service prompt row exists but its text is blank', async () => {
    installReads(MODELS_OK, { items: [{ data: { key: 'MERMAID_QUICK_FIX', prompt: '   ' } }] });

    const { result } = await renderButton();

    expect(result.current.capability.reason).toBe('no-prompt');
    expect(screen.queryByTestId('canvas-mermaid-quick-fix')).toBeNull();
  });

  it('is ABSENT when no model is available', async () => {
    installReads({ items: [] }, PROMPT_OK);

    const { result } = await renderButton();

    expect(result.current.capability.reason).toBe('no-model');
    expect(screen.queryByTestId('canvas-mermaid-quick-fix')).toBeNull();
  });

  it('is ABSENT when the configurations reads 404 — the default install, ELITEA_CONFIGURATIONS_ENABLED=false', async () => {
    installReads(null, null);

    const { result } = await renderButton();

    expect(result.current.capability.isAvailable).toBe(false);
    expect(screen.queryByTestId('canvas-mermaid-quick-fix')).toBeNull();
  });

  it('is ABSENT with no project selected', async () => {
    const { result } = await renderButton({ projectId: undefined });

    expect(result.current.capability.reason).toBe('no-project');
    expect(screen.queryByTestId('canvas-mermaid-quick-fix')).toBeNull();
  });

  it('is ABSENT when the canvas is read-only', async () => {
    const { result } = await renderButton({ readOnly: true });

    expect(result.current.capability.reason).toBe('read-only');
    expect(screen.queryByTestId('canvas-mermaid-quick-fix')).toBeNull();
  });

  it('is PRESENT, names the chosen model, and hands the repaired diagram back when both reads answer', async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.post(PREDICT_URL, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ result: { output: '```mermaid\ngraph LR\n```' } });
      }),
    );

    const { result, onFixed } = await renderButton();

    expect(result.current.capability.isAvailable).toBe(true);
    expect(result.current.capability.tooltip).toBe('Quick Fix: small (low-tier)');

    await userEvent.click(screen.getByTestId('canvas-mermaid-quick-fix'));

    await waitFor(() => expect(onFixed).toHaveBeenCalledWith('graph LR'));
    expect(sent).toMatchObject({
      llm_settings: { model_name: 'small', model_project_id: 7, temperature: 0.1 },
      await_task_timeout: 60,
    });
    expect(String((sent as unknown as { user_input: string }).user_input)).toContain('Repair this diagram.');
  });

  it('reports a genuine runtime failure through onError — the 60s window expiring is NOT an answer', async () => {
    server.use(http.post(PREDICT_URL, () => HttpResponse.json({ task_id: 'task-1' })));

    const { onError, onFixed } = await renderButton();
    await userEvent.click(screen.getByTestId('canvas-mermaid-quick-fix'));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onFixed).not.toHaveBeenCalled();
  });

  it('reports a reply carrying no mermaid code through onError', async () => {
    server.use(http.post(PREDICT_URL, () => HttpResponse.json({ result: { output: '' } })));

    const { onError, onFixed } = await renderButton();
    await userEvent.click(screen.getByTestId('canvas-mermaid-quick-fix'));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onFixed).not.toHaveBeenCalled();
  });
});
