/**
 * DEFECT: the Environment settings page created a SECOND
 * `environment_settings` configuration row, holding only the one field the
 * admin had just edited, while the original row still existed. Downstream
 * readers do `SELECT data FROM ... WHERE type = 'environment_settings'
 * LIMIT 1` with no ORDER BY, so which row wins afterwards is arbitrary.
 *
 * The create-vs-update decision reads `currentConfig`. Three separate doors
 * left it null while a row existed on the server:
 *
 *  1. The page saves with `shared: true`, and the compat list handler
 *     (`internal/api/v2/configurations/handler.go`) returns `items` from
 *     `WHERE shared = false` and puts shared rows in a separate
 *     `shared.items` bucket. The page read `items` only, so on a perfectly
 *     successful 200 its own saved row was invisible and every blur created
 *     another one.
 *  2. The list query's `isError` was never destructured. A failed read
 *     rendered schema defaults with no error on screen — the field list
 *     comes from a DIFFERENT query (`/configurations/available/`) — and the
 *     blur handler took the CREATE branch.
 *  3. `savedValue` is `undefined` whenever no row is loaded, so
 *     `parsedValue === savedValue` never matched and merely tabbing THROUGH
 *     a field issued a write.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers/AppProviders';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import * as runtimeConfig from '@/shared/config';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import { server } from '@/test/setup';

import { Environment } from './Environment';

const BASE = '/api/v2';
const PROJECT = '1';

/** The pinned `/configurations/available/` schema for this section. */
const AVAILABLE = [
  {
    type: 'environment_settings',
    config_schema: {
      properties: {
        data: {
          properties: {
            system_sender_name: { type: 'string', title: 'System sender name', default: 'Elitea' },
            error_toast_duration: { type: 'integer', title: 'Error toast duration', default: 5000, minimum: 5000, maximum: 20000 },
          },
        },
      },
    },
  },
];

const EXISTING_ROW = {
  id: 42,
  project_id: PROJECT,
  elitea_title: 'environment_settings',
  label: 'environment_settings',
  type: 'environment_settings',
  section: 'environment_settings',
  shared: true,
  data: { system_sender_name: 'Elitea', error_toast_duration: 6000 },
};

const writes: { method: string; url: string }[] = [];

function baseHandlers() {
  return [
    http.get(`${BASE}/auth/permissions/prompt_lib/:projectId`, () =>
      HttpResponse.json([{ name: 'configurations.configuration.update', enabled: true }]),
    ),
    http.get(`${BASE}/configurations/available/`, () => HttpResponse.json(AVAILABLE)),
    http.post(`${BASE}/configurations/configurations/:projectId`, ({ request }) => {
      writes.push({ method: 'POST', url: request.url });
      return HttpResponse.json({ id: 99 });
    }),
    http.put(`${BASE}/configurations/configuration/:projectId/:configId`, ({ request }) => {
      writes.push({ method: 'PUT', url: request.url });
      return HttpResponse.json({ id: 42 });
    }),
  ];
}

function listHandler(body: Record<string, unknown> | null, status = 200) {
  return http.get(`${BASE}/configurations/configurations/:projectId`, () =>
    status === 200 ? HttpResponse.json(body) : new HttpResponse(null, { status }),
  );
}

async function mountEnvironment() {
  render(
    <AppProviders>
      <Environment />
    </AppProviders>,
  );
  await screen.findByLabelText('Error toast duration');
}

beforeEach(() => {
  writes.length = 0;
  configureGeneratedClient({ baseUrl: BASE });
  useSelectedProjectStore.setState({ project: { id: PROJECT, name: 'Public' } });
  vi.spyOn(runtimeConfig, 'getConfig').mockReturnValue({
    status: 'ok',
    config: {
      vite_server_url: BASE,
      vite_base_uri: '/',
      vite_public_project_id: PROJECT,
      allow_project_own_llms: false,
    },
  });
  server.use(...baseHandlers());
});

afterEach(() => {
  vi.restoreAllMocks();
  resetGeneratedClient();
  useSelectedProjectStore.setState({ project: null });
});

describe('Environment settings — no duplicate configuration rows', () => {
  it('updates the existing row when the server returns it in the `shared` bucket', async () => {
    server.use(listHandler({ items: [], total: 0, offset: 0, limit: 100, shared: { items: [EXISTING_ROW], total: 1, offset: 0, limit: 20 } }));
    await mountEnvironment();

    const input = await screen.findByLabelText('Error toast duration');
    await waitFor(() => expect(input).toHaveValue(6000));

    fireEvent.change(input, { target: { value: '7000' } });
    fireEvent.blur(input);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.method).toBe('PUT');
    expect(writes[0]?.url).toContain(`/configurations/configuration/${PROJECT}/42`);
  });

  it('writes nothing on a blur the user never typed into', async () => {
    server.use(listHandler({ items: [], total: 0, offset: 0, limit: 100, shared: { items: [EXISTING_ROW], total: 1, offset: 0, limit: 20 } }));
    await mountEnvironment();

    const input = await screen.findByLabelText('System sender name');
    fireEvent.focus(input);
    fireEvent.blur(input);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes).toHaveLength(0);
  });

  it('reports a failed read instead of silently creating a row from schema defaults', async () => {
    server.use(listHandler(null, 500));
    await mountEnvironment();

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    const input = await screen.findByLabelText('Error toast duration');
    expect(input).toBeDisabled();

    fireEvent.change(input, { target: { value: '9000' } });
    fireEvent.blur(input);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes).toHaveLength(0);
  });
});
