import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isAgentOrPipelinePath, useIsFromApplication } from './useIsFromApplication';

describe('isAgentOrPipelinePath (pure)', () => {
  it.each([
    ['/agents', true],
    ['/agents/latest', true],
    ['/agents/edit/123', true],
    ['/pipelines', true],
    ['/pipelines/latest/456/base', true],
    ['/user-public/agents/1', true],
    ['/user-public/pipelines/1/base', true],
    ['/toolkits', false],
    ['/mcps', false],
    ['/', false],
    ['/agentsomethingelse', true], // startsWith is prefix-only, matching the baseline exactly
  ])('%s -> %s', (pathname, expected) => {
    expect(isAgentOrPipelinePath(pathname)).toBe(expected);
  });
});

function ProbeComponent() {
  const isFromApplication = useIsFromApplication();
  return <output>{String(isFromApplication)}</output>;
}

function renderAt(pathname: string) {
  const rootRoute = createRootRoute({ component: ProbeComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  return render(<RouterProvider router={router} />);
}

describe('useIsFromApplication (wiring)', () => {
  it('resolves true on an agents route', async () => {
    renderAt('/agents/latest');
    expect(await screen.findByText('true')).toBeInTheDocument();
  });

  it('resolves false on an unrelated route', async () => {
    renderAt('/toolkits');
    expect(await screen.findByText('false')).toBeInTheDocument();
  });
});
