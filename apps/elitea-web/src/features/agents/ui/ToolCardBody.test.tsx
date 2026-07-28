import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ToolCardBody } from './ToolCardBody';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('ToolCardBody', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the toolkit name and BaseCardBody for a plain (non-agent/pipeline) tool', () => {
    const { getByText } = renderWithTheme(
      <ToolCardBody
        tool={{ type: 'github', description: 'Reads repos', settings: {} }}
        toolkitName="GitHub"
        isAttachmentToolkit={false}
        isAgentOrPipeline={false}
        onToggleVariables={vi.fn()}
        showVariables={false}
        showActions={false}
        onClickShowActions={vi.fn()}
      />,
    );
    expect(getByText('GitHub')).toBeInTheDocument();
    expect(getByText('Reads repos')).toBeInTheDocument();
  });

  it('renders the version selector (not BaseCardBody) for an agent/pipeline tool when versionSelector is supplied', () => {
    const { queryByTestId, getByText } = renderWithTheme(
      <ToolCardBody
        tool={{ type: 'application', settings: { application_version_id: 1 } }}
        toolkitName="My Agent"
        isAttachmentToolkit={false}
        isAgentOrPipeline
        versionSelector={{ versions: [{ id: 1, name: 'base' }], onSelectVersion: vi.fn() }}
        onToggleVariables={vi.fn()}
        showVariables={false}
        showActions={false}
        onClickShowActions={vi.fn()}
      />,
    );
    expect(getByText('base')).toBeInTheDocument();
    expect(queryByTestId('base-card-body-toggle')).not.toBeInTheDocument();
  });

  it('shows the attachment-toolkit badge icon', () => {
    const { container } = renderWithTheme(
      <ToolCardBody
        tool={{ type: 'artifact', settings: {} }}
        toolkitName="Artifact"
        isAttachmentToolkit
        isAgentOrPipeline={false}
        onToggleVariables={vi.fn()}
        showVariables={false}
        showActions={false}
        onClickShowActions={vi.fn()}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows a variables toggle with a count when the tool has variables, and calls onToggleVariables on click', async () => {
    const user = userEvent.setup();
    const onToggleVariables = vi.fn();
    const { getByText } = renderWithTheme(
      <ToolCardBody
        tool={{ type: 'github', settings: {}, variables: [{ name: 'TOKEN', value: 'x' }] }}
        toolkitName="GitHub"
        isAttachmentToolkit={false}
        isAgentOrPipeline={false}
        onToggleVariables={onToggleVariables}
        showVariables={false}
        showActions={false}
        onClickShowActions={vi.fn()}
      />,
    );
    expect(getByText('(1)')).toBeInTheDocument();
    await user.click(getByText('Show variables'));
    expect(onToggleVariables).toHaveBeenCalledTimes(1);
  });
});
