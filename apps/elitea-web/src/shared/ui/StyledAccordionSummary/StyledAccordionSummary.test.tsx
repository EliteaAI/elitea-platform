import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { StyledAccordionSummary } from '.';

describe('StyledAccordionSummary', () => {
  it('renders its children and the supplied expand icon', () => {
    const { getByText, getByTestId } = renderWithTheme(
      <Accordion>
        <StyledAccordionSummary expandIcon={<span data-testid="chevron" />}>Panel title</StyledAccordionSummary>
        <AccordionDetails>Body</AccordionDetails>
      </Accordion>,
    );
    expect(getByText('Panel title')).toBeInTheDocument();
    expect(getByTestId('chevron')).toBeInTheDocument();
  });

  it('rotates the expand icon 90 degrees when expanded, not MUI\'s default 180', async () => {
    // The base icon is a RIGHT chevron, so 90deg points it DOWN and 180deg
    // points it LEFT. MUI's own rule for the expanded icon slot is qualified
    // by two classes — specificity (0,2,0) — and rotates it 180deg; a rotation
    // computed from `ownerState` lands in a
    // single generated class at (0,1,0) and LOSES, which is how every
    // accordion in the app ended up with a left-pointing chevron while the
    // source read `rotate(90deg)`. Asserting the emitted rule is what
    // discriminates — the render tests above pass either way.
    const { getByRole, getByTestId } = renderWithTheme(
      <Accordion>
        <StyledAccordionSummary expandIcon={<span data-testid="chevron" />}>Panel title</StyledAccordionSummary>
        <AccordionDetails>Body</AccordionDetails>
      </Accordion>,
    );
    await userEvent.click(getByRole('button', { name: 'Panel title' }));

    // Reached through the icon rather than by an internal MUI class selector,
    // which R-T6 reserves for `shared/brand/mui-overrides/`.
    const wrapper = getByTestId('chevron').parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass('Mui-expanded');

    // MUI's own `rotate(180deg)` rule stays in the sheet — it has to LOSE, not
    // be absent. At equal specificity that means ours must come later, so the
    // invariant to assert is cascade ORDER, not presence.
    const css = [...document.querySelectorAll('style')].map((n) => n.textContent ?? '').join('');
    const ours = css.lastIndexOf('rotate(90deg)');
    const theirs = css.lastIndexOf('rotate(180deg)');
    expect(ours, 'our 90deg rotation is not emitted at all').toBeGreaterThan(-1);
    expect(theirs, "MUI's 180deg rule is missing — this test no longer proves anything").toBeGreaterThan(-1);
    expect(ours, 'MUI\'s 180deg rule is emitted after ours and wins the cascade').toBeGreaterThan(theirs);
  });

  it('exposes aria-expanded=false before interaction', () => {
    const { getByRole } = renderWithTheme(
      <Accordion>
        <StyledAccordionSummary>Panel title</StyledAccordionSummary>
        <AccordionDetails>Body</AccordionDetails>
      </Accordion>,
    );
    expect(getByRole('button', { name: 'Panel title' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('flips aria-expanded to true when clicked (toggle wiring intact)', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <Accordion>
        <StyledAccordionSummary>Panel title</StyledAccordionSummary>
        <AccordionDetails>Body</AccordionDetails>
      </Accordion>,
    );
    await user.click(getByRole('button', { name: 'Panel title' }));
    expect(getByRole('button', { name: 'Panel title' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders correctly with showMode="right" (the non-default branch)', () => {
    const { getByRole } = renderWithTheme(
      <Accordion>
        <StyledAccordionSummary showMode="right">Right mode</StyledAccordionSummary>
        <AccordionDetails>Body</AccordionDetails>
      </Accordion>,
    );
    expect(getByRole('button', { name: 'Right mode' })).toBeInTheDocument();
  });

  it("wires id + aria-controls through to Accordion's own region labelling (R-C1 fix)", () => {
    const { getByRole } = renderWithTheme(
      <Accordion defaultExpanded>
        <StyledAccordionSummary
          id="summary-1"
          aria-controls="panel-1"
        >
          Panel title
        </StyledAccordionSummary>
        <AccordionDetails>Body content</AccordionDetails>
      </Accordion>,
    );
    // Accordion wires `aria-labelledby={summary.props.id}` and
    // `id={summary.props['aria-controls']}` onto its region — proving the
    // region resolves confirms both attributes reached the summary root.
    const region = getByRole('region', { name: 'Panel title' });
    expect(region).toHaveAttribute('id', 'panel-1');
  });

  it('rotates the expand-icon wrapper differently between collapsed and expanded (slotProps.expandIconWrapper reads ownerState.expanded)', async () => {
    const user = userEvent.setup();
    const { getByRole, getByTestId } = renderWithTheme(
      <Accordion>
        <StyledAccordionSummary expandIcon={<span data-testid="chevron" />}>Title</StyledAccordionSummary>
        <AccordionDetails>Body</AccordionDetails>
      </Accordion>,
    );
    const wrapper = getByTestId('chevron').parentElement;
    expect(wrapper).not.toBeNull();
    const collapsedTransform = wrapper ? getComputedStyle(wrapper).transform : '';

    await user.click(getByRole('button', { name: 'Title' }));

    const expandedTransform = wrapper ? getComputedStyle(wrapper).transform : '';
    expect(expandedTransform).not.toBe(collapsedTransform);
  });

  it('forwards additional props (data-testid) through ...rest', () => {
    const { getByTestId } = renderWithTheme(
      <Accordion>
        <StyledAccordionSummary data-testid="summary-root">Title</StyledAccordionSummary>
        <AccordionDetails>Body</AccordionDetails>
      </Accordion>,
    );
    expect(getByTestId('summary-root')).toBeInTheDocument();
  });
});
