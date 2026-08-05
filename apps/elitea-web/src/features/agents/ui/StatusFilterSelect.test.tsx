import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';
import { StatusFilterSelect } from './StatusFilterSelect';

const tabs = [
  { label: 'My Agents' },
  { label: 'Shared With Me' },
  { label: 'Hidden Tab', display: 'none' },
  { label: 'Public' },
];

describe('StatusFilterSelect', () => {
  it('shows "Statuses:" for a non-public project', () => {
    const { getByText } = renderWithProviders(
      <StatusFilterSelect
        isPublicProject={false}
        selectedTab={0}
        tabs={tabs}
        onChangeTab={vi.fn()}
      />,
    );
    expect(getByText('Statuses:')).toBeInTheDocument();
  });

  it('shows "Filter by:" for the public project', () => {
    const { getByText } = renderWithProviders(
      <StatusFilterSelect
        isPublicProject
        selectedTab={0}
        tabs={tabs}
        onChangeTab={vi.fn()}
      />,
    );
    expect(getByText('Filter by:')).toBeInTheDocument();
  });

  it('renders the selected tab label and excludes display:"none" tabs', () => {
    const { getByText, queryByText } = renderWithProviders(
      <StatusFilterSelect
        isPublicProject={false}
        selectedTab={1}
        tabs={tabs}
        onChangeTab={vi.fn()}
      />,
    );
    expect(getByText('Shared With Me')).toBeInTheDocument();
    expect(queryByText('Hidden Tab')).not.toBeInTheDocument();
  });

  it('reports the clicked tab as its ORIGINAL index, not the filtered-list position', async () => {
    const onChangeTab = vi.fn();
    const user = userEvent.setup();
    const { getByRole } = renderWithProviders(
      <StatusFilterSelect
        isPublicProject={false}
        selectedTab={0}
        tabs={tabs}
        onChangeTab={onChangeTab}
      />,
    );
    await user.click(getByRole('combobox'));
    await user.click(getByRole('option', { name: 'Public' }));
    // "Public" is tabs[3] even though "Hidden Tab" (tabs[2]) was filtered out of the dropdown.
    expect(onChangeTab).toHaveBeenCalledWith(3);
  });
});
