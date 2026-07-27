import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { InputActionsToolbar } from '.';

describe('InputActionsToolbar', () => {
  it('renders the full-screen action even with no value', () => {
    const { getByRole } = renderWithTheme(<InputActionsToolbar />);
    expect(getByRole('button', { name: 'Full screen view' })).toBeInTheDocument();
  });

  it('hides the copy action when there is no value', () => {
    const { queryByRole } = renderWithTheme(<InputActionsToolbar value="" />);
    expect(queryByRole('button', { name: 'Copy to clipboard' })).toBeNull();
  });

  it('hides the expand action when there is no value', () => {
    const { queryByRole } = renderWithTheme(<InputActionsToolbar value="" />);
    expect(queryByRole('button', { name: 'Expand field' })).toBeNull();
  });

  it('shows copy and expand actions once a value is present', () => {
    const { getByRole } = renderWithTheme(<InputActionsToolbar value="hello" />);
    expect(getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Expand field' })).toBeInTheDocument();
  });

  it('calls onCopy when the copy button is clicked', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const { getByRole } = renderWithTheme(
      <InputActionsToolbar
        value="hello"
        onCopy={onCopy}
      />,
    );
    await user.click(getByRole('button', { name: 'Copy to clipboard' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('calls onFullScreen when the full-screen button is clicked', async () => {
    const user = userEvent.setup();
    const onFullScreen = vi.fn();
    const { getByRole } = renderWithTheme(<InputActionsToolbar onFullScreen={onFullScreen} />);
    await user.click(getByRole('button', { name: 'Full screen view' }));
    expect(onFullScreen).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleExpand when the expand button is clicked', async () => {
    const user = userEvent.setup();
    const onToggleExpand = vi.fn();
    const { getByRole } = renderWithTheme(
      <InputActionsToolbar
        value="hello"
        onToggleExpand={onToggleExpand}
      />,
    );
    await user.click(getByRole('button', { name: 'Expand field' }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it('shows a "Collapse field" label and icon once expanded', () => {
    const { getByRole, queryByRole } = renderWithTheme(
      <InputActionsToolbar
        value="hello"
        isExpanded
      />,
    );
    expect(getByRole('button', { name: 'Collapse field' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Expand field' })).toBeNull();
  });

  it('respects the show*Action flags to hide individual actions', () => {
    const { queryByRole } = renderWithTheme(
      <InputActionsToolbar
        value="hello"
        showCopyAction={false}
        showExpandAction={false}
        showFullScreenAction={false}
      />,
    );
    expect(queryByRole('button')).toBeNull();
  });
});
