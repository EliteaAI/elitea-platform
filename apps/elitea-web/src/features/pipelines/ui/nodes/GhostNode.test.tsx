import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ReactFlowProvider } from '@xyflow/react';

import { GhostNode } from './GhostNode';

describe('GhostNode', () => {
  it('renders a single target handle, not marked connectable', () => {
    const { container } = renderWithTheme(
      <ReactFlowProvider>
        <GhostNode />
      </ReactFlowProvider>,
    );
    const handle = container.querySelector('.react-flow__handle');
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveClass('target');
    // `isConnectable={false}` -- React Flow never adds the `connectable`
    // class this Handle would otherwise get.
    expect(handle).not.toHaveClass('connectable');
  });

  it('renders no visible text content', () => {
    const { container } = renderWithTheme(
      <ReactFlowProvider>
        <GhostNode />
      </ReactFlowProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
