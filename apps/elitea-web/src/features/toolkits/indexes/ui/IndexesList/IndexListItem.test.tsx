import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { IndexRow } from '../../model/indexesStore';

import { IndexListItem } from './IndexListItem';

describe('IndexListItem', () => {
  it('renders a loading skeleton when useMock is set', () => {
    const { getAllByTestId } = renderWithTheme(
      <IndexListItem
        useMock
        index={{ id: 'skel', metadata: {} }}
      />,
    );
    expect(getAllByTestId('index-list-item-skeleton')).toHaveLength(2);
  });

  it('shows the collection name and total-indexed count', () => {
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index', indexed: 42 } };
    const { getByText } = renderWithTheme(<IndexListItem index={index} />);
    expect(getByText('my-index')).toBeInTheDocument();
    expect(getByText('42')).toBeInTheDocument();
  });

  it('shows "reindexed / total indexed" once history has more than one entry', () => {
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index', indexed: 42, updated: 5, history: [{}, {}] } };
    const { getByText } = renderWithTheme(<IndexListItem index={index} />);
    expect(getByText('5 / 42')).toBeInTheDocument();
  });

  it('shows a skipped-count badge when documents were skipped', () => {
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index', indexed: 10, skipped: { total_skipped: 3 } } };
    const { getByText } = renderWithTheme(<IndexListItem index={index} />);
    expect(getByText('3')).toBeInTheDocument();
  });

  it('keeps the red error/stale styling even when the row is also selected (baseline: error wins over selected)', () => {
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index', state: 'in_progress' }, stale: true };
    const { getByText } = renderWithTheme(
      <IndexListItem
        index={index}
        currentIndex={index}
      />,
    );
    const nameEl = getByText('my-index');
    const wrapperBox = nameEl.parentElement;
    if (!wrapperBox) throw new Error('wrapper box not found');
    const cls = Array.from(wrapperBox.classList).find((c) => c.startsWith('css-'));
    if (!cls) throw new Error('emotion class not found on wrapper box');

    // jsdom's CSS engine doesn't resolve `var(...)` inside shorthand
    // properties for `getComputedStyle` — same technique as `IndexChat.
    // test.tsx`'s `chatBodyContainerSx` assertion: read the generated
    // rule's own CSS text instead.
    let cssText = '';
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if ('selectorText' in rule && (rule as CSSStyleRule).selectorText?.includes(cls)) {
          cssText += (rule as CSSStyleRule).cssText;
        }
      }
    }
    // Pre-fix (`isSelected` checked first): this would be
    // `var(--el-palette-action-selected)` instead — the plain "selected"
    // style winning outright and the error/stale indicator disappearing.
    expect(cssText).toMatch(/border:\s*\.0625rem solid var\(--el-palette-error-main/);
    expect(cssText).toMatch(/background:\s*var\(--el-palette-error-light/);
  });

  it('calls onIndexClick with the index when clicked', async () => {
    const user = userEvent.setup();
    const onIndexClick = vi.fn();
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index' } };
    const { getByText } = renderWithTheme(
      <IndexListItem
        index={index}
        onIndexClick={onIndexClick}
      />,
    );
    await user.click(getByText('my-index'));
    expect(onIndexClick).toHaveBeenCalledWith(index);
  });
});
