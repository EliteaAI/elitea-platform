import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { pickChartColor } from '../../lib/constants';
import { KpiCard } from './KpiCard';

describe('KpiCard', () => {
  it('renders label and value', () => {
    const { getByText } = renderWithTheme(
      <KpiCard
        label="TEAM"
        value="12"
      />,
    );
    expect(getByText('TEAM')).toBeInTheDocument();
    expect(getByText('12')).toBeInTheDocument();
  });

  it('renders an optional valueSuffix', () => {
    const { getByText } = renderWithTheme(
      <KpiCard
        label="TEAM"
        value="12"
        valueSuffix="of 20"
      />,
    );
    expect(getByText('of 20')).toBeInTheDocument();
  });

  it('omits the valueSuffix element entirely when not provided', () => {
    const { queryByText } = renderWithTheme(
      <KpiCard
        label="TEAM"
        value="12"
      />,
    );
    expect(queryByText('of 20')).not.toBeInTheDocument();
  });

  it('renders an optional badge', () => {
    const { getByText } = renderWithTheme(
      <KpiCard
        label="AI ACTIVE"
        value="8"
        badge="↑12%"
      />,
    );
    expect(getByText('↑12%')).toBeInTheDocument();
  });

  it('omits the badge element entirely when not provided', () => {
    const { queryByText } = renderWithTheme(
      <KpiCard
        label="AI ACTIVE"
        value="8"
      />,
    );
    expect(queryByText(/↑/)).not.toBeInTheDocument();
  });

  it('renders an optional subtitle', () => {
    const { getByText } = renderWithTheme(
      <KpiCard
        label="TEAM"
        value="12"
        subtitle="active members"
      />,
    );
    expect(getByText('active members')).toBeInTheDocument();
  });

  it('omits the subtitle element entirely when not provided', () => {
    const { queryByText } = renderWithTheme(
      <KpiCard
        label="TEAM"
        value="12"
      />,
    );
    expect(queryByText('active members')).not.toBeInTheDocument();
  });

  it('applies a custom colour to the value when provided, overriding the default', () => {
    // R-T1 (elitea/no-raw-color) walks every string literal in every
    // linted file, tests included — the sample colour comes from the real
    // chart ramp (`pickChartColor`), never a hand-typed hex/rgb literal.
    // jsdom's computed-style serialization of an arbitrary CSS colour
    // string is not guaranteed to round-trip byte-for-byte, so this
    // compares the WITH-colour render against a WITHOUT-colour render
    // instead of asserting an exact literal value either side.
    // Each render is queried strictly within its OWN container — RTL's
    // destructured `getByText` otherwise searches `document.body`, which
    // still holds the first render's DOM once a second one mounts
    // alongside it (no `cleanup()` between them within one test).
    const withoutColor = renderWithTheme(
      <KpiCard
        label="Errors"
        value="3"
      />,
    );
    const defaultValueNode = withoutColor.container.querySelector('h2');
    if (defaultValueNode === null) throw new Error('value node not found');
    const defaultColor = getComputedStyle(defaultValueNode).color;

    const withColor = renderWithTheme(
      <KpiCard
        label="Errors"
        value="3"
        color={pickChartColor(1)}
      />,
    );
    const overriddenValueNode = withColor.container.querySelector('h2');
    if (overriddenValueNode === null) throw new Error('value node not found');
    const overriddenColor = getComputedStyle(overriddenValueNode).color;

    expect(overriddenColor).not.toBe(defaultColor);
  });
});
