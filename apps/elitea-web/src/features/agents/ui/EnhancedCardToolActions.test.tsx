import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EnhancedCardToolActions } from './EnhancedCardToolActions';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const toolOptions = [
  { value: 'read_file', label: 'Read file' },
  { value: 'write_file', label: 'Write file' },
];

describe('EnhancedCardToolActions', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when showActions is false', () => {
    const { container } = renderWithTheme(
      <EnhancedCardToolActions
        toolOptions={toolOptions}
        selectedTools={[]}
        showActions={false}
        onSelectedToolsChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('sorts selected tools before unselected tools, each alphabetically', () => {
    const { getAllByText } = renderWithTheme(
      <EnhancedCardToolActions
        toolOptions={[
          { value: 'b_tool', label: 'B tool' },
          { value: 'a_tool', label: 'A tool' },
          { value: 'z_tool', label: 'Z tool' },
        ]}
        selectedTools={['z_tool']}
        showActions
        onSelectedToolsChange={vi.fn()}
      />,
    );
    const labels = getAllByText(/tool$/).map((el) => el.textContent);
    expect(labels).toEqual(['Z tool', 'A tool', 'B tool']);
  });

  it('calls onSelectedToolsChange with the tool ADDED when an unselected available tool is clicked', async () => {
    const user = userEvent.setup();
    const onSelectedToolsChange = vi.fn();
    const { getByText } = renderWithTheme(
      <EnhancedCardToolActions
        toolOptions={toolOptions}
        selectedTools={['write_file']}
        showActions
        onSelectedToolsChange={onSelectedToolsChange}
      />,
    );
    await user.click(getByText('Read file'));
    expect(onSelectedToolsChange).toHaveBeenCalledWith(['write_file', 'read_file']);
  });

  it('calls onSelectedToolsChange with the tool REMOVED when a selected available tool is clicked', async () => {
    const user = userEvent.setup();
    const onSelectedToolsChange = vi.fn();
    const { getByText } = renderWithTheme(
      <EnhancedCardToolActions
        toolOptions={toolOptions}
        selectedTools={['read_file', 'write_file']}
        showActions
        onSelectedToolsChange={onSelectedToolsChange}
      />,
    );
    await user.click(getByText('Read file'));
    expect(onSelectedToolsChange).toHaveBeenCalledWith(['write_file']);
  });

  it('does not call onSelectedToolsChange when disabled', async () => {
    const user = userEvent.setup();
    const onSelectedToolsChange = vi.fn();
    const { getByText } = renderWithTheme(
      <EnhancedCardToolActions
        toolOptions={toolOptions}
        selectedTools={[]}
        showActions
        disabled
        onSelectedToolsChange={onSelectedToolsChange}
      />,
    );
    await user.click(getByText('Read file'));
    expect(onSelectedToolsChange).not.toHaveBeenCalled();
  });

  it('renders a tool not on the availableTools list as a chip that does not respond to clicks when unselected', async () => {
    const user = userEvent.setup();
    const onSelectedToolsChange = vi.fn();
    const { getByText } = renderWithTheme(
      <EnhancedCardToolActions
        toolOptions={toolOptions}
        selectedTools={[]}
        availableTools={['write_file']}
        showActions
        onSelectedToolsChange={onSelectedToolsChange}
      />,
    );
    // 'read_file' is NOT in availableTools -> unavailable chip, no click handler.
    expect(getByText('Read file')).toBeInTheDocument();
    await user.click(getByText('Read file'));
    expect(onSelectedToolsChange).not.toHaveBeenCalled();
  });

  it('always shows the warning icon on an unavailable chip, even when the tool is selected', () => {
    const { getByText, getByTestId } = renderWithTheme(
      <EnhancedCardToolActions
        toolOptions={toolOptions}
        selectedTools={['read_file']}
        availableTools={['write_file']}
        showActions
        onSelectedToolsChange={vi.fn()}
      />,
    );
    // 'read_file' is selected but unavailable -> its chip must still show the
    // warning icon (baseline's ChipWithCheckIcon call site always passes an
    // explicit warning icon, which wins over its own isSelected-checkmark
    // fallback), never a checkmark.
    expect(getByText('Read file')).toBeInTheDocument();
    expect(getByTestId('ErrorOutlineOutlinedIcon')).toBeInTheDocument();
  });

  it('lets a selected-but-unavailable tool be deselected via its chip', async () => {
    const user = userEvent.setup();
    const onSelectedToolsChange = vi.fn();
    const { getByText } = renderWithTheme(
      <EnhancedCardToolActions
        toolOptions={toolOptions}
        selectedTools={['read_file']}
        availableTools={['write_file']}
        showActions
        onSelectedToolsChange={onSelectedToolsChange}
      />,
    );
    // 'read_file' is selected but not in availableTools -> unavailable chip, still clickable to deselect.
    await user.click(getByText('Read file'));
    expect(onSelectedToolsChange).toHaveBeenCalledWith([]);
  });
});
