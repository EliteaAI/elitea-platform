import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { OpenAPIActionsTable } from './OpenAPIActionsTable';
import type { OpenAPIAction } from './OpenAPIActionsTable';

const TOOLS: readonly OpenAPIAction[] = [
  { name: 'get_users', method: 'get', path: '/users', description: 'List users' },
  { name: 'create_users', method: 'post', path: '/users' },
];

describe('OpenAPIActionsTable', () => {
  it('renders nothing when there are no tools (empty tools, no legacy selected_tools)', () => {
    const { container } = renderWithTheme(<OpenAPIActionsTable tools={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when tools is omitted and selected_tools is also empty', () => {
    const { container } = renderWithTheme(<OpenAPIActionsTable />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every tool row from the tools prop', () => {
    const { getByText } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    expect(getByText('get_users')).toBeInTheDocument();
    expect(getByText('create_users')).toBeInTheDocument();
  });

  it('falls back to the legacy selected_tools prop when tools is empty', () => {
    const { getByText } = renderWithTheme(<OpenAPIActionsTable selected_tools={TOOLS} />);
    expect(getByText('get_users')).toBeInTheDocument();
  });

  it('expands a row to reveal its description and path on click', () => {
    const { getByText, queryByText } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    expect(queryByText('List users')).not.toBeInTheDocument();
    fireEvent.click(getByText('get_users'));
    expect(getByText('List users')).toBeInTheDocument();
    expect(getByText('/users')).toBeInTheDocument();
  });

  it('sorts by the Api Endpoint column when its header is clicked', () => {
    const { getByText, getAllByRole } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    fireEvent.click(getByText('Api Endpoint'));
    const rows = getAllByRole('row');
    // header row + 2 data rows (each data row also has a hidden details row) — the
    // first data row's cell text should now be the alphabetically-first name.
    expect(rows[1]).toHaveTextContent('create_users');
  });

  it('shows a "Show more"/"Show less" toggle only past 5 tools', () => {
    const manyTools: OpenAPIAction[] = Array.from({ length: 6 }, (_, i) => ({ name: `tool_${i}`, method: 'get' }));
    const { getByText, queryByText } = renderWithTheme(<OpenAPIActionsTable tools={manyTools} />);
    expect(getByText('Show more')).toBeInTheDocument();
    expect(queryByText('tool_5')).not.toBeInTheDocument();
    fireEvent.click(getByText('Show more'));
    expect(getByText('tool_5')).toBeInTheDocument();
    expect(getByText('Show less')).toBeInTheDocument();
  });

  it('does not show the toggle for 5 or fewer tools', () => {
    const { queryByText } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    expect(queryByText('Show more')).not.toBeInTheDocument();
  });

  it('sorts by the Method column when its header is clicked', () => {
    const { getByText, getAllByRole } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    fireEvent.click(getByText('Method'));
    const rows = getAllByRole('row');
    // 'get' < 'post' alphabetically.
    expect(rows[1]).toHaveTextContent('get');
    expect(rows[1]).toHaveTextContent('get_users');
  });

  it('reverses sort direction on a second click of the same column header', () => {
    const { getByText, getAllByRole } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    fireEvent.click(getByText('Api Endpoint'));
    let rows = getAllByRole('row');
    expect(rows[1]).toHaveTextContent('create_users');
    fireEvent.click(getByText('Api Endpoint'));
    rows = getAllByRole('row');
    expect(rows[1]).toHaveTextContent('get_users');
  });

  it('resets sort direction to asc when switching to a different column after sorting desc', () => {
    const { getByText, getAllByRole } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    fireEvent.click(getByText('Api Endpoint'));
    fireEvent.click(getByText('Api Endpoint'));
    // Now desc on 'name': create_users first flips back... verify state, then switch column.
    let rows = getAllByRole('row');
    expect(rows[1]).toHaveTextContent('get_users');
    fireEvent.click(getByText('Method'));
    rows = getAllByRole('row');
    // New column starts at 'asc': 'get' sorts before 'post'.
    expect(rows[1]).toHaveTextContent('get_users');
  });

  it('collapses an expanded row back on a second click', () => {
    // `Collapse`'s `unmountOnExit` removes its content — and its own
    // `MuiCollapse-hidden` class — only once `react-transition-group`'s exit
    // transition completes; jsdom never fires a real `transitionend`, so
    // neither signal flips synchronously in this environment. `ToolRow`'s
    // own `isExpanded` state IS reflected synchronously, though, via which
    // chevron icon it renders (`KeyboardArrowDownIcon` expanded /
    // `KeyboardArrowRightIcon` collapsed) — asserted on directly instead.
    const { getByText, container } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    fireEvent.click(getByText('get_users'));
    expect(container.querySelector('[data-testid="KeyboardArrowDownIcon"]')).toBeInTheDocument();
    fireEvent.click(getByText('get_users'));
    expect(container.querySelector('[data-testid="KeyboardArrowDownIcon"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="KeyboardArrowRightIcon"]')).toBeInTheDocument();
  });

  it('toggles expansion via the chevron icon button without double-toggling from the row\'s own click handler (stopPropagation)', () => {
    const { container } = renderWithTheme(<OpenAPIActionsTable tools={TOOLS} />);
    // `TableSortLabel` (the header sort controls) renders `role="button"` on
    // a plain `<span>`, not a real `<button>` element — the only actual
    // `<button>` tags in this tree are the per-row chevron `IconButton`s, so
    // a bare tag-name query (not an internal MUI class selector, R-T6)
    // reaches the first row's expand toggle unambiguously.
    const expandButton = container.querySelector('button');
    if (!expandButton) throw new Error('Expand icon button not found');
    fireEvent.click(expandButton);
    // A single click on the icon button expands exactly once (not twice —
    // the icon's own `onClick` calls `event.stopPropagation()` before the
    // row's own `onClick` would otherwise also fire and immediately
    // re-collapse it).
    expect(container.querySelector('[data-testid="KeyboardArrowDownIcon"]')).toBeInTheDocument();
    fireEvent.click(expandButton);
    expect(container.querySelector('[data-testid="KeyboardArrowDownIcon"]')).not.toBeInTheDocument();
  });

  it('shows only the description when a tool has no path', () => {
    const tools: OpenAPIAction[] = [{ name: 'no_path_tool', method: 'get', description: 'Only a description' }];
    const { getByText, queryByText } = renderWithTheme(<OpenAPIActionsTable tools={tools} />);
    fireEvent.click(getByText('no_path_tool'));
    expect(getByText('Only a description')).toBeInTheDocument();
    expect(queryByText('Path:')).not.toBeInTheDocument();
  });

  it('shows only the path when a tool has no description', () => {
    const tools: OpenAPIAction[] = [{ name: 'no_desc_tool', method: 'get', path: '/only-path' }];
    const { getByText, queryByText } = renderWithTheme(<OpenAPIActionsTable tools={tools} />);
    fireEvent.click(getByText('no_desc_tool'));
    expect(getByText('/only-path')).toBeInTheDocument();
    expect(queryByText('Description:')).not.toBeInTheDocument();
  });

  it('shows neither detail row when a tool has no description and no path', () => {
    const tools: OpenAPIAction[] = [{ name: 'bare_tool', method: 'get' }];
    const { getByText, queryByText } = renderWithTheme(<OpenAPIActionsTable tools={tools} />);
    fireEvent.click(getByText('bare_tool'));
    expect(queryByText('Description:')).not.toBeInTheDocument();
    expect(queryByText('Path:')).not.toBeInTheDocument();
  });

  it('prefers the tools prop over selected_tools when both are given', () => {
    const { getByText, queryByText } = renderWithTheme(
      <OpenAPIActionsTable
        tools={TOOLS}
        selected_tools={[{ name: 'legacy_tool', method: 'get' }]}
      />,
    );
    expect(getByText('get_users')).toBeInTheDocument();
    expect(queryByText('legacy_tool')).not.toBeInTheDocument();
  });

  it('falls back to the row index as the React key when a tool has an empty name (no visible effect, but exercises the key fallback branch)', () => {
    const tools: OpenAPIAction[] = [{ name: '', method: 'get', path: '/unnamed' }];
    const { getAllByRole } = renderWithTheme(<OpenAPIActionsTable tools={tools} />);
    // header row + 1 data row + its (collapsed) details row.
    expect(getAllByRole('row')).toHaveLength(3);
  });

  // `compareValues`/`compareStrings`/`compareNumeric`/`getValueType` are
  // module-private (not exported) and, through this component's OWN typed
  // `OpenAPIAction` prop, `method`/`name` (the only two sortable fields) are
  // always strings in every real caller — so the mixed-type/numeric branches
  // below are only reachable by deliberately handing the table a `method`
  // value outside its declared type (an `as unknown as OpenAPIAction[]`
  // cast), the same way a malformed/legacy backend payload could in
  // production (this component trusts its `tools` prop's shape at runtime,
  // same as `shared/lib/sort.ts`'s own `descendingComparator` doc comment
  // discloses for the identical "untyped-data-shaped" pattern it re-uses).
  it('sorts mixed-type method values through every getValueType/compareValues branch (string/number/boolean/null-undefined)', () => {
    const mixedTools = [
      { name: 'string-a', method: 'get' },
      { name: 'string-b', method: 'post' },
      { name: 'number', method: 5 },
      { name: 'boolean', method: true },
      { name: 'nullish', method: undefined },
    ] as unknown as OpenAPIAction[];
    const { getByText } = renderWithTheme(<OpenAPIActionsTable tools={mixedTools} />);
    // Exercising every `getValueType`/`compareValues` branch without
    // throwing (and without depending on the exact resulting order, which is
    // an implementation detail of V8's sort algorithm for mixed types) is
    // this test's real assertion — every row must still render regardless.
    expect(() => fireEvent.click(getByText('Method'))).not.toThrow();
    expect(getByText('string-a')).toBeInTheDocument();
    expect(getByText('nullish')).toBeInTheDocument();
    // Re-sorting descending exercises the same branches with `order` flipped.
    expect(() => fireEvent.click(getByText('Method'))).not.toThrow();
    expect(getByText('boolean')).toBeInTheDocument();
  });
});
