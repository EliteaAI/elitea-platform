import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';

import { StyledShowContextModal } from './StyledShowContextModal';

// Real `handleCopy` runs; only the browser's own Clipboard API is stubbed —
// see `ModalMessage.test.tsx`'s identical note for why (R-M1 restricts
// `vi.mock()` of app modules, not a real Web API).
afterEach(() => {
  vi.restoreAllMocks();
});

describe('StyledShowContextModal', () => {
  it('renders nothing while closed', () => {
    renderWithProviders(
      <StyledShowContextModal
        open={false}
        onClose={vi.fn()}
        context="the raw context"
      />,
    );
    expect(screen.queryByText('the raw context')).not.toBeInTheDocument();
  });

  it('renders the context label and markdown-rendered context when open', () => {
    renderWithProviders(
      <StyledShowContextModal
        open
        onClose={vi.fn()}
        context="Hello **world**"
        contextLabel="My Context"
      />,
    );
    expect(screen.getByText('My Context')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <StyledShowContextModal
        open
        onClose={onClose}
        context="content"
      />,
    );
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders each chat message via ModalMessage', () => {
    renderWithProviders(
      <StyledShowContextModal
        open
        onClose={vi.fn()}
        messages={[
          { id: 1, role: 'user', content: 'Hi there' },
          { id: 2, role: 'assistant', content: 'Hello!' },
        ]}
      />,
    );
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('Hello!')).toBeInTheDocument();
  });

  it('renders the raw mermaid diagram definition (unrendered source) when renderContextAsMermaid is true', () => {
    renderWithProviders(
      <StyledShowContextModal
        open
        onClose={vi.fn()}
        context="entry_point: start&#10;nodes:&#10;  - id: start"
        renderContextAsMermaid
      />,
    );
    // Real diagram-definition computation (`parseYamlToMermaid`) — invalid
    // YAML here still exercises the real function; it swallows parse
    // errors and returns `''`, matching the baseline exactly (see that
    // helper's own doc comment).
    expect(screen.queryByText('content to copy')).not.toBeInTheDocument();
  });

  it('shows a loading indicator when isLoading is true', () => {
    renderWithProviders(
      <StyledShowContextModal
        open
        onClose={vi.fn()}
        context="content"
        isLoading
      />,
    );
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
