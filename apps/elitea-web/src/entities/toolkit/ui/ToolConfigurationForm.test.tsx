import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ToolConfigurationForm } from './ToolConfigurationForm';

describe('ToolConfigurationForm', () => {
  it('renders nothing configuration-related when configurationType is undefined', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType={undefined}
        configurationMode="Manual_Title"
        configurationPicker={<div data-testid="picker" />}
      />,
    );
    expect(screen.queryByTestId('picker')).not.toBeInTheDocument();
  });

  it('renders the configurationPicker slot when configurationType is set', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType="github"
        configurationMode="Manual_Title"
        configurationPicker={<div data-testid="picker" />}
      />,
    );
    expect(screen.getByTestId('picker')).toBeInTheDocument();
  });

  it('hides the configurationPicker slot when showOnlyConfigurationFields is true', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType="github"
        configurationMode="Manual_Title"
        showOnlyConfigurationFields
        configurationPicker={<div data-testid="picker" />}
      />,
    );
    expect(screen.queryByTestId('picker')).not.toBeInTheDocument();
  });

  it('shows the configurationNameField only in a Create_* mode', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType="github"
        configurationMode="Create_Personal_Title"
        configurationNameField={<div data-testid="name-field" />}
      />,
    );
    expect(screen.getByTestId('name-field')).toBeInTheDocument();
  });

  it('hides the configurationNameField for a real saved configuration title', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType="github"
        configurationMode="My Saved Config"
        configurationNameField={<div data-testid="name-field" />}
      />,
    );
    expect(screen.queryByTestId('name-field')).not.toBeInTheDocument();
  });

  it('hides the configurationNameField when hideConfigurationNameInput is true', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType="github"
        configurationMode="Create_Project_Title"
        hideConfigurationNameInput
        configurationNameField={<div data-testid="name-field" />}
      />,
    );
    expect(screen.queryByTestId('name-field')).not.toBeInTheDocument();
  });

  it('renders manual fields (children) in Manual/Create modes when showConfigurableFields is true', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType="github"
        configurationMode="Manual_Title"
      >
        <div data-testid="manual-fields" />
      </ToolConfigurationForm>,
    );
    expect(screen.getByTestId('manual-fields')).toBeInTheDocument();
  });

  it('hides manual fields for a real saved configuration title', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType="github"
        configurationMode="My Saved Config"
      >
        <div data-testid="manual-fields" />
      </ToolConfigurationForm>,
    );
    expect(screen.queryByTestId('manual-fields')).not.toBeInTheDocument();
  });

  it('hides manual fields when showConfigurableFields is false, even in Manual mode', () => {
    renderWithTheme(
      <ToolConfigurationForm
        configurationType="github"
        configurationMode="Manual_Title"
        showConfigurableFields={false}
      >
        <div data-testid="manual-fields" />
      </ToolConfigurationForm>,
    );
    expect(screen.queryByTestId('manual-fields')).not.toBeInTheDocument();
  });
});
