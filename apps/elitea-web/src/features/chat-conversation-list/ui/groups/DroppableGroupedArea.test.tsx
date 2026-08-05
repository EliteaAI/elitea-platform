import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { DroppableGroupedArea } from './DroppableGroupedArea';

describe('DroppableGroupedArea', () => {
  it('always renders its children', () => {
    const { getByText } = renderWithTheme(
      <DroppableGroupedArea>
        <span>ungrouped conversation row</span>
      </DroppableGroupedArea>,
    );
    expect(getByText('ungrouped conversation row')).toBeInTheDocument();
  });

  it('defaults (no drag in progress) show the passive highlight, not the drop-feedback or dimmed overlays', () => {
    const { queryByTestId } = renderWithTheme(
      <DroppableGroupedArea>
        <span>row</span>
      </DroppableGroupedArea>,
    );
    expect(queryByTestId('passive-highlight-overlay')).toBeInTheDocument();
    expect(queryByTestId('drop-feedback-overlay')).not.toBeInTheDocument();
    expect(queryByTestId('invalid-target-overlay')).not.toBeInTheDocument();
  });

  it('an invalid drop target during an active drag shows only the dimmed overlay', () => {
    const { queryByTestId } = renderWithTheme(
      <DroppableGroupedArea
        isValidDropTarget={false}
        isActive
      >
        <span>row</span>
      </DroppableGroupedArea>,
    );
    expect(queryByTestId('invalid-target-overlay')).toBeInTheDocument();
    expect(queryByTestId('passive-highlight-overlay')).not.toBeInTheDocument();
    expect(queryByTestId('drop-feedback-overlay')).not.toBeInTheDocument();
  });

  it('no drag in progress (isActive=false) shows no overlay at all, even for an invalid target', () => {
    const { queryByTestId } = renderWithTheme(
      <DroppableGroupedArea
        isValidDropTarget={false}
        isActive={false}
      >
        <span>row</span>
      </DroppableGroupedArea>,
    );
    expect(queryByTestId('invalid-target-overlay')).not.toBeInTheDocument();
    expect(queryByTestId('passive-highlight-overlay')).not.toBeInTheDocument();
    expect(queryByTestId('drop-feedback-overlay')).not.toBeInTheDocument();
  });

  it('a valid target with no drag active (isActive=false) shows no overlay', () => {
    const { queryByTestId } = renderWithTheme(
      <DroppableGroupedArea
        isValidDropTarget
        isActive={false}
      >
        <span>row</span>
      </DroppableGroupedArea>,
    );
    expect(queryByTestId('passive-highlight-overlay')).not.toBeInTheDocument();
    expect(queryByTestId('invalid-target-overlay')).not.toBeInTheDocument();
  });
});
