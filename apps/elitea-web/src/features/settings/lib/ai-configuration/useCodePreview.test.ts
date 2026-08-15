/**
 * Regression coverage for `spec-llm-project-scope` §9.1.
 *
 * `useCodePreview` receives the route project — the project the user works in,
 * which is the project that pays for a `/llm` call. A local
 * `const projectId = model?.project_id` used to shadow that parameter inside
 * the `codeExample` memo, so every generated sample carried the project that
 * OWNS the model. The models query passes `includeShared`, so for a shared
 * model that is the public project.
 *
 * The sample must name the working project. A test that only checks that some
 * project id appears cannot tell the two apart, so these tests give the two
 * projects distinct ids and assert on both.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as runtimeConfig from '@/shared/config';

import { CODE_EXAMPLE_TYPES } from './codeExamples';
import { useCodePreview } from './useCodePreview';

/** The project the user works in. */
const WORKING_PROJECT_ID = '77';
/** The project that owns the model — the public project for a shared model. */
const MODEL_PROJECT_ID = '424242';

const model = {
  name: 'gpt-4o-mini',
  model_name: 'gpt-4o-mini',
  integration_name: 'OpenAI',
  project_id: MODEL_PROJECT_ID,
};

const EXPECTED_HEADER_TEXT: Record<string, string> = {
  [CODE_EXAMPLE_TYPES.CURL]: '-H "X-Project-Id: 77"',
  [CODE_EXAMPLE_TYPES.NODEJS]: "defaultHeaders: { 'X-Project-Id': '77' }",
  [CODE_EXAMPLE_TYPES.PYTHON]: 'default_headers={"X-Project-Id": "77"}',
};

const ALL_LANGUAGES = [
  CODE_EXAMPLE_TYPES.CURL,
  CODE_EXAMPLE_TYPES.NODEJS,
  CODE_EXAMPLE_TYPES.PYTHON,
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(runtimeConfig, 'getConfig').mockReturnValue({
    status: 'ok',
    config: {
      vite_server_url: 'https://elitea.example.test/api/v2',
      vite_base_uri: '/',
      vite_public_project_id: MODEL_PROJECT_ID,
      allow_project_own_llms: false,
    },
  });
});

function renderPreview(language: string) {
  const hook = renderHook(() => useCodePreview(model, WORKING_PROJECT_ID));
  act(() => {
    hook.result.current.handleLanguageChange(language);
  });
  return hook.result.current.codeExample;
}

describe('useCodePreview — which project the sample bills', () => {
  it.each(ALL_LANGUAGES)('%s carries the working project, not the model project', (language) => {
    const code = renderPreview(language);
    expect(code).toContain(EXPECTED_HEADER_TEXT[language]);
    expect(code).not.toContain(MODEL_PROJECT_ID);
  });

  it.each(ALL_LANGUAGES)('%s never advertises OpenAI-Project', (language) => {
    expect(renderPreview(language)).not.toContain('OpenAI-Project');
  });

  it('keeps the model name, which does come from the model', () => {
    expect(renderPreview(CODE_EXAMPLE_TYPES.PYTHON)).toContain('gpt-4o-mini');
  });

  it('omits the header when the route has no project', () => {
    const hook = renderHook(() => useCodePreview(model, ''));
    expect(hook.result.current.codeExample).not.toContain('X-Project-Id');
    expect(hook.result.current.codeExample).not.toContain(MODEL_PROJECT_ID);
  });
});
