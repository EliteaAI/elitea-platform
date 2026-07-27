import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { StyledAccordionDetails } from '.';

describe('StyledAccordionDetails', () => {
  it('renders its children', () => {
    const { getByText } = renderWithTheme(<StyledAccordionDetails>Body content</StyledAccordionDetails>);
    expect(getByText('Body content')).toBeInTheDocument();
  });

  it('merges a caller-supplied sx with its own indent styling', () => {
    const { getByTestId } = renderWithTheme(
      <StyledAccordionDetails
        data-testid="details-root"
        sx={{ color: 'text.primary' }}
      >
        Body content
      </StyledAccordionDetails>,
    );
    expect(getByTestId('details-root')).toBeInTheDocument();
  });

  it('forwards additional native props (data-testid) through ...rest', () => {
    const { getByTestId } = renderWithTheme(
      <StyledAccordionDetails data-testid="details-root-2">Body</StyledAccordionDetails>,
    );
    expect(getByTestId('details-root-2')).toHaveTextContent('Body');
  });
});
