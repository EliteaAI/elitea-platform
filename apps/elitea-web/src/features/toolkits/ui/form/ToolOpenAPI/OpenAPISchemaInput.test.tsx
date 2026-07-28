import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { OpenAPISchemaInput } from './OpenAPISchemaInput';

const VALID_SCHEMA = JSON.stringify({ paths: { '/users': { get: {} } } });

describe('OpenAPISchemaInput', () => {
  it('renders the "Schema" accordion title', () => {
    const { getByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={undefined}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
      />,
    );
    expect(getByText('Schema')).toBeInTheDocument();
  });

  it('shows the placeholder + choose-file link when there is no value, once expanded', () => {
    const { getByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={undefined}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    expect(getByText('choose file')).toBeInTheDocument();
  });

  it('shows the helperText when error is true', () => {
    const { getByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
        error
        helperText="Invalid schema"
      />,
    );
    fireEvent.click(getByText('Schema'));
    expect(getByText('Invalid schema')).toBeInTheDocument();
  });

  it('hides the helperText when error is false, even if helperText is supplied', () => {
    const { getByText, queryByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
        helperText="Invalid schema"
      />,
    );
    fireEvent.click(getByText('Schema'));
    expect(queryByText('Invalid schema')).not.toBeInTheDocument();
  });

  it('opens the full-screen modal when the full-screen button is clicked', () => {
    const { getByText, getByRole } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    // The full-screen button's wrapper (`fullScreenWrapperSx`) is
    // `display: 'none'` until the editor area is hovered (`'&:hover': {'&
    // [aria-label="full-scrn-btn"]': {display: 'block'}}`) — a real,
    // baseline-matching hover-reveal affordance, not a bug. jsdom has no
    // `:hover` pseudo-class engine (synthetic `mouseOver`/`mouseEnter`
    // events never flip that CSS rule), so `getByRole`'s default
    // accessible-only query never finds it; `{ hidden: true }` is
    // testing-library's own documented escape hatch for exactly this class
    // of CSS-hidden-but-present element — this test exercises "clicking it
    // opens the modal", not the hover mechanic itself (jsdom cannot exercise
    // that regardless of query option).
    fireEvent.click(getByRole('button', { name: 'Full screen view', hidden: true }));
    expect(getByRole('dialog')).toBeInTheDocument();
  });
});
