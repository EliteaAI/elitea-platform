import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteError, RoutePending } from './RouteStatus';

describe('RoutePending', () => {
  it('renders a status role with loading copy', () => {
    render(<RoutePending />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});

describe('RouteError', () => {
  it('renders an alert with the Error instance message', () => {
    render(<RouteError error={new Error('boom')} reset={() => {}} info={{ componentStack: '' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent('boom');
  });

  it('stringifies a non-Error thrown value (a real, if unusual, runtime case: not every throw is an Error instance)', () => {
    const notAnError = 'plain string error' as unknown as Error;
    render(<RouteError error={notAnError} reset={() => {}} info={{ componentStack: '' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('plain string error');
  });
});
