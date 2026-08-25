/**
 * The icon-edit control of `ProjectParamsHeader` is an icon-only `IconButton`.
 *
 * `EditIcon` renders an `<svg>` with no text, so the button had an empty
 * accessible name. It overlaps the project avatar, so a screen reader
 * announced a bare "button" and gave no clue about what it edits.
 *
 * This test queries the control by its accessible name. It fails if the
 * `aria-label` goes away again.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../../test/setup';

import { ProjectParamsHeader } from './ProjectParamsHeader';

const BASE = '/api/v2';
const EDIT_LABEL = 'Edit the project icon';

function renderHeader(canEdit: boolean): void {
  configureGeneratedClient({ baseUrl: BASE });
  server.use(
    http.get(`${BASE}/elitea_core/project_info/prompt_lib/1/project-info`, () =>
      HttpResponse.json({ name: 'Demo', icon_meta: null, teammates_count: 3 }),
    ),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (ui: ReactNode): ReactNode => (
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
  renderWithTheme(
    <>
      {wrap(
        <ProjectParamsHeader
          projectId="1"
          projectName="Demo"
          canEdit={canEdit}
          onIconChange={vi.fn()}
        />,
      )}
    </>,
  );
}

describe('ProjectParamsHeader', () => {
  it('names the icon-edit control and opens the icon dialog', async () => {
    renderHeader(true);

    await userEvent.click(await screen.findByRole('button', { name: EDIT_LABEL }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('renders no icon-edit control without edit permission', () => {
    renderHeader(false);

    expect(screen.queryByRole('button', { name: EDIT_LABEL })).not.toBeInTheDocument();
  });
});
