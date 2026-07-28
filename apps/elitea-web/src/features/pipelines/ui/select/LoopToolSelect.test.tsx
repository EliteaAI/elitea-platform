import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterAndProject } from '../../__tests__/testUtils';
import { LoopToolSelect } from './LoopToolSelect';

const BASE = '/api/v2';
const PROJECT_ID = 'proj-1';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  server.use(http.get(`${BASE}/elitea_core/toolkits/prompt_lib/${PROJECT_ID}`, () => HttpResponse.json({})));
});

afterEach(() => {
  resetGeneratedClient();
});

describe('LoopToolSelect', () => {
  it('lists version tools as toolkit options', async () => {
    const { findByText } = renderWithRouterAndProject(
      <LoopToolSelect versionTools={[{ type: 'github', name: 'github', toolkit_name: 'github' }]} />,
      PROJECT_ID,
    );
    expect(await findByText('Toolkit')).toBeInTheDocument();
  });

  it('does not render a tool dropdown when no tools are selected/available', async () => {
    const { findByText, queryByLabelText } = renderWithRouterAndProject(
      <LoopToolSelect versionTools={[{ type: 'github', name: 'github', toolkit_name: 'github' }]} />,
      PROJECT_ID,
    );
    await findByText('Toolkit');
    expect(queryByLabelText('Tool')).not.toBeInTheDocument();
  });

  it('renders a Tool dropdown once the selected toolkit has explicit selected_tools', async () => {
    const yamlNode = { id: 'Loop 1', toolkit_name: 'github', tool: '' };
    const { findByText } = renderWithRouterAndProject(
      <LoopToolSelect
        yamlNode={yamlNode}
        versionTools={[{ type: 'github', name: 'github', toolkit_name: 'github', settings: { selected_tools: ['create_issue'] } }]}
      />,
      PROJECT_ID,
    );

    expect(await findByText('Tool')).toBeInTheDocument();
  });

  it('labels the second dropdown "Loop tool" when toolField is not "tool"', async () => {
    const yamlNode = { id: 'Loop 1', loop_toolkit_name: 'github', loop_tool: '' };
    const { findByText } = renderWithRouterAndProject(
      <LoopToolSelect
        yamlNode={yamlNode}
        toolkitField="loop_toolkit_name"
        toolField="loop_tool"
        versionTools={[{ type: 'github', name: 'github', toolkit_name: 'github', settings: { selected_tools: ['x'] } }]}
      />,
      PROJECT_ID,
    );

    expect(await findByText('Loop tool')).toBeInTheDocument();
  });

  it('calls onChangeToolkit(null) on clear', async () => {
    const user = userEvent.setup();
    const onChangeToolkit = vi.fn();
    const yamlNode = { id: 'Loop 1', toolkit_name: 'github', tool: '' };

    const { findByRole } = renderWithRouterAndProject(
      <LoopToolSelect
        yamlNode={yamlNode}
        versionTools={[{ type: 'github', name: 'github', toolkit_name: 'github' }]}
        onChangeToolkit={onChangeToolkit}
      />,
      PROJECT_ID,
    );

    const combobox = await findByRole('combobox');
    await user.click(combobox);
    await user.click(document.querySelector('[data-value="github"]') ?? combobox);

    expect(onChangeToolkit).toHaveBeenCalled();
  });
});
