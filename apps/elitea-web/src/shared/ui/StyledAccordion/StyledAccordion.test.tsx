import type { SyntheticEvent } from 'react';

import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { StyledAccordion } from '.';

describe('StyledAccordion', () => {
  it('renders its summary and details children', () => {
    const { getByText } = renderWithTheme(
      <StyledAccordion>
        <AccordionSummary>Summary</AccordionSummary>
        <AccordionDetails>Details</AccordionDetails>
      </StyledAccordion>,
    );
    expect(getByText('Summary')).toBeInTheDocument();
    expect(getByText('Details')).toBeInTheDocument();
  });

  it('supports being expanded by default', () => {
    const { getByRole } = renderWithTheme(
      <StyledAccordion defaultExpanded>
        <AccordionSummary>Summary</AccordionSummary>
        <AccordionDetails>Details</AccordionDetails>
      </StyledAccordion>,
    );
    expect(getByRole('button', { name: 'Summary' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles expansion on click when uncontrolled', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <StyledAccordion>
        <AccordionSummary>Summary</AccordionSummary>
        <AccordionDetails>Details</AccordionDetails>
      </StyledAccordion>,
    );
    const button = getByRole('button', { name: 'Summary' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('merges a caller-supplied sx with its own default styles', () => {
    const { getByTestId } = renderWithTheme(
      <StyledAccordion
        data-testid="accordion-root"
        sx={{ marginTop: '1rem' }}
      >
        <AccordionSummary>Summary</AccordionSummary>
        <AccordionDetails>Details</AccordionDetails>
      </StyledAccordion>,
    );
    expect(getByTestId('accordion-root')).toBeInTheDocument();
  });

  it('forwards a controlled expanded/onChange pair', async () => {
    const user = userEvent.setup();
    let expanded = false;
    const handleChange = (_event: SyntheticEvent, next: boolean) => {
      expanded = next;
    };
    const { getByRole, rerender } = renderWithTheme(
      <StyledAccordion
        expanded={expanded}
        onChange={handleChange}
      >
        <AccordionSummary>Summary</AccordionSummary>
        <AccordionDetails>Details</AccordionDetails>
      </StyledAccordion>,
    );
    await user.click(getByRole('button', { name: 'Summary' }));
    expect(expanded).toBe(true);
    rerender(
      <StyledAccordion
        expanded={expanded}
        onChange={handleChange}
      >
        <AccordionSummary>Summary</AccordionSummary>
        <AccordionDetails>Details</AccordionDetails>
      </StyledAccordion>,
    );
    expect(getByRole('button', { name: 'Summary' })).toHaveAttribute('aria-expanded', 'true');
  });
});
