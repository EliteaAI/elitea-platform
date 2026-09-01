/**
 * Rendering and behaviour tests for `pages/admin/ServiceDescriptors.tsx` (unit A14).
 *
 * This page is deliberately unavailable, so "it renders" is close to worthless as
 * a bar. Each test asserts one of the properties that make the unavailability
 * honest rather than decorative:
 *
 *  - the sentence shown is the SERVER's, not one the page carries — the test
 *    serves a reason no source file contains and expects to see it;
 *  - a 501 and a 500 are told apart, so a broken server cannot pass itself off as
 *    a considered architectural decision;
 *  - if the server ever answers 200 WITH ROWS, the page shows them and drops the
 *    notice. That is the assertion that would catch someone wiring the endpoint
 *    to a stub, which is the failure this whole unit exists to remove;
 *  - the REQUEST is the one pylon serves — the right path, the right mode, and
 *    GET only. No registration verb is ever issued, because no control exists to
 *    issue one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { AdminServiceDescriptors } from './ServiceDescriptors';
import { renderAdminRoute } from './__tests__/testRouter';

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
}

let recorded: RecordedRequest[] = [];

/**
 * A sentence that appears in NO source file of this app. If the page can show
 * it, the page is showing what the server said.
 */
const SERVER_REASON =
  'the provider hub is not part of this deployment: nothing stores a descriptor and nothing looks one up';

const DESCRIPTORS_PATH = '*/elitea_core/admin/administration';

function respondWith(status: number, body: Record<string, unknown>): void {
  server.use(
    http.get(DESCRIPTORS_PATH, ({ request }) => {
      recorded.push({ method: request.method, url: request.url });
      return HttpResponse.json(body, { status });
    }),
    // Any registration verb reaching the network is a failure of this page, so
    // it is recorded rather than answered plausibly.
    http.post('*/elitea_core/register_descriptor/*', ({ request }) => {
      recorded.push({ method: request.method, url: request.url });
      return HttpResponse.json({ error: 'unexpected' }, { status: 501 });
    }),
    http.delete('*/elitea_core/register_descriptor/*', ({ request }) => {
      recorded.push({ method: request.method, url: request.url });
      return HttpResponse.json({ error: 'unexpected' }, { status: 501 });
    }),
  );
}

describe('AdminServiceDescriptors', () => {
  beforeEach(() => {
    recorded = [];
    configureGeneratedClient({ baseUrl: '/api/v2' });
  });

  afterEach(() => {
    resetGeneratedClient();
  });

  it('renders the reason the SERVER gave, not one of its own', async () => {
    respondWith(501, { error: SERVER_REASON });

    renderAdminRoute(<AdminServiceDescriptors />);

    const notice = await screen.findByTestId('admin-service-descriptors-unavailable');
    expect(notice).toHaveTextContent(SERVER_REASON);
    // And ONLY the notice. A 501 is not additionally a load failure, and showing
    // both would tell the operator the explanation might itself be a symptom.
    expect(screen.queryByTestId('admin-service-descriptors-error')).toBeNull();
  });

  it('asks the endpoint pylon serves, in administration mode, with GET only', async () => {
    respondWith(501, { error: SERVER_REASON });

    renderAdminRoute(<AdminServiceDescriptors />);
    await screen.findByTestId('admin-service-descriptors-unavailable');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.method).toBe('GET');
    expect(recorded[0]?.url).toContain('/elitea_core/admin/administration');
    // The reference client also declares a delete. This page must not have one.
    expect(recorded.some((entry) => entry.method !== 'GET')).toBe(false);
  });

  it('does not present a failed request as a considered architectural decision', async () => {
    respondWith(500, { error: 'database is on fire' });

    renderAdminRoute(<AdminServiceDescriptors />);

    await screen.findByTestId('admin-service-descriptors-error');
    expect(screen.queryByTestId('admin-service-descriptors-unavailable')).toBeNull();
  });

  it('shows rows and drops the notice if the endpoint ever answers with them', async () => {
    // The regression guard: a stub answering 200 must be VISIBLE, not silently
    // rendered as an empty page still displaying the unavailability text.
    respondWith(200, {
      total: 2,
      rows: [
        {
          project_id: 13,
          provider_name: 'deepwiki',
          service_location_url: 'http://provider.example.com/deepwiki',
          healthy: true,
        },
        {
          project_id: 13,
          provider_name: 'inventory',
          service_location_url: 'http://provider.example.com/inventory',
          healthy: false,
        },
      ],
    });

    renderAdminRoute(<AdminServiceDescriptors />);

    expect(await screen.findByText('deepwiki')).toBeVisible();
    expect(screen.getByText('inventory')).toBeVisible();
    expect(screen.getByText('http://provider.example.com/deepwiki')).toBeVisible();
    // Both health states in one render. Asserting only the unhealthy one — as
    // the single-row test below does — leaves the healthy label free to change
    // to "No" without any test noticing, and two rows both reading "No" is a
    // listing that reports a working provider as broken.
    expect(screen.getByText('Yes')).toBeVisible();
    expect(screen.getByText('No')).toBeVisible();
    expect(screen.queryByTestId('admin-service-descriptors-unavailable')).toBeNull();
    expect(screen.queryByTestId('admin-service-descriptors-error')).toBeNull();
  });

  it('distinguishes an unhealthy provider from a healthy one', async () => {
    respondWith(200, {
      rows: [
        {
          project_id: 1,
          provider_name: 'imagegen',
          service_location_url: 'https://provider.example.com/imagegen',
          healthy: false,
        },
      ],
    });

    renderAdminRoute(<AdminServiceDescriptors />);

    // `healthy` is a boolean and rendering it verbatim would print "false",
    // which reads as a value rather than as a state.
    // The colour is not asserted here, and does not need to be: R-T6 forbids
    // asserting on MUI's internal class names, and `ServiceDescriptorsTable`
    // selects the colour and the label together from one constant, so they
    // cannot disagree. The label is what a screen reader gets either way.
    expect(await screen.findByText('No')).toBeVisible();
    expect(screen.queryByText('Yes')).toBeNull();
  });

  it('reports an unprobed provider as Unknown, not as unhealthy', async () => {
    // THE THREE-STATE CONTRACT, and the one state pylon could not express.
    // `provider_health_projection` is a separate table with its own timestamp,
    // and the server answers `null` when no projection is fresh enough to make
    // a claim. Rendering that as "No" reports a provider nobody has asked about
    // as broken — the exact defect the projection table was split out to stop.
    //
    // Both other rows are here on purpose: with only the null row, a component
    // that had collapsed to a single chip would still pass.
    respondWith(200, {
      rows: [
        {
          project_id: 4,
          provider_name: 'unprobed',
          service_location_url: 'https://provider.example.com/unprobed',
          healthy: null,
        },
        {
          project_id: 4,
          provider_name: 'live',
          service_location_url: 'https://provider.example.com/live',
          healthy: true,
        },
        {
          project_id: 4,
          provider_name: 'down',
          service_location_url: 'https://provider.example.com/down',
          healthy: false,
        },
      ],
    });

    renderAdminRoute(<AdminServiceDescriptors />);

    expect(await screen.findByText('Unknown')).toBeVisible();
    expect(screen.getByText('Yes')).toBeVisible();
    expect(screen.getByText('No')).toBeVisible();
    // Exactly one of each: three rows must not render three copies of one
    // label, which is what a state that fell through to a default would do.
    expect(screen.getAllByText('Unknown')).toHaveLength(1);
    expect(screen.getAllByText('No')).toHaveLength(1);
  });

  it('treats a descriptor with no healthy field at all as Unknown', async () => {
    // An absent field says exactly as little as an explicit null. This is the
    // repo's recurring "absence reads as correctness" shape pointed the other
    // way: absence must read as NO CLAIM, never as a false one.
    respondWith(200, {
      rows: [
        {
          project_id: 7,
          provider_name: 'silent',
          service_location_url: 'https://provider.example.com/silent',
        },
      ],
    });

    renderAdminRoute(<AdminServiceDescriptors />);

    expect(await screen.findByText('Unknown')).toBeVisible();
    expect(screen.queryByText('No')).toBeNull();
  });

  it('renders an empty listing without claiming the surface is unavailable', async () => {
    // "Nothing is registered" and "this platform has no provider hub" are
    // different facts, and the second one must come from the server.
    respondWith(200, { total: 0, rows: [] });

    const { queryClient } = renderAdminRoute(<AdminServiceDescriptors />);

    await waitFor(() => {
      expect(screen.getByText('No service descriptors are registered.')).toBeVisible();
    });
    expect(screen.queryByTestId('admin-service-descriptors-unavailable')).toBeNull();

    // The listing lands under the namespace this module declares. A key built
    // somewhere else is a cache nothing else can reach or invalidate — the
    // read/write namespace split that made saved data look absent in #132.
    expect(queryClient.getQueryData(['admin', 'service-descriptors', 'list'])).toEqual([]);
  });

  it('does not read `rows` off the transport envelope', async () => {
    // #132: `eliteaFetch` resolves the envelope, not the body. A client peeling
    // it by hand — or forgetting to — would render "no descriptors registered"
    // for a response that carries two, which on this page is worse than empty:
    // it is a wrong answer that looks like a right one.
    respondWith(200, {
      rows: [
        {
          project_id: 7,
          provider_name: 'envelope-probe',
          service_location_url: 'https://provider.example.com/probe',
          healthy: true,
        },
      ],
    });

    renderAdminRoute(<AdminServiceDescriptors />);

    expect(await screen.findByText('envelope-probe')).toBeVisible();
    expect(screen.queryByText('No service descriptors are registered.')).toBeNull();
  });
});
