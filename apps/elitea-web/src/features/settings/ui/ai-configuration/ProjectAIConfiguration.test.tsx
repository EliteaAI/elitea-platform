/**
 * Regression coverage for `spec-llm-project-scope` §9.3.
 *
 * The panel used to show `OpenAI-Project: <model project>` beside
 * `Project ID: <working project>`. Two project ids, side by side, with no text
 * to tell a reader which one pays. The first also named a header the `/llm`
 * edge discards (§6.1). §9.3 permits the panel to keep the model project with
 * a label that distinguishes it, or to drop it. It drops it.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import ProjectAIConfiguration from './ProjectAIConfiguration';

const WORKING_PROJECT_ID = '77';

describe('ProjectAIConfiguration', () => {
  it('shows the billing project id', () => {
    renderWithTheme(
      <ProjectAIConfiguration userApiUrl="https://elitea.example.test/api/v2" projectId={WORKING_PROJECT_ID} />,
    );
    expect(screen.getByText('Project ID:')).toBeInTheDocument();
    expect(screen.getByText(WORKING_PROJECT_ID)).toBeInTheDocument();
  });

  it('does not advertise an OpenAI-Project field', () => {
    renderWithTheme(
      <ProjectAIConfiguration userApiUrl="https://elitea.example.test/api/v2" projectId={WORKING_PROJECT_ID} />,
    );
    expect(screen.queryByText(/OpenAI-Project/)).not.toBeInTheDocument();
  });

  it('shows exactly one project id, so no reader has to guess which pays', () => {
    renderWithTheme(
      <ProjectAIConfiguration userApiUrl="https://elitea.example.test/api/v2" projectId={WORKING_PROJECT_ID} />,
    );
    expect(screen.getAllByText(WORKING_PROJECT_ID)).toHaveLength(1);
  });

  it('keeps the OpenAI base URL', () => {
    renderWithTheme(
      <ProjectAIConfiguration userApiUrl="https://elitea.example.test/api/v2" projectId={WORKING_PROJECT_ID} />,
    );
    expect(screen.getByText('https://elitea.example.test/llm/v1')).toBeInTheDocument();
  });
});
