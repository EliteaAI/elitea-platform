/**
 * These go through msw and the real catalogue reader rather than stubbing
 * `useListModelsQuery`, because two of the things worth pinning live in the
 * adaptation between the wire and the control: `model_project_id` has to
 * leave as a JSON number whichever way the catalogue spelled `project_id`
 * (the TS type says `string`, the Go handler marshals an int32), and the
 * catalogue's `supports_reasoning` flag has to reach the profile writer,
 * since it is what decides whether `temperature` may appear at all. A test
 * that mocks the query hook asserts only that this file forwards its own
 * fixtures.
 *
 * The mount-emits-nothing case is the one that protects today's working
 * behaviour: a version with no `llm_settings` runs on the project catalogue
 * default, and rendering that default must not quietly author it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { server } from '@/test/setup';

import { AgentModelSettings } from './AgentModelSettings';

const BASE = '/api/v2';
const PROJECT_ID = '17';

const CATALOGUE = {
  items: [
    // `project_id` as a string here and a number below on purpose — the
    // catalogue answers with an int32 while `ConfigModel` declares a string.
    { name: 'gpt-4o', display_name: 'GPT-4o', project_id: '17', default: true },
    { name: 'o3-mini', display_name: 'O3 Mini', project_id: 17, supports_reasoning: true },
  ],
  default_model_name: 'gpt-4o',
};

function serveCatalogue(): void {
  server.use(http.get(`${BASE}/configurations/models/${PROJECT_ID}`, () => HttpResponse.json(CATALOGUE)));
}

function renderPicker(props: Partial<Parameters<typeof AgentModelSettings>[0]> = {}): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithTheme(
    <QueryClientProvider client={queryClient}>
      <AgentModelSettings
        projectId={PROJECT_ID}
        value={undefined}
        onChange={onChange}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onChange };
}

/** Opens the model menu and clicks one of its rows by its catalogue display name. */
async function chooseModel(displayName: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('model-selector-name'));
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(displayName) }));
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  serveCatalogue();
});

afterEach(() => {
  resetGeneratedClient();
});

describe('AgentModelSettings', () => {
  it("shows the project's default model for a version that pins none, and authors nothing for it", async () => {
    const { onChange } = renderPicker();

    expect(await screen.findByText('GPT-4o')).toBeInTheDocument();
    // The whole point: `llm_settings: {}` still falls back to this model
    // server-side, so merely rendering it must not turn the fallback into a
    // pinned value the user never chose.
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });

  it('lists the whole catalogue and checks the row it is currently on', async () => {
    renderPicker();
    await screen.findByText('GPT-4o');
    await userEvent.setup().click(screen.getByTestId('model-selector-name'));

    const rows = await screen.findAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('GPT-4o'), expect.stringContaining('O3 Mini')]);
    expect(rows[0]).toHaveClass('Mui-selected');
    expect(rows[1]).not.toHaveClass('Mui-selected');
  });

  it('shows the version’s own model rather than the default when it pins one', async () => {
    renderPicker({ value: { model_name: 'o3-mini', model_project_id: 17, max_tokens: -1 } });

    expect(await screen.findByText('O3 Mini')).toBeInTheDocument();
  });

  it('emits the model name and a NUMERIC project id when a model is chosen', async () => {
    const { onChange } = renderPicker();
    await screen.findByText('GPT-4o');

    await chooseModel('O3 Mini');

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(emitted['model_name']).toBe('o3-mini');
    expect(emitted['model_project_id']).toBe(17);
    expect(typeof emitted['model_project_id']).toBe('number');
  });

  it('omits temperature for a reasoning model', async () => {
    const { onChange } = renderPicker();
    await screen.findByText('GPT-4o');

    await chooseModel('O3 Mini');

    expect(onChange.mock.calls[0]?.[0]).not.toHaveProperty('temperature');
  });

  it('writes temperature and never reasoning_effort for a model that does not reason', async () => {
    const { onChange } = renderPicker({ value: { model_name: 'o3-mini', model_project_id: 17, max_tokens: -1 } });
    await screen.findByText('O3 Mini');

    await chooseModel('GPT-4o');

    const emitted = onChange.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(emitted['temperature']).toBe(0.6);
    expect(emitted).not.toHaveProperty('reasoning_effort');
  });

  it('disables both controls when there is no project to read a catalogue from', () => {
    renderPicker({ projectId: undefined });

    expect(screen.getByTestId('model-selector-name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'model settings menu' })).toBeDisabled();
  });

  it('disables both controls when the caller says the version is read-only', async () => {
    renderPicker({ disabled: true });

    expect(await screen.findByTestId('model-selector-name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'model settings menu' })).toBeDisabled();
  });
});
