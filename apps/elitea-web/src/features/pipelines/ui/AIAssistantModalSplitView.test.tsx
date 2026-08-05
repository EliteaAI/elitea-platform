import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';

import { AIAssistantModalSplitView } from './AIAssistantModalSplitView';

installCodeMirrorTestPolyfills();

const baseProps = {
  isGenerating: false,
  currentValue: 'current text',
  improvedContent: 'improved text',
  extensions: [],
  enableFStringAutocomplete: false,
  stateVariableOptions: [],
  onCurrentChange: vi.fn(),
  onImprovedChange: vi.fn(),
  onApply: vi.fn(),
  onCloseSplitView: vi.fn(),
};

describe('AIAssistantModalSplitView', () => {
  it('renders both panel headers and both editors', () => {
    const { getByText } = renderWithTheme(<AIAssistantModalSplitView {...baseProps} />);
    expect(getByText('Current Version')).toBeInTheDocument();
    expect(getByText('Improved Version')).toBeInTheDocument();
    expect(getByText('current text')).toBeInTheDocument();
    expect(getByText('improved text')).toBeInTheDocument();
  });

  it('calls onApply when Apply is clicked', async () => {
    const onApply = vi.fn();
    const { getByText } = renderWithTheme(
      <AIAssistantModalSplitView
        {...baseProps}
        onApply={onApply}
      />,
    );
    await userEvent.click(getByText('Apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('disables Apply while generating', () => {
    const { getByText } = renderWithTheme(
      <AIAssistantModalSplitView
        {...baseProps}
        isGenerating
      />,
    );
    expect(getByText('Apply').closest('button')).toBeDisabled();
  });

  it('calls onCloseSplitView when the close icon is clicked', async () => {
    const onCloseSplitView = vi.fn();
    const { getByLabelText } = renderWithTheme(
      <AIAssistantModalSplitView
        {...baseProps}
        onCloseSplitView={onCloseSplitView}
      />,
    );
    await userEvent.click(getByLabelText('Close split view'));
    expect(onCloseSplitView).toHaveBeenCalledTimes(1);
  });

  it('copies the current version and reports which side via onCopied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onCopied = vi.fn();
    const { getByLabelText } = renderWithTheme(
      <AIAssistantModalSplitView
        {...baseProps}
        onCopied={onCopied}
      />,
    );
    await userEvent.click(getByLabelText('Copy current version'));
    expect(writeText).toHaveBeenCalledWith('current text');
    await vi.waitFor(() => expect(onCopied).toHaveBeenCalledWith('current'));
  });

  it('shows the "Thinking..." indicator only while generating with no improved content yet', () => {
    // `AnimatedLoadingText` splits its text into one `<span>` per character
    // (shared/ui's own per-character wave-opacity animation), so a
    // `getByText`/`queryByText` exact match against the full string never
    // finds it — asserting against `container.textContent` (which
    // aggregates all descendant text nodes) instead, matching
    // `AnimatedLoadingText.test.tsx`'s own established pattern for the
    // same component.
    const { container, rerender } = renderWithTheme(
      <AIAssistantModalSplitView
        {...baseProps}
        improvedContent=""
      />,
    );
    expect(container.textContent).not.toContain('Thinking');

    rerender(
      <AIAssistantModalSplitView
        {...baseProps}
        isGenerating
        improvedContent=""
      />,
    );
    expect(container.textContent).toContain('Thinking');
  });
});
