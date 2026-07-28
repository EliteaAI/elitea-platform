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
});
