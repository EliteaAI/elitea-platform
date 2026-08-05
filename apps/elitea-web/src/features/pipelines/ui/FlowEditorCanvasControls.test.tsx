import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { FlowEditorBackground, FlowEditorCanvasControls } from './FlowEditorCanvasControls';

describe('FlowEditorCanvasControls', () => {
  it('calls onExpandAll when the toggle-cards-size control (the first of the two custom buttons) is clicked', async () => {
    const user = userEvent.setup();
    const onExpandAll = vi.fn();
    const { container } = renderWithTheme(
      <ReactFlowProvider>
        <FlowEditorCanvasControls
          expandAll
          onExpandAll={onExpandAll}
          onReLayout={vi.fn()}
        />
      </ReactFlowProvider>,
    );

    // `<Controls>` (`@xyflow/react`) always renders its own 4 built-in
    // buttons (zoom in/out, fit view, toggle interactivity) ahead of the
    // 2 custom ones passed as children — 6 total, all sharing the
    // `react-flow__controls-button` class with no other distinguishing
    // attribute; the two custom ones are always the last two, in order.
    const buttons = container.querySelectorAll('.react-flow__controls-button');
    expect(buttons).toHaveLength(6);
    await user.click(buttons[4]!);
    expect(onExpandAll).toHaveBeenCalledTimes(1);
  });

  it('calls onReLayout when the auto-arrange control (the second of the two custom buttons) is clicked', async () => {
    const user = userEvent.setup();
    const onReLayout = vi.fn();
    const { container } = renderWithTheme(
      <ReactFlowProvider>
        <FlowEditorCanvasControls
          expandAll={false}
          onExpandAll={vi.fn()}
          onReLayout={onReLayout}
        />
      </ReactFlowProvider>,
    );

    const buttons = container.querySelectorAll('.react-flow__controls-button');
    await user.click(buttons[5]!);
    expect(onReLayout).toHaveBeenCalledTimes(1);
  });
});

describe('FlowEditorBackground', () => {
  it('renders the react-flow background pattern', () => {
    const { container } = renderWithTheme(
      <ReactFlowProvider>
        <FlowEditorBackground />
      </ReactFlowProvider>,
    );
    expect(container.querySelector('.react-flow__background')).toBeInTheDocument();
  });
});
