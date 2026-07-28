import { fireEvent, screen, within, type RenderResult } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ReactFlowProvider } from '@xyflow/react';

import { DecisionOutputs, commonComponentStyles, type DecisionOutputsProps } from './DecisionNodeShared';

function renderDecisionOutputs(props: DecisionOutputsProps): RenderResult {
  return renderWithTheme(
    <ReactFlowProvider>
      <DecisionOutputs {...props} />
    </ReactFlowProvider>,
  );
}

function baseProps(overrides: Partial<DecisionOutputsProps> = {}): DecisionOutputsProps {
  return {
    id: 'Decision 1',
    decisionOutput: ['NodeA', 'NodeB'],
    onRemoveOutput: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

describe('DecisionOutputs', () => {
  it('renders the "Decision outputs" heading and one chip per output', () => {
    renderDecisionOutputs(baseProps());
    expect(screen.getByText('Decision outputs')).toBeInTheDocument();
    expect(screen.getByText('NodeA')).toBeInTheDocument();
    expect(screen.getByText('NodeB')).toBeInTheDocument();
  });

  it('renders nothing under the heading when decisionOutput is empty', () => {
    renderDecisionOutputs(baseProps({ decisionOutput: [] }));
    expect(screen.getByText('Decision outputs')).toBeInTheDocument();
    expect(screen.queryByText('NodeA')).toBeNull();
  });

  it('calls the onRemoveOutput(item) factory, then its returned handler, when a chip delete icon is clicked', () => {
    const removeHandler = vi.fn();
    const onRemoveOutput = vi.fn(() => removeHandler);
    renderDecisionOutputs(baseProps({ onRemoveOutput }));

    const chip = screen.getByText('NodeA').closest('[class*="MuiChip-root"]') as HTMLElement;
    fireEvent.click(within(chip).getByTestId('decision-output-remove'));

    expect(onRemoveOutput).toHaveBeenCalledWith('NodeA');
    expect(removeHandler).toHaveBeenCalledTimes(1);
  });

  it('disables every chip when isRunningPipeline is true', () => {
    renderDecisionOutputs(baseProps({ isRunningPipeline: true }));
    const chip = screen.getByText('NodeA').closest('[class*="MuiChip-root"]');
    expect(chip?.className).toContain('Mui-disabled');
  });

  it('disables every chip when disabled is true (isRunningPipeline falsy)', () => {
    renderDecisionOutputs(baseProps({ disabled: true }));
    const chip = screen.getByText('NodeA').closest('[class*="MuiChip-root"]');
    expect(chip?.className).toContain('Mui-disabled');
  });

  // Reproduces the confirmed HIGH finding: `isRunningPipeline ?? disabled`
  // (bug) evaluates to `false` (not disabled) whenever `isRunningPipeline` is
  // the real, non-optional boolean `false` -- `??` only falls through to
  // `disabled` for `null`/`undefined`, not for `false`. `isRunningPipeline ||
  // disabled` (fixed, matching baseline `DecisionNodeShared.jsx:38`)
  // correctly disables in this exact "idle but read-only" combination.
  it('disables every chip when isRunningPipeline is explicitly false and disabled is true', () => {
    renderDecisionOutputs(baseProps({ isRunningPipeline: false, disabled: true }));
    const chip = screen.getByText('NodeA').closest('[class*="MuiChip-root"]');
    expect(chip?.className).toContain('Mui-disabled');
  });
});

describe('commonComponentStyles', () => {
  it('returns the AIAssistantInput container style both decision node variants spread', () => {
    const styles = commonComponentStyles();
    expect(Object.keys(styles)).toEqual(['inputEnhancerContainer']);
    expect(styles.inputEnhancerContainer.className).toBe('nopan nodrag nowheel');
  });
});
