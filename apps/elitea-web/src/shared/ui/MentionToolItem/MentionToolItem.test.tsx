import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { MentionToolItem } from '.';

describe('MentionToolItem', () => {
  it('renders the label', () => {
    const { getByText } = renderWithTheme(<MentionToolItem label="search_web" />);
    expect(getByText('search_web')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    const { getByText } = renderWithTheme(
      <MentionToolItem
        label="search_web"
        description="Searches the web"
      />,
    );
    expect(getByText('Searches the web')).toBeInTheDocument();
  });

  it('omits the description when not provided', () => {
    const { queryByText } = renderWithTheme(<MentionToolItem label="search_web" />);
    expect(queryByText('Searches the web')).not.toBeInTheDocument();
  });

  it('renders the icon when provided', () => {
    const { getByTestId } = renderWithTheme(
      <MentionToolItem
        label="search_web"
        icon={<span data-testid="tool-icon">icon</span>}
      />,
    );
    expect(getByTestId('tool-icon')).toBeInTheDocument();
  });

  it('omits the icon wrapper when not provided', () => {
    const { queryByTestId } = renderWithTheme(<MentionToolItem label="search_web" />);
    expect(queryByTestId('tool-icon')).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const { getByText } = renderWithTheme(
      <MentionToolItem
        label="search_web"
        onClick={onClick}
      />,
    );
    getByText('search_web').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a real button, reachable and activatable by keyboard', () => {
    const { getByRole } = renderWithTheme(<MentionToolItem label="search_web" />);
    const button = getByRole('button');
    expect(button.tagName).toBe('BUTTON');
  });

  it('marks the highlighted row with data-highlighted', () => {
    const { getByRole, rerender } = renderWithTheme(
      <MentionToolItem
        label="search_web"
        isHighlighted
      />,
    );
    expect(getByRole('button').getAttribute('data-highlighted')).toBe('true');

    rerender(<MentionToolItem label="search_web" />);
    expect(getByRole('button').getAttribute('data-highlighted')).toBeNull();
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithTheme(
      <MentionToolItem
        label="search_web"
        data-testid="tool-item"
      />,
    );
    expect(getByTestId('tool-item')).toBeInTheDocument();
  });
});
