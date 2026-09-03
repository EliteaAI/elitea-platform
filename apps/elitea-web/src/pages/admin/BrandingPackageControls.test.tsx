/**
 * The branding package controls on Admin › Branding (ADR-0024 WP9), against
 * MSW: the download, the import dialog's dry run and apply, the kept
 * versions and their restore, and the unsaved-draft rule around both.
 *
 * Mounted the way `Branding.test.tsx` mounts the page — under a memory
 * router, since the page carries a `useBlocker` — with the generated
 * `admin.msw.ts` handlers where they fit and inline `http.*` handlers where
 * the answer depends on the request (a 400 with the report shape, a
 * `dry_run` query, a zip with a `Content-Disposition`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { HttpResponse, http } from 'msw';

import {
  getGetBrandingSettingsMockHandler,
  getListBrandingPackageVersionsMockHandler,
  getRestoreBrandingPackageVersionMockHandler,
} from '@/shared/api/generated/admin/admin.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import type {
  BrandingPackageReport,
  BrandingPackageVersion,
  BrandingSettings,
} from '@/shared/api/generated/model';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { server } from '@/test/setup';

import { AdminBranding } from './Branding';
import { useBrandingDirtyStore } from './brandingDirty.store';
import { emptyBrandingValues } from './brandingValues';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

const PACKAGE_PATH = '*/admin/branding/package/administration';

const STORED: BrandingSettings = {
  values: { ...emptyBrandingValues(), product_name: 'Acme' },
  layers: { file: false, database: true },
  effective: { ...DEFAULT_BRAND_PACK, product: { ...DEFAULT_BRAND_PACK.product, name: 'Acme' } },
};

const MANIFEST = {
  format: 1,
  exported_at: '2026-09-01T10:00:00Z',
  deployment: 'stage.example',
  product: 'Globex',
  pack_digest: 'deadbeef',
  generator: 'elitea-main',
};

const CLEAN_DRY_RUN: BrandingPackageReport = {
  ok: true,
  dry_run: true,
  applied: false,
  problems: [],
  warnings: ['preview/app.html is not in this package'],
  diff: [
    { key: 'product_name', current: 'Acme', incoming: 'Globex' },
    { key: 'font_faces', current: [], incoming: [{ family: 'Inter', url: 'assets/inter.woff2' }] },
  ],
  manifest: MANIFEST,
};

const APPLIED: BrandingPackageReport = {
  ...CLEAN_DRY_RUN,
  dry_run: false,
  applied: true,
  version: { digest: 'cafe0123456789ab', path: 'branding/packages/cafe.zip', size: 4096, stored_at: '2026-09-02T09:00:00Z' },
};

const REFUSED: BrandingPackageReport = {
  ok: false,
  dry_run: true,
  applied: false,
  problems: [
    { entry: 'assets/logo-full.svg', reason: 'the SVG contains a <script> element' },
    { entry: 'brand-pack.json', reason: '"brand_hue" must be a six-digit hex colour' },
  ],
  warnings: [],
  diff: [],
  manifest: MANIFEST,
};

const VERSIONS: readonly BrandingPackageVersion[] = [
  { digest: '0123456789abcdef0123', path: 'branding/packages/0123.zip', size: 2048, stored_at: '2026-09-02T09:00:00Z', product: 'Globex', exported_at: '2026-09-01T10:00:00Z' },
  { digest: 'fedcba9876543210fedc', path: 'branding/packages/fedc.zip', size: 1024 * 1024 * 2, stored_at: '2026-08-30T09:00:00Z' },
];

const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

let imports: Array<string | null> = [];
let restores: string[] = [];

/** The import route, answering by the `dry_run` query — the shape the server has. */
function importHandler(dryRunReport: BrandingPackageReport, applyReport: BrandingPackageReport) {
  return http.post(PACKAGE_PATH, ({ request }) => {
    const dryRun = new URL(request.url).searchParams.get('dry_run');
    imports.push(dryRun);
    // The multipart body is not parsed: undici's parser rejects jsdom's `File`.
    // The content type proves the generated client sent a multipart form.
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    const report = dryRun === 'true' ? dryRunReport : applyReport;
    return HttpResponse.json(report, { status: report.ok ? 200 : 400 });
  });
}

function renderBranding(): void {
  const rootRoute = createRootRoute({ component: AdminBranding });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function productName(): Promise<HTMLInputElement> {
  return (await screen.findByTestId('branding-field-product_name')) as HTMLInputElement;
}

async function openImportDialog(): Promise<HTMLElement> {
  await userEvent.click(screen.getByTestId('branding-package-import'));
  return screen.findByTestId('branding-package-dialog');
}

function pickPackage(): void {
  const input = screen.getByTestId('branding-package-input');
  const file = new File([ZIP_BYTES], 'acme-branding.zip', { type: 'application/zip' });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  imports = [];
  restores = [];
  server.use(
    getGetBrandingSettingsMockHandler(STORED),
    getListBrandingPackageVersionsMockHandler({ versions: [...VERSIONS] }),
    getRestoreBrandingPackageVersionMockHandler(({ params }) => {
      restores.push(String(params['digest']));
      return APPLIED;
    }),
  );
});

afterEach(() => {
  resetGeneratedClient();
  useBrandingDirtyStore.setState({ dirty: false });
  vi.restoreAllMocks();
});

describe('AdminBranding — the branding package (WP9)', () => {
  it('runs the dry run on pick, shows the problems, and withholds Apply with a reason', async () => {
    server.use(importHandler(REFUSED, REFUSED));
    renderBranding();
    await productName();
    const dialog = await openImportDialog();
    expect(within(dialog).getByRole('heading', { name: 'Import branding package' })).toBeInTheDocument();
    pickPackage();

    const problems = await within(dialog).findByTestId('branding-package-problems');
    expect(problems).toHaveTextContent('assets/logo-full.svg');
    expect(problems).toHaveTextContent('the SVG contains a <script> element');
    expect(problems).toHaveTextContent('"brand_hue" must be a six-digit hex colour');
    expect(imports).toEqual(['true']);
    expect(within(dialog).getByTestId('branding-package-apply')).toBeDisabled();
    expect(within(dialog).getByTestId('branding-package-apply-blocked')).toHaveTextContent('The package has problems');
    // The manifest is still shown — the operator can see WHICH package was refused.
    expect(within(dialog).getByTestId('branding-package-manifest')).toHaveTextContent('Globex');
    expect(within(dialog).getByTestId('branding-package-filename')).toHaveTextContent('acme-branding.zip');
  });

  it('enables Apply on a clean dry run, then applies without dry_run, closes and toasts', async () => {
    server.use(importHandler(CLEAN_DRY_RUN, APPLIED));
    renderBranding();
    await productName();
    const dialog = await openImportDialog();
    pickPackage();

    const diff = await within(dialog).findByTestId('branding-package-diff');
    expect(within(diff).getByRole('columnheader', { name: 'Field' })).toBeInTheDocument();
    const nameRow = within(diff).getByTestId('branding-package-diff-product_name');
    expect(nameRow).toHaveTextContent('Acme');
    expect(nameRow).toHaveTextContent('Globex');
    // An empty array reads as inherit; an array as short JSON.
    const facesRow = within(diff).getByTestId('branding-package-diff-font_faces');
    expect(facesRow).toHaveTextContent('inherit');
    expect(facesRow).toHaveTextContent('[{"family":"Inter","url":"assets/inter.woff2"}]');
    expect(within(dialog).getByTestId('branding-package-warnings')).toHaveTextContent('preview/app.html');
    expect(within(dialog).getByTestId('branding-package-manifest')).toHaveTextContent('stage.example');
    expect(within(dialog).queryByTestId('branding-package-problems')).not.toBeInTheDocument();

    const apply = within(dialog).getByTestId('branding-package-apply');
    expect(apply).toBeEnabled();
    await userEvent.click(apply);

    expect(await screen.findByTestId('branding-toast-success')).toHaveTextContent('Branding package applied');
    await waitFor(() => expect(screen.queryByTestId('branding-package-dialog')).not.toBeInTheDocument());
    // The dry run carried the flag; the real import did not.
    expect(imports).toEqual(['true', null]);
  });

  it('shows the transport refusal of a check (413) and withholds Apply', async () => {
    server.use(
      http.post(PACKAGE_PATH, () =>
        HttpResponse.json({ error: 'the upload must be a multipart form under 4 MiB' }, { status: 413 }),
      ),
    );
    renderBranding();
    await productName();
    const dialog = await openImportDialog();
    pickPackage();
    expect(await within(dialog).findByTestId('branding-package-check-error')).toHaveTextContent('under 4 MiB');
    expect(within(dialog).getByTestId('branding-package-apply')).toBeDisabled();
  });

  it('asks before importing over a dirty draft, and discards the draft on confirm', async () => {
    server.use(importHandler(CLEAN_DRY_RUN, APPLIED));
    renderBranding();
    const name = await productName();
    await userEvent.type(name, ' Corp');
    expect(useBrandingDirtyStore.getState().dirty).toBe(true);

    await userEvent.click(screen.getByTestId('branding-package-import'));
    const confirm = await screen.findByTestId('branding-package-confirm');
    expect(within(confirm).getByRole('heading', { name: 'Discard unsaved changes and import?' })).toBeInTheDocument();
    expect(screen.queryByTestId('branding-package-dialog')).not.toBeInTheDocument();

    // Cancel keeps the draft and opens nothing.
    await userEvent.click(within(confirm).getByTestId('branding-package-confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('branding-package-confirm')).not.toBeInTheDocument());
    expect(name).toHaveValue('Acme Corp');

    await userEvent.click(screen.getByTestId('branding-package-import'));
    await userEvent.click((await screen.findByTestId('branding-package-confirm')).querySelector('[data-testid="branding-package-confirm-ok"]') as HTMLElement);
    await screen.findByTestId('branding-package-dialog');
    expect(name).toHaveValue('Acme');
    expect(useBrandingDirtyStore.getState().dirty).toBe(false);
  });

  it('lists the kept versions and restores one after a confirmation', async () => {
    renderBranding();
    await productName();
    const panel = screen.getByTestId('branding-package-versions');
    const first = await within(panel).findByTestId('branding-package-version-0123456789ab');
    expect(first).toHaveTextContent('Globex');
    expect(first).toHaveTextContent('2.0 KiB');
    expect(within(panel).getByTestId('branding-package-version-fedcba987654')).toHaveTextContent('Unnamed');
    expect(within(panel).getByTestId('branding-package-version-fedcba987654')).toHaveTextContent('2.0 MiB');
    expect(within(panel).getByRole('columnheader', { name: 'Digest' })).toBeInTheDocument();

    await userEvent.click(within(first).getByTestId('branding-package-restore-0123456789ab'));
    const confirm = await screen.findByTestId('branding-package-confirm');
    expect(within(confirm).getByRole('heading', { name: 'Restore this branding package?' })).toBeInTheDocument();
    expect(confirm).toHaveTextContent('Globex · 0123456789ab');
    await userEvent.click(within(confirm).getByTestId('branding-package-confirm-ok'));

    expect(await screen.findByTestId('branding-toast-success')).toHaveTextContent('Branding package restored');
    expect(restores).toEqual(['0123456789abcdef0123']);
  });

  it('shows the empty state when nothing is kept, and the server reason when packages are unavailable', async () => {
    server.use(getListBrandingPackageVersionsMockHandler({ versions: [] }));
    renderBranding();
    await productName();
    expect(await screen.findByTestId('branding-package-versions-empty')).toHaveTextContent('No packages have been applied yet.');
  });

  it('names the server reason when the versions route answers 503', async () => {
    server.use(
      http.get(`${PACKAGE_PATH}/versions`, () =>
        HttpResponse.json({ error: 'branding packages are not available on this deployment' }, { status: 503 }),
      ),
    );
    renderBranding();
    await productName();
    expect(await screen.findByTestId('branding-package-versions-error')).toHaveTextContent('not available on this deployment');
  });

  it('downloads the package under the Content-Disposition filename', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    server.use(
      http.get(PACKAGE_PATH, () =>
        new HttpResponse(ZIP_BYTES, {
          status: 200,
          headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="acme-branding.zip"' },
        }),
      ),
    );
    renderBranding();
    await productName();
    await userEvent.click(screen.getByTestId('branding-package-download'));
    await waitFor(() => expect(names).toEqual(['acme-branding.zip']));
    expect(screen.queryByTestId('branding-toast-error')).not.toBeInTheDocument();
  });

  it("toasts the server's reason when the download is refused", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    server.use(
      http.get(PACKAGE_PATH, () =>
        HttpResponse.json({ error: 'branding packages are not available on this deployment' }, { status: 503 }),
      ),
    );
    renderBranding();
    await productName();
    await userEvent.click(screen.getByTestId('branding-package-download'));
    expect(await screen.findByTestId('branding-toast-error')).toHaveTextContent('not available on this deployment');
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
