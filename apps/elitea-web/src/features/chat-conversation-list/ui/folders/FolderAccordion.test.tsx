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

  it('gives the accordion-summary content wrapper a shrinkable min-width, so a long title can ellipsize (baseline parity)', () => {
    // jsdom does no real layout, so actual ellipsis truncation can't be
    // observed here — this asserts the CSS min-width CHAIN this fix
    // restores instead: without it, the flex item wrapping the title (an
    // internal `AccordionSummary` DOM node this codebase's `elitea/no-mui-
    // internal-selector` lint rule bans naming directly — reached instead,
    // disclosed in `summarySx`'s own doc comment, via the plain `'& > *'`
    // child-combinator on the `AccordionSummary` root) keeps its default
    // `min-width: auto`, which blocks `titleTextSx`'s `overflow: hidden`/
    // `textOverflow: ellipsis` from ever engaging.
    const { getByRole } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
      />,
    );
    const summaryButton = getByRole('button', { name: 'My folder' });
    const contentWrapper = summaryButton.children[0];
    expect(contentWrapper).toBeDefined();
    expect(window.getComputedStyle(contentWrapper as Element).minWidth).toBe('0px');
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

  it('keeps the menu trigger container visible while its ControlsDropdown menu is open, even after the mouse leaves the row', async () => {
    // Disclosed-gap regression: `interaction.showMenu` (never set by
    // `FolderItem.tsx` — `ControlsDropdown` exposes no onOpen/onClose
    // callback to drive it from, see this file's own module doc) must not
    // be the only thing keeping the trigger up. `menuContainerSx`'s
    // `:has([aria-expanded="true"])` rule reads `ControlsDropdown`'s own
    // trigger state directly instead, so the container should stay
    // `display:flex` for the whole time the menu is open regardless of
    // hover. Trigger queried by `aria-label` attribute and clicked via
    // `fireEvent` (not `userEvent`), same jsdom-`:hover`-limitation
    // workaround this file's own "renders the pre-bound menuItems" test
    // above already establishes: the container is CSS-hidden absent a real
    // hover, which `userEvent.click` correctly refuses to interact with.
    const user = userEvent.setup();
    const { container, getByRole } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
      />,
    );
    // `data-testid`, not a DOM `id`: every mounted FolderAccordion used to
    // carry the SAME literal id, which is invalid HTML with >1 folder on
    // screen (and the same class of defect as the summary's dangling
    // `aria-controls`). The hover rule is an attribute selector now.
    const menuContainer = container.querySelector('[data-testid="folder-accordion-menu-container"]');
    const trigger = container.querySelector('[aria-label="Folder actions"]');
    expect(menuContainer).not.toBeNull();
    expect(trigger).not.toBeNull();

    // Not hovering, menu not open: container is display:none, same as before this fix.
    expect(window.getComputedStyle(menuContainer as Element).display).toBe('none');

    fireEvent.click(trigger as Element);
    expect(getByRole('menu')).toBeInTheDocument();
    // Menu is open, mouse never entered the row: container must stay visible.
    expect(window.getComputedStyle(menuContainer as Element).display).toBe('flex');

    await user.click(getByRole('menuitem', { name: 'Delete' }));
    expect(window.getComputedStyle(menuContainer as Element).display).toBe('none');
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

  /*
   * The summary's `aria-controls` used to name `folder-accordion-panel-0` —
   * an id no element carried, on EVERY mounted folder (`index` is always 0,
   * one item per folder). axe reports the dangling reference as
   * `aria-valid-attr-value`, impact "critical": following the control from
   * the summary landed nowhere. It only became visible once the slice was
   * first mounted on a route (issue #128).
   */
  it('points aria-controls at a panel that actually exists', () => {
    const { container, getByRole } = renderWithProviders(
      <FolderAccordion
        items={[{ title: 'My folder', content: 'Folder body' }]}
        menuItems={MENU_ITEMS}
        defaultExpanded
      />,
    );
    const controls = getByRole('button', { name: /My folder/ }).getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    const panel = container.querySelector(`#${CSS.escape(controls as string)}`);
    expect(panel, 'aria-controls must resolve to a real element').not.toBeNull();
    expect(panel).toHaveTextContent('Folder body');
  });

  it('gives two mounted accordions distinct panel ids', () => {
    const { container } = renderWithProviders(
      <>
        <FolderAccordion
          items={[{ title: 'Folder A', content: 'A body' }]}
          menuItems={MENU_ITEMS}
        />
        <FolderAccordion
          items={[{ title: 'Folder B', content: 'B body' }]}
          menuItems={MENU_ITEMS}
        />
      </>,
    );
    const ids = [...container.querySelectorAll('[aria-controls]')].map((el) => el.getAttribute('aria-controls'));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size, 'each accordion must own its panel id — a shared literal id is invalid HTML').toBe(2);
  });
});
