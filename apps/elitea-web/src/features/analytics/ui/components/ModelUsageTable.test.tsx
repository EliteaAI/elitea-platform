import { describe, expect, it } from 'vitest';

import type { ModelUsage } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ModelUsageTable } from './ModelUsageTable';

const MODELS: readonly ModelUsage[] = [
  { model: 'claude-sonnet', provider: 'anthropic', prompt_tokens: 1000, completion_tokens: 500, run_count: 80 },
  { model: 'gpt-4o', provider: 'openai', prompt_tokens: 200, completion_tokens: 100, run_count: 20 },
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
    const { getByText, queryAllByText } = renderWithTheme(
      <ModelUsageTable
        models={MODELS}
        totalCalls={100}
      />,
    );
    expect(getByText('claude-sonnet')).toBeInTheDocument();
    expect(getByText('gpt-4o')).toBeInTheDocument();
    expect(getByText('80')).toBeInTheDocument();
    expect(getByText('20')).toBeInTheDocument();
    // The provider, so two rows for the same model name arriving through two
    // routes do not read as one duplicated row.
    expect(getByText('anthropic')).toBeInTheDocument();
    expect(getByText('openai')).toBeInTheDocument();
    // Tokens replaced the old "Users" column, which had no backing field on
    // ModelUsage and rendered a dash for every row, forever.
    expect(getByText('1.5K')).toBeInTheDocument(); // 1000 + 500
    expect(getByText('300')).toBeInTheDocument(); // 200 + 100
    expect(queryAllByText('–')).toHaveLength(0);
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

  it('renders a real 0% share-bar width (not NaN%) when the top-ranked model has run_count 0', () => {
    const zeroRunCountModels: readonly ModelUsage[] = [
      { model: 'idle-model', provider: 'openai', prompt_tokens: 0, completion_tokens: 0, run_count: 0 },
    ];
    const { queryByText } = renderWithTheme(
      <ModelUsageTable
        models={zeroRunCountModels}
        totalCalls={0}
      />,
    );
    expect(queryByText('0.0%')).toBeInTheDocument();
    // The share-bar's `width: ${(model.run_count / maxCalls) * 100}%` is set
    // via MUI's `sx` prop, which emotion compiles into an injected
    // stylesheet (not an inline `style=` attribute) — assert against that
    // stylesheet directly. Before the `??` -> `||` fix, `maxCalls` was `0`
    // here (the only/top-ranked model's own `run_count`), so this would
    // have been `width:NaN%` instead of the real `width:0%`.
    const styleText = document.head.innerHTML;
    expect(styleText).not.toContain('NaN');
    expect(styleText).toContain('width:0%');
  });
});
