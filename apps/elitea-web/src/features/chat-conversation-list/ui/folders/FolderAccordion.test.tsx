import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ControlsDropdownItem } from '@/shared/ui/ControlsDropdown';

import { renderWithProviders } from '../../__tests__/testUtils';
import { FolderAccordion } from './FolderAccordion';

const MENU_ITEMS: ControlsDropdownItem[] = [{ key: 'delete', label: 'Delete', onClick: vi.fn() }];

// jsdom has no ResizeObserver; `TypographyWithConditionalTooltip` (the
// folder title) mounts the real `useTextOverflow` hook, which creates one
// unconditionally — same stub `TypographyWithConditionalTooltip.test.tsx`
// itself already establishes for the identical situation.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FolderAccordion', () => {
  it('renders the title and, when expanded, the content', () => {
    const { getByRole, getByText } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
        defaultExpanded
      />,
    );
    expect(getByRole('button', { name: 'My folder' })).toBeInTheDocument();
    expect(getByText('Folder body')).toBeVisible();
  });

  it('starts collapsed when defaultExpanded is false', () => {
    const { getByText } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
      />,
    );
    expect(getByText('Folder body')).not.toBeVisible();
  });

  it('toggles expansion when the summary row is clicked', async () => {
    const user = userEvent.setup();
    const { getByRole, getByText } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
      />,
    );
    expect(getByText('Folder body')).not.toBeVisible();
    await user.click(getByRole('button', { name: 'My folder' }));
    expect(getByText('Folder body')).toBeVisible();
  });

  it('re-expands once defaultExpanded flips to true, even after a manual collapse (baseline one-way sync)', () => {
    const { getByText, rerender } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
      />,
    );
    expect(getByText('Folder body')).not.toBeVisible();

    rerender(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
        defaultExpanded
      />,
    );
    expect(getByText('Folder body')).toBeVisible();
  });

  it('renders a pin indicator when isPinned', () => {
    const { getByLabelText } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
        isPinned
      />,
    );
    expect(getByLabelText('Pinned')).toBeInTheDocument();
  });

  it('does not render a pin indicator by default', () => {
    const { queryByLabelText } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
      />,
    );
    expect(queryByLabelText('Pinned')).not.toBeInTheDocument();
  });

  it('renders the pre-bound menuItems through ControlsDropdown', async () => {
    // The menu trigger's actual `visibility: visible` only comes from a REAL
    // CSS `:hover` pseudo-class rule (`&:hover #${MENU_CONTAINER_ID}`,
    // `FolderAccordion.tsx`'s own `summaryContainerSx`, ported from the
    // baseline's identical "only show the dot-menu on hover" UX) — jsdom
    // does not evaluate `:hover` pseudo-class matching from dispatched mouse
    // events at all (a well-known jsdom limitation, not a defect in this
    // component: it works in a real browser). Per the W3C accessible-name
    // computation spec, an element inside a `visibility: hidden` ancestor
    // computes an EMPTY accessible name regardless of its own `aria-label`
    // — `getByRole(..., {hidden: true})` therefore finds the element but
    // NOT by its real name. Queried by `aria-label` attribute directly
    // instead (a plain attribute selector, not an internal Mui/Emotion
    // class — `elitea/no-mui-internal-selector` does not apply), clicked
    // via `fireEvent` (not `userEvent`, which additionally refuses to
    // interact with a CSS-hidden element) to still exercise the real click
    // -> `ControlsDropdown` -> `onClick` path.
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { container, getByRole } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={[{ key: 'delete', label: 'Delete folder', onClick }]}
      />,
    );
    const trigger = container.querySelector('[aria-label="Folder actions"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger as Element);
    await user.click(getByRole('menuitem', { name: 'Delete folder' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fires onMouseEnter/onMouseLeave from the interaction bag on the summary row', () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const { getByRole } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
        interaction={{ onMouseEnter, onMouseLeave }}
      />,
    );
    // `onMouseEnter`/`onMouseLeave` are wired on the row wrapping the
    // summary button and the menu trigger (`FolderAccordion.tsx`'s own
    // `summaryContainerSx`-styled `Box`), not the summary button itself.
    const summaryRow = getByRole('button', { name: 'My folder' }).parentElement;
    expect(summaryRow).not.toBeNull();
    fireEvent.mouseEnter(summaryRow as HTMLElement);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(summaryRow as HTMLElement);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });
});
