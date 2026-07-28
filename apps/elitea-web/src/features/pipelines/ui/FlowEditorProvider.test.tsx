import { useContext } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FlowEditorContext } from '../lib/flow-editor/flowEditorContext';
import { FlowEditorProvider } from './FlowEditorProvider';

function ContextProbe(): React.ReactNode {
  const value = useContext(FlowEditorContext);
  return <div data-testid="probe">{JSON.stringify({ editorHeight: value?.editorHeight, disabled: value?.disabled })}</div>;
}

describe('FlowEditorProvider', () => {
  it('supplies every field to FlowEditorContext consumers', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    const setFlowEdges = vi.fn();

    render(
      <FlowEditorProvider
        yamlJsonObject={{ nodes: [] }}
        setYamlJsonObject={setYamlJsonObject}
        setFlowNodes={setFlowNodes}
        setFlowEdges={setFlowEdges}
        editorHeight={480}
        editorWidth={640}
        disabled={false}
      >
        <ContextProbe />
      </FlowEditorProvider>,
    );

    expect(screen.getByTestId('probe').textContent).toBe(JSON.stringify({ editorHeight: 480, disabled: false }));
  });

  it('leaves the context undefined outside the provider (no default value)', () => {
    render(<ContextProbe />);
    expect(screen.getByTestId('probe').textContent).toBe(JSON.stringify({ editorHeight: undefined, disabled: undefined }));
  });

  it('renders children unchanged', () => {
    render(
      <FlowEditorProvider
        yamlJsonObject={{}}
        setYamlJsonObject={vi.fn()}
        setFlowNodes={vi.fn()}
        setFlowEdges={vi.fn()}
      >
        <span>canvas content</span>
      </FlowEditorProvider>,
    );

    expect(screen.getByText('canvas content')).toBeInTheDocument();
  });
});
