import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterSocketAndProject } from '../../__tests__/testUtils';
import { ToolCustom } from './ToolCustom';

const TOOLKIT_TYPES_URL = '/api/v2/elitea_core/toolkits/prompt_lib/:projectId';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(http.get(TOOLKIT_TYPES_URL, () => HttpResponse.json({})));
});

afterEach(() => {
  resetGeneratedClient();
});

describe('ToolCustom', () => {
  it('renders the JSON label and the initial serialized value', async () => {
    const { getByText, container } = renderWithRouterSocketAndProject(
      <ToolCustom
        editToolDetail={{ name: 'my-tool', description: 'desc', settings: { url: 'x' }, type: 'custom' }}
        setToolErrors={vi.fn()}
      />,
      'proj-1',
    );
    await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
    expect(container.textContent).toContain('my-tool');
  });

  it('calls setToolErrors with a name error when nameIsRequired and name is blank', async () => {
    const setToolErrors = vi.fn();
    renderWithRouterSocketAndProject(
      <ToolCustom
        editToolDetail={{ name: '', settings: {}, type: 'custom' }}
        setToolErrors={setToolErrors}
      />,
      'proj-1',
    );
    await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
    const updater = setToolErrors.mock.calls[0]?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
    expect(updater({}).name).toBe(true);
  });

  it('does not flag a name error when the type has a schema-flagged toolkit_name property (name not required)', async () => {
    server.use(
      http.get(TOOLKIT_TYPES_URL, () => HttpResponse.json({ mcp: { properties: { url: { toolkit_name: true } }, name_required: false } })),
    );
    const setToolErrors = vi.fn();
    renderWithRouterSocketAndProject(
      <ToolCustom
        editToolDetail={{ settings: { url: 'x' }, type: 'mcp' }}
        setToolErrors={setToolErrors}
      />,
      'proj-1',
    );
    // The FIRST `setToolErrors` call reflects the transient pre-fetch state
    // (`toolkitSchemas` still `undefined`, `useToolkitNameProp`'s own
    // `schemaFor` default -> `nameIsRequired: true`), before the mocked
    // `name_required: false` schema has resolved — asserting on `calls[0]`
    // would race the fetch instead of testing the settled behaviour. Waiting
    // for the LAST call's computed value to flip to `false` (matching the
    // effect's own `[..., nameIsRequired, ...]` dependency, which re-runs
    // once the schema settles) asserts the real, resolved outcome.
    await waitFor(() => {
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).name).toBe(false);
    });
  });

  it('invokes onCopy with the current JSON string when the copy button is clicked', async () => {
    // `userEvent.setup()` installs its own `navigator.clipboard` stub
    // (`@testing-library/user-event`'s `Clipboard.attachClipboardStubToView`)
    // — jsdom itself has no `navigator.clipboard`, and a plain DOM `.click()`
    // would fall through `shared/lib/clipboard.ts`'s `handleCopy` all the
    // way to its documented, preserved-quirk final fallback (that file's own
    // doc comment: an unawaited `navigator.clipboard.writeText(text)` inside
    // a bare `catch`, which throws synchronously on `undefined` and surfaces
    // as an unhandled rejection in jsdom) — same convention
    // `CopyToClipboardButton.test.tsx`'s own doc comment already documents
    // for this exact class of button.
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const { getByRole } = renderWithRouterSocketAndProject(
      <ToolCustom
        editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
        setToolErrors={vi.fn()}
        onCopy={onCopy}
      />,
      'proj-1',
    );
    await waitFor(() => expect(getByRole('button')).toBeInTheDocument());
    await user.click(getByRole('button'));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy.mock.calls[0]?.[0]).toContain('my-tool');
  });
});
