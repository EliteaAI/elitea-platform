import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { renderAgentEditorShell, renderPipelineEditorShell, renderToolkitEditorShell, type EditorShellRenderProps } from './EditorShell';

function baseProps(overrides: Partial<EditorShellRenderProps> = {}): EditorShellRenderProps {
  return {
    isVisible: true,
    isDirty: false,
    onClose: vi.fn(),
    title: 'My Agent',
    subtitle: undefined,
    error: undefined,
    saveButton: <button type="button">save-button-slot</button>,
    isPublic: false,
    children: <div>editor-body</div>,
    ...overrides,
  };
}

describe('renderAgentEditorShell', () => {
  it('renders the title, subtitle, and children', () => {
    const { getByText } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ subtitle: 'v3' }))}</>);
    expect(getByText('My Agent')).toBeInTheDocument();
    expect(getByText('v3')).toBeInTheDocument();
    expect(getByText('editor-body')).toBeInTheDocument();
  });

  it('calls onClose directly when the close button is clicked, without any confirm', async () => {
    const onClose = vi.fn();
    const onDiscard = vi.fn();
    const user = userEvent.setup();
    const { getByLabelText, queryByTestId } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ isDirty: true, onClose, onDiscard }))}</>);

    await user.click(getByLabelText('Close editor'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(queryByTestId('editor-shell-discard-confirm')).not.toBeInTheDocument();
  });

  it('shows a Public badge and hides Discard/save when isPublic', () => {
    const { getByText, queryByText, queryByLabelText } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ isPublic: true }))}</>);
    expect(getByText('Public')).toBeInTheDocument();
    expect(queryByText('save-button-slot')).not.toBeInTheDocument();
    expect(queryByLabelText('Discard')).not.toBeInTheDocument();
  });

  it('disables Discard when not dirty, enables it when dirty', () => {
    const { getByLabelText, rerender } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ isDirty: false }))}</>);
    expect(getByLabelText('Discard')).toBeDisabled();

    rerender(<>{renderAgentEditorShell(baseProps({ isDirty: true }))}</>);
    expect(getByLabelText('Discard')).toBeEnabled();
  });

  it('Discard -> confirm calls onDiscard then onClose, in order', async () => {
    const calls: string[] = [];
    const onDiscard = vi.fn(() => calls.push('discard'));
    const onClose = vi.fn(() => calls.push('close'));
    const user = userEvent.setup();
    const { getByLabelText, getByTestId, getByText } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ isDirty: true, onDiscard, onClose }))}</>);

    await user.click(getByLabelText('Discard'));
    expect(getByTestId('editor-shell-discard-confirm')).toBeInTheDocument();
    expect(getByText('You are editing now. Do you want to discard current changes and continue?')).toBeInTheDocument();

    await user.click(getByText('Confirm'));

    expect(calls).toEqual(['discard', 'close']);
  });

  it('Discard -> cancel calls neither onDiscard nor onClose', async () => {
    const onDiscard = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { getByLabelText, getByText } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ isDirty: true, onDiscard, onClose }))}</>);

    await user.click(getByLabelText('Discard'));
    await user.click(getByText('Cancel'));

    expect(onDiscard).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resolves error.data.message, then error.message, then the generic fallback', () => {
    const { getByText, rerender } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ error: { data: { message: 'from data' } } }))}</>);
    expect(getByText('from data')).toBeInTheDocument();

    rerender(<>{renderAgentEditorShell(baseProps({ error: { message: 'from message' } }))}</>);
    expect(getByText('from message')).toBeInTheDocument();

    rerender(<>{renderAgentEditorShell(baseProps({ error: { code: 500 } }))}</>);
    expect(getByText('Failed to load configuration')).toBeInTheDocument();
  });

  it('renders nothing for a falsy error', () => {
    const { queryByRole } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ error: undefined }))}</>);
    expect(queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports every isDirty change via onDirtyStateChange', () => {
    const onDirtyStateChange = vi.fn();
    const { rerender } = renderWithTheme(<>{renderAgentEditorShell(baseProps({ isDirty: false, onDirtyStateChange }))}</>);
    expect(onDirtyStateChange).toHaveBeenLastCalledWith(false);

    rerender(<>{renderAgentEditorShell(baseProps({ isDirty: true, onDirtyStateChange }))}</>);
    expect(onDirtyStateChange).toHaveBeenLastCalledWith(true);
  });
});

describe('renderPipelineEditorShell', () => {
  it('renders formContent between the header and children', () => {
    const { getByText } = renderWithTheme(
      <>{renderPipelineEditorShell(baseProps({ formContent: <div>tab-bar-slot</div>, onDiscard: vi.fn() }))}</>,
    );
    expect(getByText('tab-bar-slot')).toBeInTheDocument();
    expect(getByText('editor-body')).toBeInTheDocument();
  });
});

describe('renderToolkitEditorShell', () => {
  it('renders without a subtitle/isPublic/formContent (fields ToolkitEditorShellProps never supplies)', () => {
    const { getByText, queryByText } = renderWithTheme(
      <>{renderToolkitEditorShell({ isVisible: true, isDirty: false, onClose: vi.fn(), title: 'My Toolkit', error: undefined, saveButton: <span>save</span>, children: <div>toolkit-body</div> })}</>,
    );
    expect(getByText('My Toolkit')).toBeInTheDocument();
    expect(getByText('toolkit-body')).toBeInTheDocument();
    expect(queryByText('Public')).not.toBeInTheDocument();
  });
});
