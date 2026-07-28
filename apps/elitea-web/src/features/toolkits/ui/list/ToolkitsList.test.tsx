import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';
import type { ToolkitListItem } from './ToolkitsList';
import {
  ToolkitsList,
  dedupeToolkitsForDisplay,
  isListEmpty,
  isZeroStateEligible,
  shouldRedirectToCreatePage,
  shouldShowCards,
  toolkitDisplayName,
} from './ToolkitsList';

describe('isListEmpty (pure)', () => {
  it('is true when not loading, no error, and zero items', () => {
    expect(isListEmpty(false, false, 0)).toBe(true);
  });

  it('is false while loading', () => {
    expect(isListEmpty(true, false, 0)).toBe(false);
  });

  it('is false on error', () => {
    expect(isListEmpty(false, true, 0)).toBe(false);
  });

  it('is false when there are items', () => {
    expect(isListEmpty(false, false, 3)).toBe(false);
  });
});

describe('isZeroStateEligible (pure)', () => {
  it('is true when empty, no query, zero total, and no type filter', () => {
    expect(isZeroStateEligible(true, undefined, 0, 0)).toBe(true);
  });

  it('is false when not empty', () => {
    expect(isZeroStateEligible(false, undefined, 0, 0)).toBe(false);
  });

  it('is false with a query', () => {
    expect(isZeroStateEligible(true, 'react', 0, 0)).toBe(false);
  });

  it('is false with a non-zero totalCount', () => {
    expect(isZeroStateEligible(true, undefined, 5, 0)).toBe(false);
  });

  it('is false with an active type filter', () => {
    expect(isZeroStateEligible(true, undefined, 0, 1)).toBe(false);
  });
});

describe('shouldShowCards (pure)', () => {
  it('is true when not loading, no error, and there are items', () => {
    expect(shouldShowCards(false, false, 3)).toBe(true);
  });

  it('is false while loading', () => {
    expect(shouldShowCards(true, false, 3)).toBe(false);
  });

  it('is false on error', () => {
    expect(shouldShowCards(false, true, 3)).toBe(false);
  });

  it('is false with zero items', () => {
    expect(shouldShowCards(false, false, 0)).toBe(false);
  });
});

describe('toolkitDisplayName (pure)', () => {
  it('returns the trimmed name when present', () => {
    expect(toolkitDisplayName({ id: '1', name: '  Jira  ', type: 'jira' })).toBe('  Jira  ');
  });

  it('falls back to toolkit_name when name is blank', () => {
    expect(toolkitDisplayName({ id: '1', name: '  ', type: 'jira', toolkit_name: 'My Jira' })).toBe('My Jira');
  });

  it('falls back to settings.elitea_title when name and toolkit_name are absent', () => {
    expect(toolkitDisplayName({ id: '1', name: '', type: 'jira', settings: { elitea_title: 'Custom Title' } })).toBe('Custom Title');
  });

  it('falls back to settings.configuration_title next', () => {
    expect(toolkitDisplayName({ id: '1', name: '', type: 'jira', settings: { configuration_title: 'Config Title' } })).toBe('Config Title');
  });

  it('falls back to the capitalized type as the last resort', () => {
    expect(toolkitDisplayName({ id: '1', name: '', type: 'jira' })).toBe('Jira');
  });

  it('prefers toolkit_name over settings.elitea_title when both are present (fallback chain order)', () => {
    expect(
      toolkitDisplayName({ id: '1', name: '', type: 'jira', toolkit_name: 'From toolkit_name', settings: { elitea_title: 'From elitea_title' } }),
    ).toBe('From toolkit_name');
  });

  it('prefers settings.elitea_title over settings.configuration_title when both are present (fallback chain order)', () => {
    expect(
      toolkitDisplayName({ id: '1', name: '', type: 'jira', settings: { elitea_title: 'From elitea_title', configuration_title: 'From configuration_title' } }),
    ).toBe('From elitea_title');
  });

  it('skips a present-but-empty-string toolkit_name and falls through to the next fallback (falsy-coalescing, not nullish-only)', () => {
    expect(
      toolkitDisplayName({ id: '1', name: '', type: 'jira', toolkit_name: '', settings: { elitea_title: 'Real Title' } }),
    ).toBe('Real Title');
  });
});

describe('dedupeToolkitsForDisplay (pure)', () => {
  const items: ToolkitListItem[] = [
    { id: '1', name: 'A', type: 'jira' },
    { id: '2', name: 'B', type: 'mcp' },
    { id: '1', name: 'A dup', type: 'jira' },
  ];

  it('filters out MCP rows when isMcpVisible is false', () => {
    const result = dedupeToolkitsForDisplay(items, false);
    expect(result.map((item) => item.id)).toEqual(['1']);
  });

  it('keeps MCP rows when isMcpVisible is true', () => {
    const result = dedupeToolkitsForDisplay(items, true);
    expect(result.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('dedupes by id, keeping the first occurrence', () => {
    const result = dedupeToolkitsForDisplay(items, true);
    expect(result.find((item) => item.id === '1')?.name).toBe('A');
  });

  it('returns an empty array for undefined input', () => {
    expect(dedupeToolkitsForDisplay(undefined, true)).toEqual([]);
  });
});

describe('shouldRedirectToCreatePage (pure)', () => {
  const base = {
    isPublicProject: false,
    isLoading: false,
    isError: false,
    disableEmptyRedirect: false,
    hasQuery: false,
    totalCount: 0,
    selectedTypesCount: 0,
  };

  it('is true when every gate passes (private project, not loading, no error, no query, zero results, no type filter)', () => {
    expect(shouldRedirectToCreatePage(base)).toBe(true);
  });

  it('is false for the public project', () => {
    expect(shouldRedirectToCreatePage({ ...base, isPublicProject: true })).toBe(false);
  });

  it('is false while loading', () => {
    expect(shouldRedirectToCreatePage({ ...base, isLoading: true })).toBe(false);
  });

  it('is false on error', () => {
    expect(shouldRedirectToCreatePage({ ...base, isError: true })).toBe(false);
  });

  it('is false when the caller disabled the redirect', () => {
    expect(shouldRedirectToCreatePage({ ...base, disableEmptyRedirect: true })).toBe(false);
  });

  it('is false with a search query', () => {
    expect(shouldRedirectToCreatePage({ ...base, hasQuery: true })).toBe(false);
  });

  it('is false with a non-zero result count', () => {
    expect(shouldRedirectToCreatePage({ ...base, totalCount: 5 })).toBe(false);
  });

  it('is false with an active type filter', () => {
    expect(shouldRedirectToCreatePage({ ...base, selectedTypesCount: 1 })).toBe(false);
  });
});

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(isIntersecting: boolean): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this);
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const items: ToolkitListItem[] = [
  { id: '1', name: 'Jira', type: 'jira' },
  { id: '2', name: 'Confluence', type: 'confluence' },
];
const tagList = [{ id: 1, name: 'Jira' }];

function baseTypeFilter() {
  return { tagList, selectedTypes: [] as string[], onSelectType: vi.fn(), onClearTypes: vi.fn() };
}

function baseListState() {
  return { isLoading: false, hasMore: false, onLoadMore: vi.fn(), totalCount: 2 };
}

function baseProps() {
  return {
    data: items,
    renderCard: (item: ToolkitListItem) => <div data-testid={`card-${item.id}`}>{item.name}</div>,
    typeFilter: baseTypeFilter(),
    listState: baseListState(),
  };
}

describe('ToolkitsList (component)', () => {
  it('shows a spinner while loading', () => {
    renderWithProviders(
      <ToolkitsList
        {...baseProps()}
        listState={{ ...baseListState(), isLoading: true }}
        data={undefined}
      />,
    );
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the error message on error', () => {
    renderWithProviders(
      <ToolkitsList
        {...baseProps()}
        listState={{ ...baseListState(), isError: true, isLoading: false }}
        data={[]}
      />,
    );
    expect(screen.getByText('Failed to load toolkits.')).toBeInTheDocument();
  });

  it('renders one card per item via renderCard', () => {
    renderWithProviders(<ToolkitsList {...baseProps()} />);
    expect(screen.getByTestId('card-1')).toHaveTextContent('Jira');
    expect(screen.getByTestId('card-2')).toHaveTextContent('Confluence');
  });

  it('renders the right-panel ToolkitTypesPanel and the injected rightPanelExtra slot', () => {
    renderWithProviders(
      <ToolkitsList
        {...baseProps()}
        rightPanelExtra={<div data-testid="extra-panel" />}
      />,
    );
    // "Jira" itself is ambiguous here (it appears both in the rendered card
    // AND as a ToolkitTypesPanel chip) — "Types" (the panel's own title) is
    // the unambiguous signal that ToolkitTypesPanel rendered.
    expect(screen.getByText('Types')).toBeInTheDocument();
    expect(screen.getByTestId('extra-panel')).toBeInTheDocument();
  });

  it('renders the custom emptyListPlaceHolder when the list is empty and a query is present', () => {
    renderWithProviders(
      <ToolkitsList
        {...baseProps()}
        data={[]}
        listState={{ ...baseListState(), totalCount: 0 }}
        query="react"
        emptyListPlaceHolder={<div data-testid="custom-empty" />}
      />,
    );
    expect(screen.getByTestId('custom-empty')).toBeInTheDocument();
  });

  it('renders the default ToolkitsEmptyListPlaceHolder when empty with a query and no custom placeholder', () => {
    renderWithProviders(
      <ToolkitsList
        {...baseProps()}
        data={[]}
        listState={{ ...baseListState(), totalCount: 0 }}
        query="react"
      />,
    );
    // See ToolkitsEmptyListPlaceHolder.test.tsx's own comment: this text is
    // split across sibling text nodes, so it needs a regex match.
    expect(screen.getByText(/Nothing found\./)).toBeInTheDocument();
  });

  it('renders ToolkitsEmptyState when genuinely zero-state eligible and emptyStateConfig is supplied', () => {
    const onCreateClick = vi.fn();
    renderWithProviders(
      <ToolkitsList
        {...baseProps()}
        data={[]}
        listState={{ ...baseListState(), totalCount: 0 }}
        emptyStateConfig={{ title: 'No toolkits yet', description: 'Create one.', onCreateClick }}
      />,
    );
    expect(screen.getByText('No toolkits yet')).toBeInTheDocument();
  });

  it('renders an infinite-scroll sentinel and calls onLoadMore when it intersects', () => {
    const onLoadMore = vi.fn();
    renderWithProviders(
      <ToolkitsList
        {...baseProps()}
        listState={{ ...baseListState(), hasMore: true, onLoadMore }}
      />,
    );
    expect(MockIntersectionObserver.instances).toHaveLength(1);
    MockIntersectionObserver.instances[0]?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not create a sentinel observer when hasMore is false', () => {
    renderWithProviders(<ToolkitsList {...baseProps()} />);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });
});
