import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ToolActionsItems } from './ToolActionsItems';

const OPTIONS = [
  { value: 'google', label: 'Google' },
  { value: 'wiki', label: 'Wiki' },
];

describe('ToolActionsItems', () => {
  it('renders one chip per available tool option', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsItems
        toolsOptions={OPTIONS}
        warningTools={[]}
        selectedTools={[]}
        onSelectTool={() => vi.fn()}
        disabled={false}
      />,
    );
    expect(getByText('Google')).toBeInTheDocument();
    expect(getByText('Wiki')).toBeInTheDocument();
  });

  it('renders a warning chip for a selected tool no longer in the schema', () => {
    const { getByText } = renderWithTheme(
      <ToolActionsItems
        toolsOptions={OPTIONS}
        warningTools={['removed_tool']}
        selectedTools={['removed_tool']}
        onSelectTool={() => vi.fn()}
        disabled={false}
      />,
    );
    expect(getByText('removed_tool')).toBeInTheDocument();
  });

  it('calls onSelectTool(value) when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onSelectTool = vi.fn(() => vi.fn());
    const { getByText } = renderWithTheme(
      <ToolActionsItems
        toolsOptions={OPTIONS}
        warningTools={[]}
        selectedTools={[]}
        onSelectTool={onSelectTool}
        disabled={false}
      />,
    );
    await user.click(getByText('Google'));
    expect(onSelectTool).toHaveBeenCalledWith('google');
  });

  it('renders warning chips before normal option chips', () => {
    const { getAllByRole } = renderWithTheme(
      <ToolActionsItems
        toolsOptions={OPTIONS}
        warningTools={['removed_tool']}
        selectedTools={['removed_tool']}
        onSelectTool={() => vi.fn()}
        disabled={false}
      />,
    );
    const labels = getAllByRole('button').map((el) => el.textContent);
    expect(labels).toEqual(['removed_tool', 'Google', 'Wiki']);
  });
});
