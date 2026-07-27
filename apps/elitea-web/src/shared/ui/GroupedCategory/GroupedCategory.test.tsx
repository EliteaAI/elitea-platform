import type { ReactNode } from 'react';

import { describe, expect, it, vi } from 'vitest';

import type { CategoryItem } from '../CategoryItemCard';
import { renderWithTheme } from '../lib/testTheme';
import { GroupedCategory } from '.';

const renderCategory = (category: string, items: readonly CategoryItem[]): ReactNode => (
  <div data-testid={`category-${category}`}>
    {category}: {items.map((item) => item.key).join(', ')}
  </div>
);

describe('GroupedCategory', () => {
  it('renders a loading skeleton (default count) when isLoading', () => {
    const { getByRole, container } = renderWithTheme(
      <GroupedCategory
        isLoading
        renderCategory={renderCategory}
      />,
    );
    expect(getByRole('status', { name: 'Loading categories' })).toBeInTheDocument();
    // 25 skeleton tiles by default, each aria-hidden.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(25);
  });

  it('honours a custom loadingSkeletonCount', () => {
    const { container } = renderWithTheme(
      <GroupedCategory
        isLoading
        loadingSkeletonCount={3}
        renderCategory={renderCategory}
      />,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  it('renders only categories that have items, via renderCategory', () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <GroupedCategory
        allCategories={['Tools', 'Agents']}
        groupedItems={{ Tools: [{ key: 't1', label: 'GitHub' }], Agents: [] }}
        renderCategory={renderCategory}
      />,
    );
    expect(getByTestId('category-Tools')).toHaveTextContent('Tools: t1');
    expect(queryByTestId('category-Agents')).not.toBeInTheDocument();
  });

  it('shows the no-results slot when every category is empty', () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <GroupedCategory
        allCategories={['Tools']}
        groupedItems={{ Tools: [] }}
        renderCategory={renderCategory}
        noResultsSlot={<span>Nothing found</span>}
      />,
    );
    expect(getByText('Nothing found')).toBeInTheDocument();
    expect(queryByTestId('category-Tools')).not.toBeInTheDocument();
  });

  it('renders null (nothing) for no-results when no noResultsSlot is given', () => {
    const { container } = renderWithTheme(
      <GroupedCategory
        allCategories={['Tools']}
        groupedItems={{ Tools: [] }}
        renderCategory={renderCategory}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('includes empty categories when allowEmptyCategory is set and nothing is selected', () => {
    const { getByTestId } = renderWithTheme(
      <GroupedCategory
        allCategories={['Tools']}
        groupedItems={{}}
        allowEmptyCategory
        selectedCategories={[]}
        renderCategory={renderCategory}
      />,
    );
    expect(getByTestId('category-Tools')).toBeInTheDocument();
  });

  it('does NOT include empty categories when allowEmptyCategory is set but a filter is active', () => {
    const { queryByTestId, getByText } = renderWithTheme(
      <GroupedCategory
        allCategories={['Tools']}
        groupedItems={{}}
        allowEmptyCategory
        selectedCategories={['Something']}
        renderCategory={renderCategory}
        noResultsSlot={<span>Nothing found</span>}
      />,
    );
    expect(queryByTestId('category-Tools')).not.toBeInTheDocument();
    expect(getByText('Nothing found')).toBeInTheDocument();
  });

  it('passes each category its own items array to renderCategory', () => {
    const spy = vi.fn(renderCategory);
    renderWithTheme(
      <GroupedCategory
        allCategories={['Tools', 'Agents']}
        groupedItems={{
          Tools: [{ key: 't1', label: 'GitHub' }],
          Agents: [{ key: 'a1', label: 'Bot' }],
        }}
        renderCategory={spy}
      />,
    );
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('Tools', [{ key: 't1', label: 'GitHub' }]);
    expect(spy).toHaveBeenCalledWith('Agents', [{ key: 'a1', label: 'Bot' }]);
  });

  it('forwards data-testid and sx to the root', () => {
    const { getByTestId } = renderWithTheme(
      <GroupedCategory
        data-testid="grouped-root"
        sx={{ marginTop: '1rem' }}
        renderCategory={renderCategory}
      />,
    );
    expect(getByTestId('grouped-root')).toBeInTheDocument();
  });

  it('defaults allCategories/groupedItems to empty and renders the no-results branch', () => {
    const { getByText } = renderWithTheme(
      <GroupedCategory
        renderCategory={renderCategory}
        noResultsSlot={<span>Nothing found</span>}
      />,
    );
    expect(getByText('Nothing found')).toBeInTheDocument();
  });
});
