import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ResearchTodosPanel } from './ResearchTodosPanel';

describe('ResearchTodosPanel', () => {
  it('renders nothing when there is no plan', () => {
    render(<ResearchTodosPanel todos={null} />);
    expect(screen.queryByTestId('wiki-chat-todos')).toBeNull();
  });

  it('renders nothing for an EMPTY plan, which is not the same as having one', () => {
    // `openTurn` resets the plan to [] at the start of every turn, so this is
    // the state the panel is in for the whole of an `ask` run and for the first
    // seconds of a research one. An empty panel there claims a plan exists and
    // is empty — a different statement from "this run has no plan".
    render(<ResearchTodosPanel todos={[]} />);
    expect(screen.queryByTestId('wiki-chat-todos')).toBeNull();
  });

  it('renders each step, with its status when the provider sent one', () => {
    render(
      <ResearchTodosPanel
        todos={[
          { id: 1, title: 'Read the README', status: 'pending' },
          { id: 2, title: 'Trace the router' },
        ]}
      />,
    );
    expect(screen.getByTestId('wiki-chat-todos')).toBeVisible();
    expect(screen.getByText('Read the README')).toBeVisible();
    expect(screen.getByText('pending')).toBeVisible();
    expect(screen.getByText('Trace the router')).toBeVisible();
  });

  it('names a step the provider left untitled', () => {
    // The alternative is a blank row, which reads as a rendering fault rather
    // than as a payload that carried no title.
    render(<ResearchTodosPanel todos={[{ id: 3 }]} />);
    expect(screen.getByText('Untitled step')).toBeVisible();
  });
});
