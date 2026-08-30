/**
 * DEFECT: `IconPlaceholder` rendered `<img src={url}>` with no error handler.
 *
 * The component has a fallback — the first letter of the icon name — but the
 * `if (url)` branch is taken whenever a url is present, so a url that answers
 * 404 left a permanent broken-image box and the fallback never ran. The
 * default-icon catalogue served exactly such urls (`/icons/robot.svg`, which no
 * route serves), and a deleted or expired uploaded icon produces the same
 * result.
 *
 * The test loads an uploaded icon whose url fails, fires the image's `error`
 * event, and asserts the letter glyph replaces it. Before the fix the letter
 * never appears.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { HttpResponse, http } from 'msw';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../../test/setup';

import { ProjectIconDialog } from './ProjectIconDialog';

const BASE = '/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderDialog(): void {
  configureGeneratedClient({ baseUrl: BASE });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <ProjectIconDialog
          open
          onClose={() => {}}
          projectId="1"
          projectName="Demo"
          selectedIcon={{ name: 'wrench', url: 'https://example.invalid/wrench.svg' }}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('ProjectIconDialog icon fallback', () => {
  it('shows the initial-letter glyph when an icon url fails to load', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/default_icons/prompt_lib/1`, () => HttpResponse.json([])),
      http.get(`${BASE}/elitea_core/project_icon/prompt_lib/1`, () =>
        HttpResponse.json({
          rows: [{ name: 'wrench', url: 'https://example.invalid/wrench.svg' }],
          total: 1,
        }),
      ),
    );

    renderDialog();

    const image = await screen.findByAltText('wrench');
    // jsdom never loads a remote image, so the browser's own error event is
    // simulated here. It is the same event a 404 produces.
    fireEvent.error(image);

    await waitFor(() => {
      expect(screen.queryByAltText('wrench')).toBeNull();
    });
    expect(screen.getByText('W')).toBeTruthy();
  });
});

/**
 * The selection callback used to hand the parent the icon's NAME and nothing
 * else, and the parent PUT that name as the whole `icon_meta`. The header
 * renders `icon_meta.url`, so the stored row was unusable the moment it became
 * storable — a second silent no-op waiting behind the first.
 *
 * This test fails against the name-only callback: it asserts the url is there.
 */
describe('ProjectIconDialog selection payload', () => {
  it('reports the selected icon url alongside its name', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/default_icons/prompt_lib/1`, () => HttpResponse.json([])),
      http.get(`${BASE}/elitea_core/project_icon/prompt_lib/1`, () =>
        HttpResponse.json({
          rows: [{ name: 'pi_abc.png', url: '/icons/1/pi_abc.png' }],
          total: 1,
        }),
      ),
    );

    const onIconSelect = vi.fn();
    configureGeneratedClient({ baseUrl: BASE });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          <ProjectIconDialog
            open
            onClose={() => {}}
            onIconSelect={onIconSelect}
            projectId="1"
            projectName="Demo"
            selectedIcon={null}
          />
        </QueryClientProvider>
      </ThemeProvider>,
    );

    await userEvent.click(await screen.findByAltText('pi_abc.png'));

    expect(onIconSelect).toHaveBeenCalledWith({
      name: 'pi_abc.png',
      url: '/icons/1/pi_abc.png',
    });
  });
});
