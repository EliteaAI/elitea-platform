import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AIAssistantPanelHeader } from './AIAssistantPanelHeader';

describe('AIAssistantPanelHeader', () => {
  it('renders the title', () => {
    const { getByText } = renderWithTheme(<AIAssistantPanelHeader title="Current Version" />);
    expect(getByText('Current Version')).toBeInTheDocument();
  });

  it('renders supplied actions', () => {
    const { getByText } = renderWithTheme(
      <AIAssistantPanelHeader
        title="Improved Version"
        actions={<button type="button">Apply</button>}
      />,
    );
    expect(getByText('Apply')).toBeInTheDocument();
  });

  it('renders nothing extra when actions is omitted', () => {
    const { container } = renderWithTheme(<AIAssistantPanelHeader title="Current Version" />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
