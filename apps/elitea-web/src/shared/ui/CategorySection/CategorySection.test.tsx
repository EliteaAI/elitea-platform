import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryItem } from '../CategoryItemCard';
import { renderWithTheme } from '../lib/testTheme';
import { CategorySection } from '.';

const ITEMS: CategoryItem[] = [
  { key: 'a', label: 'Item A' },
  { key: 'b', label: 'Item B' },
];

/** jsdom has no `ResizeObserver` — every rendered `CategoryItemCard` needs one (see its own test file). */
class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

describe('CategorySection', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the category title, a divider, and one card per item', () => {
    const { getByText, getByRole } = renderWithTheme(
      <CategorySection
        category="Tools"
        items={ITEMS}
      />,
    );
    expect(getByText('Tools')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Item A' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Item B' })).toBeInTheDocument();
  });

  it('hides the title when showCategory=false', () => {
    const { queryByText, getByRole } = renderWithTheme(
      <CategorySection
        category="Tools"
        items={ITEMS}
        showCategory={false}
      />,
    );
    expect(queryByText('Tools')).not.toBeInTheDocument();
    expect(getByRole('button', { name: 'Item A' })).toBeInTheDocument();
  });

  it('renders the emptyPlaceholder when items is empty', () => {
    const { getByText, queryAllByRole } = renderWithTheme(
      <CategorySection
        category="Tools"
        items={[]}
        emptyPlaceholder={<span>Nothing here yet</span>}
      />,
    );
    expect(getByText('Nothing here yet')).toBeInTheDocument();
    expect(queryAllByRole('button')).toHaveLength(0);
  });

  it('renders nothing extra when items is empty and no emptyPlaceholder is given', () => {
    const { queryAllByRole, getByText } = renderWithTheme(
      <CategorySection
        category="Tools"
        items={[]}
      />,
    );
    expect(getByText('Tools')).toBeInTheDocument();
    expect(queryAllByRole('button')).toHaveLength(0);
  });

  it("wires each item's onClick through to its CategoryItemCard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(
      <CategorySection
        category="Tools"
        items={[{ key: 'a', label: 'Item A', onClick }]}
      />,
    );
    await user.click(getByRole('button', { name: 'Item A' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
