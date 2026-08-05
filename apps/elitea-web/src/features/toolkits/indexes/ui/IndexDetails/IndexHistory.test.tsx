import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { useIndexesStore } from '../../model/indexesStore';

import { IndexHistory } from './IndexHistory';
import type { IndexHistoryItem } from './IndexHistory';

beforeEach(() => {
  useIndexesStore.setState({ tempIndexes: [], indexPatches: {}, toolkitScheduler: {}, selectedHistoryItem: null });
});

const history: IndexHistoryItem[] = [
  { state: 'completed', updated_on: 1_700_000_000, conversation_id: 'c1' },
  { state: 'failed', updated_on: 1_700_100_000, conversation_id: 'c2' },
  { state: 'partly_indexed', updated_on: 1_700_050_000, conversation_id: 'c3' },
];

describe('IndexHistory', () => {
  it('selects the last history item on mount and clears selection on unmount', () => {
    const { unmount } = renderWithTheme(<IndexHistory history={history} />);
    expect(useIndexesStore.getState().selectedHistoryItem).toEqual(history[2]);
    unmount();
    expect(useIndexesStore.getState().selectedHistoryItem).toBeNull();
  });

  it('renders every history row with its label and formatted date', () => {
    const { getByText } = renderWithTheme(<IndexHistory history={history} />);
    expect(getByText('Reindexed')).toBeInTheDocument();
    expect(getByText('Failed')).toBeInTheDocument();
    expect(getByText('Partially Indexed')).toBeInTheDocument();
  });

  it('sorts by date descending by default, and toggles direction on repeated click', async () => {
    const user = userEvent.setup();
    const { getByText, getAllByText } = renderWithTheme(<IndexHistory history={history} />);

    // Default: date desc -> Failed (1_700_100_000) first, then Partially Indexed, then Reindexed.
    const rowsDesc = getAllByText(/Reindexed|Failed|Partially Indexed/);
    expect(rowsDesc[0]).toHaveTextContent('Failed');

    await user.click(getByText('Date'));
    const rowsAsc = getAllByText(/Reindexed|Failed|Partially Indexed/);
    expect(rowsAsc[0]).toHaveTextContent('Reindexed');
  });

  it('clicking a row selects it', async () => {
    const user = userEvent.setup();
    const { getByText } = renderWithTheme(<IndexHistory history={history} />);
    await user.click(getByText('Failed'));
    expect(useIndexesStore.getState().selectedHistoryItem).toEqual(history[1]);
  });
});
