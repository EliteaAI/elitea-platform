import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ApplicationConfigurationLayout } from './ApplicationConfigurationLayout';

describe('ApplicationConfigurationLayout', () => {
  it('renders the editForm slot outside chat view', () => {
    renderWithTheme(
      <ApplicationConfigurationLayout
        viewMode="Owner"
        tools={<div data-testid="tools" />}
        editForm={<div data-testid="edit-form" />}
      />,
    );
    expect(screen.getByTestId('edit-form')).toBeInTheDocument();
  });

  it('hides the editForm slot in chat view', () => {
    renderWithTheme(
      <ApplicationConfigurationLayout
        viewMode="Owner"
        isChatView
        tools={<div data-testid="tools" />}
        editForm={<div data-testid="edit-form" />}
      />,
    );
    expect(screen.queryByTestId('edit-form')).not.toBeInTheDocument();
  });

  it('always renders the tools slot', () => {
    renderWithTheme(
      <ApplicationConfigurationLayout
        viewMode="Public"
        tools={<div data-testid="tools" />}
      />,
    );
    expect(screen.getByTestId('tools')).toBeInTheDocument();
  });

  it('renders welcomeMessage and conversationStarters only for the owner', () => {
    renderWithTheme(
      <ApplicationConfigurationLayout
        viewMode="Owner"
        tools={<div data-testid="tools" />}
        welcomeMessage={<div data-testid="welcome" />}
        conversationStarters={<div data-testid="starters" />}
      />,
    );
    expect(screen.getByTestId('welcome')).toBeInTheDocument();
    expect(screen.getByTestId('starters')).toBeInTheDocument();
  });

  it('hides welcomeMessage and conversationStarters for a non-owner viewMode', () => {
    renderWithTheme(
      <ApplicationConfigurationLayout
        viewMode="Public"
        tools={<div data-testid="tools" />}
        welcomeMessage={<div data-testid="welcome" />}
        conversationStarters={<div data-testid="starters" />}
      />,
    );
    expect(screen.queryByTestId('welcome')).not.toBeInTheDocument();
    expect(screen.queryByTestId('starters')).not.toBeInTheDocument();
  });

  it('renders advanceSettings, editorNotes and information regardless of viewMode', () => {
    renderWithTheme(
      <ApplicationConfigurationLayout
        viewMode="Public"
        tools={<div data-testid="tools" />}
        advanceSettings={<div data-testid="advance" />}
        editorNotes={<div data-testid="notes" />}
        information={<div data-testid="info" />}
      />,
    );
    expect(screen.getByTestId('advance')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toBeInTheDocument();
    expect(screen.getByTestId('info')).toBeInTheDocument();
  });
});
