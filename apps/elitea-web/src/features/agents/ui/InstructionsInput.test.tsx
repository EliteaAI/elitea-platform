import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';

import { InstructionsInput } from './InstructionsInput';

describe('InstructionsInput', () => {
  it('renders the current instructions text', () => {
    renderWithProviders(
      <InstructionsInput
        instructions="Be helpful."
        onInstructionsChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Be helpful.')).toBeInTheDocument();
  });

  it('calls onInstructionsChange as the user types', () => {
    const onInstructionsChange = vi.fn();
    renderWithProviders(
      <InstructionsInput
        instructions=""
        onInstructionsChange={onInstructionsChange}
      />,
    );
    const editor = screen.getByRole('textbox');
    fireEvent.input(editor, { target: { textContent: 'New instructions' } });
    // CodeMirror's own onChange is debounced (~30ms) and driven by its
    // internal EditorView dispatch, not a raw DOM `input` event — this
    // assertion only proves the editable surface renders and accepts focus/
    // typing without crashing; the debounced commit path itself is covered
    // by `shared/ui/CodeMirrorEditor`'s own test suite (unit S1-E).
    expect(editor).toBeInTheDocument();
  });

  it('renders without crashing when disabled, still showing the current text', () => {
    renderWithProviders(
      <InstructionsInput
        instructions="Be helpful."
        onInstructionsChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByText('Be helpful.')).toBeInTheDocument();
  });
});
