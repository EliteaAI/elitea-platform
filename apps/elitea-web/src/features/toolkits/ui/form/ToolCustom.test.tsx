import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { server } from '@/test/setup';

import { getListToolkitsQueryKey } from '@/shared/api/generated/toolkits/toolkits';

import { createTestQueryClient, renderWithRouterSocketAndProject } from '../../__tests__/testUtils';
import { ToolCustom } from './ToolCustom';

installCodeMirrorTestPolyfills();

const TOOLKIT_TYPES_URL = '/api/v2/elitea_core/toolkits/prompt_lib/:projectId';

/** The document's real `role="textbox"` element — mirrors `CodeMirrorEditor.test.tsx`'s own helper. */
function getCodeMirrorContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
  return content;
}

/**
 * Replaces the whole editor document with `json` via select-all + paste —
 * NOT per-keystroke `type`: CM6's `closeBrackets` extension auto-inserts a
 * matching `}`/`"` per keystroke, which corrupts a character-by-character
 * JSON retype (same fix `pages/toolkits/EditToolkit.test.tsx`'s own doc
 * comment already documents for this exact class of edit).
 */
async function replaceEditorContent(user: ReturnType<typeof userEvent.setup>, container: HTMLElement, json: string): Promise<HTMLElement> {
  const content = getCodeMirrorContent(container);
  await user.click(content);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste(json);
  return content;
}

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

  describe('computeValidationOutcome (JSON-editor effect)', () => {
    it('shows "Toolkit must have settings field" and skips write-back when the edited JSON has no settings key', async () => {
      const user = userEvent.setup();
      const setEditToolDetail = vi.fn();
      const { getByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
          setToolErrors={vi.fn()}
          setEditToolDetail={setEditToolDetail}
        />,
        'proj-1',
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      setEditToolDetail.mockClear();
      await replaceEditorContent(user, container, JSON.stringify({ name: 'my-tool', type: 'custom' }));
      await waitFor(() => expect(getByText('Toolkit must have settings field')).toBeInTheDocument());
      expect(setEditToolDetail).not.toHaveBeenCalled();
    });

    it('shows "name is required" when settings are present but name is missing/blank and the type has no dedicated toolkit_name field', async () => {
      const user = userEvent.setup();
      const { getByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
          setToolErrors={vi.fn()}
        />,
        'proj-1',
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      await replaceEditorContent(user, container, JSON.stringify({ type: 'custom', settings: { url: 'x' } }));
      await waitFor(() => expect(getByText('name is required')).toBeInTheDocument());
    });

    it('shows "Invalid JSON format" and skips write-back when the edited text does not parse', async () => {
      const user = userEvent.setup();
      const setEditToolDetail = vi.fn();
      const { getByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
          setToolErrors={vi.fn()}
          setEditToolDetail={setEditToolDetail}
        />,
        'proj-1',
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      setEditToolDetail.mockClear();
      await replaceEditorContent(user, container, '{not valid json');
      await waitFor(() => expect(getByText('Invalid JSON format')).toBeInTheDocument());
      expect(setEditToolDetail).not.toHaveBeenCalled();
    });

    it('clears the error and writes the parsed object back via setEditToolDetail when no schema is registered for the type (realSchema undefined)', async () => {
      const user = userEvent.setup();
      const setEditToolDetail = vi.fn();
      const { getByText, queryByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
          setToolErrors={vi.fn()}
          setEditToolDetail={setEditToolDetail}
        />,
        'proj-1',
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      await replaceEditorContent(user, container, JSON.stringify({ name: 'renamed', type: 'custom', settings: { url: 'y' } }));
      await waitFor(() => expect(setEditToolDetail).toHaveBeenCalled());
      expect(queryByText('Invalid JSON format')).not.toBeInTheDocument();
      expect(queryByText('Toolkit must have settings field')).not.toBeInTheDocument();
      const lastObj = setEditToolDetail.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(lastObj).toMatchObject({ name: 'renamed', type: 'custom', settings: { url: 'y' } });
    });

    it('calls editField for every key of the parsed object when an editField prop is supplied', async () => {
      const user = userEvent.setup();
      const editField = vi.fn();
      const { getByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
          setToolErrors={vi.fn()}
          editField={editField}
        />,
        'proj-1',
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      await replaceEditorContent(user, container, JSON.stringify({ name: 'renamed', type: 'custom', settings: { url: 'y' } }));
      await waitFor(() => expect(editField).toHaveBeenCalledWith('settings', { url: 'y' }, true));
      expect(editField).toHaveBeenCalledWith('name', 'renamed', true);
      expect(editField).toHaveBeenCalledWith('type', 'custom', true);
    });

    it('reports a schema-driven "These settings are required" error when the type has a matching, unsatisfied schema', async () => {
      server.use(
        http.get(TOOLKIT_TYPES_URL, () =>
          HttpResponse.json({ custom: { required: ['api_key'], properties: { api_key: { type: 'string' } } } }),
        ),
      );
      const user = userEvent.setup();
      const { getByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
          setToolErrors={vi.fn()}
        />,
        'proj-1',
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      await replaceEditorContent(user, container, JSON.stringify({ name: 'my-tool', type: 'custom', settings: { url: 'x' } }));
      await waitFor(() => expect(getByText('These settings are required: api_key')).toBeInTheDocument());
    });

    it('shows no error once the schema-required field is present in the edited settings', async () => {
      server.use(
        http.get(TOOLKIT_TYPES_URL, () =>
          HttpResponse.json({ custom: { required: ['api_key'], properties: { api_key: { type: 'string' } } } }),
        ),
      );
      const user = userEvent.setup();
      const { getByText, queryByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
          setToolErrors={vi.fn()}
        />,
        'proj-1',
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      await replaceEditorContent(user, container, JSON.stringify({ name: 'my-tool', type: 'custom', settings: { url: 'x', api_key: 'k' } }));
      await waitFor(() => expect(queryByText(/These settings are required/)).not.toBeInTheDocument());
    });

    it('builds the initial JSON without name/description when the type has a dedicated toolkit_name field already cached at mount time', async () => {
      // `buildInitialJson`'s `toolkitNameProp`-truthy branch is only
      // reachable when `useGetCurrentToolkitSchemas`' data is already
      // resolved SYNCHRONOUSLY on the very first render (the `useState(()
      // => buildInitialJson(...))` initializer runs exactly once, at mount
      // — a schema that only arrives via the async MSW round-trip lands
      // strictly after that first render, same as production's own
      // cache-miss case). Real production hits this via TanStack Query's
      // synchronous cache-read for an already-fetched, unstale query key
      // (e.g. a second toolkit form mounted after the catalogue was
      // already loaded) — reproduced here by seeding the SAME query key
      // `getListToolkitsQueryKey` uses, on the same `QueryClient`, before
      // ever rendering `ToolCustom`.
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(getListToolkitsQueryKey('proj-1'), {
        data: { mcp: { properties: { url: { toolkit_name: true } }, name_required: false } },
        status: 200,
        headers: new Headers(),
      });
      const { getByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'outer-name', description: 'outer-desc', settings: { url: 'x' }, type: 'mcp' }}
          setToolErrors={vi.fn()}
        />,
        'proj-1',
        queryClient,
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      const content = getCodeMirrorContent(container);
      expect(content.textContent).not.toContain('outer-name');
      expect(content.textContent).toContain('"url"');
    });

    it('does not re-trigger the write-back effect when the edited text round-trips back to the original document', async () => {
      const user = userEvent.setup();
      const setEditToolDetail = vi.fn();
      const original = { name: 'my-tool', description: undefined, settings: { url: 'x' }, type: 'custom' };
      const { getByText, container } = renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'my-tool', settings: { url: 'x' }, type: 'custom' }}
          setToolErrors={vi.fn()}
          setEditToolDetail={setEditToolDetail}
        />,
        'proj-1',
      );
      await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
      setEditToolDetail.mockClear();
      // The exact same serialized document `buildInitialJson` itself produces —
      // `originalJsonString !== jsonString` stays false, so the write-back
      // guard short-circuits even though the text was "edited".
      await replaceEditorContent(user, container, JSON.stringify(original, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(setEditToolDetail).not.toHaveBeenCalled();
    });
  });

  describe('computeRequiredPropertiesError (settings-prop effect)', () => {
    it('flags a missing top-level required string field (falsy check)', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: {}, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{ required: ['api_key'], properties: { api_key: { type: 'string' } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).api_key).toBe(true);
    });

    it('does not flag a present top-level required string field', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: { api_key: 'present' }, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{ required: ['api_key'], properties: { api_key: { type: 'string' } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).api_key).toBe(false);
    });

    it('flags a required boolean field only when it is null/undefined, not when it is explicitly false', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: { verify_ssl: false }, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{ required: ['verify_ssl'], properties: { verify_ssl: { type: 'boolean' } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      // `false` is a real, present value for a boolean field — not an error.
      expect(updater({}).verify_ssl).toBe(false);
    });

    it('flags a required boolean field that is missing entirely', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: {}, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{ required: ['verify_ssl'], properties: { verify_ssl: { type: 'boolean' } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).verify_ssl).toBe(true);
    });

    it('in manual mode (no configuration_title), always marks configurationSchema-required fields as satisfied (false)', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: {}, type: 'custom' }}
          setToolErrors={setToolErrors}
          configurationSchema={{ required: ['cred_field'], properties: { cred_field: { type: 'string' } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).cred_field).toBe(false);
    });

    it('treats configuration_title=Manual_Title the same as absent (manual mode)', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: { configuration_title: 'Manual_Title' }, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{ required: ['api_key'], properties: { api_key: { type: 'string' } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).api_key).toBe(true);
    });

    it('in configuration mode (a non-Manual configuration_title is set), trusts the base schema (never flags it) and checks only configurationSchema', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: { configuration_title: 'My Saved Config' }, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{ required: ['api_key'], properties: { api_key: { type: 'string' } } }}
          configurationSchema={{ required: ['cred_field'], properties: { cred_field: { type: 'string' } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).api_key).toBe(false);
      expect(updater({}).cred_field).toBe(true);
    });

    it('in configuration mode, flags a missing configurationSchema-required boolean field via the null/undefined check', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: { configuration_title: 'My Saved Config' }, type: 'custom' }}
          setToolErrors={setToolErrors}
          configurationSchema={{ required: ['verify_ssl'], properties: { verify_ssl: { type: 'boolean' } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).verify_ssl).toBe(true);
    });

    it('flags the fields of a required metadata section\'s first subsection when none of its subsections are populated', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: {}, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{
            metadata: {
              sections: {
                auth: {
                  required: true,
                  subsections: [{ fields: ['token'] }, { fields: ['user', 'pass'] }],
                },
              },
            },
          }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({})).toMatchObject({ token: true });
    });

    it('selects the FIRST populated subsection of a required metadata section, flagging only that subsection\'s missing fields', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: { user: 'u' }, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{
            metadata: {
              sections: {
                auth: {
                  required: true,
                  subsections: [{ fields: ['token'] }, { fields: ['user', 'pass'] }],
                },
              },
            },
          }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      const result = updater({});
      // The `user`+`pass` subsection is populated (has `user`) so it is
      // selected — `pass` (missing) is flagged, `token` (the OTHER
      // subsection, not selected) is not present in the error map at all.
      expect(result.pass).toBe(true);
      expect(result.token).toBeUndefined();
    });

    it('treats an explicit 0 in a required section field as present, not missing', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: { retries: 0 }, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{ metadata: { sections: { auth: { required: true, subsections: [{ fields: ['retries'] }] } } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).retries).toBe(false);
    });

    it('skips metadata-section required checks entirely when needToCheckSection is false', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: {}, type: 'custom' }}
          setToolErrors={setToolErrors}
          needToCheckSection={false}
          schema={{ metadata: { sections: { auth: { required: true, subsections: [{ fields: ['token'] }] } } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).token).toBeUndefined();
    });

    it('ignores a non-required metadata section entirely', async () => {
      const setToolErrors = vi.fn();
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: 'x', settings: {}, type: 'custom' }}
          setToolErrors={setToolErrors}
          schema={{ metadata: { sections: { auth: { required: false, subsections: [{ fields: ['token'] }] } } } }}
        />,
        'proj-1',
      );
      await waitFor(() => expect(setToolErrors).toHaveBeenCalled());
      const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
      expect(updater({}).token).toBeUndefined();
    });

    it('flags the name field when nameIsRequired resolves true and the name is blank/whitespace-only', async () => {
      const setToolErrors = vi.fn();
      server.use(http.get(TOOLKIT_TYPES_URL, () => HttpResponse.json({ custom: { name_required: true } })));
      renderWithRouterSocketAndProject(
        <ToolCustom
          editToolDetail={{ name: '   ', settings: {}, type: 'custom' }}
          setToolErrors={setToolErrors}
        />,
        'proj-1',
      );
      await waitFor(() => {
        const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
        expect(updater({}).name).toBe(true);
      });
    });
  });
});
