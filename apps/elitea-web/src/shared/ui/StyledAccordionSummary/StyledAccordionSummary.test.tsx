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
