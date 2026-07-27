import { describe, expect, it } from 'vitest';

import type { ModelUsage } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ModelUsageTable } from './ModelUsageTable';

const MODELS: readonly ModelUsage[] = [
  { model: 'claude-sonnet', prompt_tokens: 1000, completion_tokens: 500, total_cost: 1.5, run_count: 80 },
  { model: 'gpt-4o', prompt_tokens: 200, completion_tokens: 100, total_cost: 0.5, run_count: 20 },
];

describe('ModelUsageTable', () => {
  it('renders nothing when models is empty', () => {
    const { container } = renderWithTheme(
      <ModelUsageTable
        models={[]}
        totalCalls={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per model with the real run_count-derived fields', () => {
    const { getByText, getAllByText } = renderWithTheme(
      <ModelUsageTable
        models={MODELS}
        totalCalls={100}
      />,
    );
    expect(getByText('claude-sonnet')).toBeInTheDocument();
    expect(getByText('gpt-4o')).toBeInTheDocument();
    expect(getByText('80')).toBeInTheDocument();
    expect(getByText('20')).toBeInTheDocument();
    // "Users" column has no backing field on ModelUsage — renders the
    // UNAVAILABLE_METRIC placeholder for every row, not a fabricated number.
    expect(getAllByText('–')).toHaveLength(MODELS.length);
  });

  it('computes each row\'s share percentage from totalCalls', () => {
    const { getByText } = renderWithTheme(
      <ModelUsageTable
        models={MODELS}
        totalCalls={100}
      />,
    );
    expect(getByText('80.0%')).toBeInTheDocument();
    expect(getByText('20.0%')).toBeInTheDocument();
  });

  it('renders 0% share when totalCalls is 0 (no division by zero crash)', () => {
    const { getAllByText } = renderWithTheme(
      <ModelUsageTable
        models={MODELS}
        totalCalls={0}
      />,
    );
    expect(getAllByText('0.0%')).toHaveLength(MODELS.length);
  });
});
