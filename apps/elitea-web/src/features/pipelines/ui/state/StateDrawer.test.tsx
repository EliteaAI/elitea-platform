import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';

import { StateDrawer } from './StateDrawer';

describe('StateDrawer', () => {
  it('renders nothing when closed', () => {
    renderWithTheme(
      <StateDrawer
        isOpen={false}
        onClose={vi.fn()}
        setYamlJsonObject={vi.fn()}
        yamlJsonObject={{}}
      />,
    );
    expect(screen.queryByText('STATE')).not.toBeInTheDocument();
  });

  it('renders the header and default rows when open', () => {
    renderWithTheme(
      <StateDrawer
        isOpen
        onClose={vi.fn()}
        setYamlJsonObject={vi.fn()}
        yamlJsonObject={{}}
      />,
    );
    expect(screen.getByText('STATE')).toBeInTheDocument();
    expect(screen.getByText('input')).toBeInTheDocument();
    expect(screen.getByText('messages')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderWithTheme(
      <StateDrawer
        isOpen
        onClose={onClose}
        setYamlJsonObject={vi.fn()}
        yamlJsonObject={{}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('adds a new state variable, merging it into the existing document state', () => {
    const setYamlJsonObject = vi.fn<(document: YamlPipelineDocument) => void>();
    const yamlJsonObject: YamlPipelineDocument = { state: { input: { type: 'str' }, messages: { type: 'list' } } };
    renderWithTheme(
      <StateDrawer
        isOpen
        onClose={vi.fn()}
        setYamlJsonObject={setYamlJsonObject}
        yamlJsonObject={yamlJsonObject}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Context' }));
    const input = screen.getByPlaceholderText('name');
    fireEvent.change(input, { target: { value: 'counter' } });
    fireEvent.blur(input);

    const updatedDocument = setYamlJsonObject.mock.calls[0]?.[0] as YamlPipelineDocument;
    expect(updatedDocument.state?.['counter']).toMatchObject({ type: 'str' });
  });

  it('toggles the messages row off, removing it from state', () => {
    const setYamlJsonObject = vi.fn<(document: YamlPipelineDocument) => void>();
    const yamlJsonObject: YamlPipelineDocument = { state: { input: { type: 'str' }, messages: { type: 'list' } } };
    renderWithTheme(
      <StateDrawer
        isOpen
        onClose={vi.fn()}
        setYamlJsonObject={setYamlJsonObject}
        yamlJsonObject={yamlJsonObject}
      />,
    );

    const toggles = screen.getAllByRole('switch');
    fireEvent.click(toggles[1] as HTMLElement);

    const updatedDocument = setYamlJsonObject.mock.calls[0]?.[0] as YamlPipelineDocument;
    expect(Object.keys(updatedDocument.state ?? {})).not.toContain('messages');
  });
});
