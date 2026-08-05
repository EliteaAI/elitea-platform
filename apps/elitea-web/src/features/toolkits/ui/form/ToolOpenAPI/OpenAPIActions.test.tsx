import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { OpenAPIActions } from './OpenAPIActions';
import type { OpenAPIAction } from './OpenAPIActionsTable';

const TOOLS: readonly OpenAPIAction[] = [{ name: 'get_users', method: 'get' }];

describe('OpenAPIActions', () => {
  it('renders the "Api Endpoints" accordion title', () => {
    const { getByText } = renderWithTheme(<OpenAPIActions tools={TOOLS} />);
    expect(getByText('Api Endpoints')).toBeInTheDocument();
  });

  it('renders the tools table content once the panel is expanded', () => {
    const { getByText } = renderWithTheme(<OpenAPIActions tools={TOOLS} />);
    fireEvent.click(getByText('Api Endpoints'));
    expect(getByText('get_users')).toBeInTheDocument();
  });

  it('forwards the legacy selected_tools prop through to the table', () => {
    const { getByText } = renderWithTheme(<OpenAPIActions selected_tools={TOOLS} />);
    fireEvent.click(getByText('Api Endpoints'));
    expect(getByText('get_users')).toBeInTheDocument();
  });
});
