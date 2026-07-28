import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ToolActionsSelector } from './ToolActionsSelector';

describe('ToolActionsSelector', () => {
  it('renders one chip per available tool, in the accordion view by default', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={['google', 'wiki']}
        onChange={vi.fn()}
      />,
    );
    expect(getByText('Google')).toBeInTheDocument();
    expect(getByText('Wiki')).toBeInTheDocument();
    expect(getByText('Tools')).toBeInTheDocument();
  });

  it('renders flat (no accordion) when shouldUseAccordionView is false', () => {
    const { getByText, queryByRole } = renderWithTheme(
      <ToolActionsSelector
        availableTools={['google']}
        onChange={vi.fn()}
        shouldUseAccordionView={false}
      />,
    );
    expect(getByText('Google')).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument();
  });

  it('calls onChange with the tool added when an unselected chip is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={['google']}
        onChange={onChange}
        selectedTools={[]}
      />,
    );
    await user.click(getByText('Google'));
    expect(onChange).toHaveBeenCalledWith(['google']);
  });

  it('calls onChange with the tool removed when a selected chip is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={['google']}
        onChange={onChange}
        selectedTools={['google']}
      />,
    );
    await user.click(getByText('Google'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows EmptyMcpTools when it is an MCP toolkit with no tools yet', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={[]}
        onChange={vi.fn()}
        isRemoteMcp
      />,
    );
    expect(getByText(/No tools to display for now/)).toBeInTheDocument();
  });

  it('shows a "Load Tools" action for a remote MCP toolkit', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={[]}
        onChange={vi.fn()}
        isRemoteMcp
        canLoadTools
      />,
    );
    expect(getByText('Load Tools')).toBeInTheDocument();
  });

  it('calls onLoadTools when the Load Tools action is clicked and loading is allowed', async () => {
    const user = userEvent.setup();
    const onLoadTools = vi.fn();
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={[]}
        onChange={vi.fn()}
        isRemoteMcp
        canLoadTools
        onLoadTools={onLoadTools}
      />,
    );
    await user.click(getByText('Load Tools'));
    expect(onLoadTools).toHaveBeenCalledTimes(1);
  });

  it('shows "Loading..." while tools are being fetched', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={[]}
        onChange={vi.fn()}
        isRemoteMcp
        isLoadingTools
      />,
    );
    expect(getByText('Loading...')).toBeInTheDocument();
  });

  it('renders extraProperties for a non-MCP toolkit', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={['google']}
        onChange={vi.fn()}
        extraProperties={<div>extra field</div>}
      />,
    );
    expect(getByText('extra field')).toBeInTheDocument();
  });

  it('hides extraProperties for an MCP-like toolkit', () => {
    const { queryByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={[]}
        onChange={vi.fn()}
        isRemoteMcp
        extraProperties={<div>extra field</div>}
      />,
    );
    expect(queryByText('extra field')).not.toBeInTheDocument();
  });

  it('renders the caller-supplied mcpAuthModal slot', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={[]}
        onChange={vi.fn()}
        mcpAuthModal={<div>auth modal</div>}
      />,
    );
    expect(getByText('auth modal')).toBeInTheDocument();
  });

  it('renders a warning chip for a selected tool no longer available', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsSelector
        availableTools={['google']}
        onChange={vi.fn()}
        selectedTools={['stale_tool']}
      />,
    );
    expect(getByText('stale_tool')).toBeInTheDocument();
  });
});
