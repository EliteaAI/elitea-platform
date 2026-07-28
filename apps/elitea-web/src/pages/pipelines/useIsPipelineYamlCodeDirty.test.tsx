import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIsPipelineYamlCodeDirty } from './useIsPipelineYamlCodeDirty';

function ProbeComponent() {
  const isDirty = useIsPipelineYamlCodeDirty();
  return <output>{String(isDirty)}</output>;
}

function renderAt(pathname: string) {
  const rootRoute = createRootRoute({ component: ProbeComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  return render(<RouterProvider router={router} />);
}

describe('useIsPipelineYamlCodeDirty', () => {
  it('is always false on a pipeline detail route (disclosed store gap — no reachable live yamlCode to compare)', async () => {
    renderAt('/pipelines/latest/42');
    expect(await screen.findByText('false')).toBeInTheDocument();
  });

  it('is always false on /pipelines/create', async () => {
    renderAt('/pipelines/create');
    expect(await screen.findByText('false')).toBeInTheDocument();
  });

  it('is false outside any pipeline-editing context', async () => {
    renderAt('/pipelines/latest');
    expect(await screen.findByText('false')).toBeInTheDocument();
  });
});
