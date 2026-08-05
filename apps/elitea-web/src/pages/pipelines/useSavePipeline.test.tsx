import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSavePipeline } from './useSavePipeline';

function ProbeComponent() {
  const result = useSavePipeline();
  return (
    <output>
      {JSON.stringify({
        isFromPipeline: result.isFromPipeline,
        nodes: result.nodes,
        edges: result.edges,
        yamlCode: result.yamlCode,
      })}
    </output>
  );
}

function renderAt(pathname: string) {
  const rootRoute = createRootRoute({ component: ProbeComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  return render(<RouterProvider router={router} />);
}

describe('useSavePipeline', () => {
  it('isFromPipeline is true on a pipeline detail route (/pipelines/:tab/:agentId)', async () => {
    renderAt('/pipelines/latest/42');
    const output = await screen.findByText(/isFromPipeline/);
    expect(JSON.parse(output.textContent ?? '{}')).toMatchObject({ isFromPipeline: true });
  });

  it('isFromPipeline is true on /pipelines/create', async () => {
    renderAt('/pipelines/create');
    const output = await screen.findByText(/isFromPipeline/);
    expect(JSON.parse(output.textContent ?? '{}')).toMatchObject({ isFromPipeline: true });
  });

  it('isFromPipeline is false on the pipelines tabs listing page (not a detail/create route)', async () => {
    renderAt('/pipelines/latest');
    const output = await screen.findByText(/isFromPipeline/);
    expect(JSON.parse(output.textContent ?? '{}')).toMatchObject({ isFromPipeline: false });
  });

  it('isFromPipeline is false on an unrelated route, e.g. chat (no reachable pipeline-YAML signal to AND against)', async () => {
    renderAt('/chat');
    const output = await screen.findByText(/isFromPipeline/);
    expect(JSON.parse(output.textContent ?? '{}')).toMatchObject({ isFromPipeline: false });
  });

  it('always returns empty nodes/edges and an empty yamlCode (disclosed store gap, never fabricated data)', async () => {
    renderAt('/pipelines/latest/42');
    const output = await screen.findByText(/isFromPipeline/);
    expect(JSON.parse(output.textContent ?? '{}')).toEqual({
      isFromPipeline: true,
      nodes: [],
      edges: [],
      yamlCode: '',
    });
  });
});
