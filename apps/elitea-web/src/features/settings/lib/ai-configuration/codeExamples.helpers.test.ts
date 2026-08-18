/**
 * Regression coverage for `spec-llm-project-scope` §9.1 and §9.2.
 *
 * The generated samples used to advertise `OpenAI-Project`. The `/llm` edge
 * reads `X-Project-Id`, then `OpenAI-Organization`, and discards
 * `OpenAI-Project` on purpose (§6.1). The Node and Python samples used the
 * OpenAI SDK `project` option, which both SDKs send as that same discarded
 * header. A caller who copied a sample therefore named no billing project.
 *
 * These tests hold the sample text to the header the edge accepts.
 */
import { describe, expect, it } from 'vitest';

import { CODE_EXAMPLE_TYPES } from './codeExamples';
import { BILLING_PROJECT_HEADER, generateCodeExample } from './codeExamples.helpers';

const API_URL = 'https://elitea.example.test/llm/v1';
const MODEL_NAME = 'gpt-4o-mini';
const AUTH_TOKEN = 'Your_Personal_Token';
/** The project the user works in — the project that pays. */
const WORKING_PROJECT_ID = '77';

const sampleFor = (language: string): string =>
  generateCodeExample(language, API_URL, MODEL_NAME, AUTH_TOKEN, WORKING_PROJECT_ID);

/** Two helpers, not one with a default parameter: a default value fires on an
 * explicit `undefined` argument, which made the omission tests assert on a
 * sample that still carried the project. */
const sampleWithoutProject = (language: string): string =>
  generateCodeExample(language, API_URL, MODEL_NAME, AUTH_TOKEN, undefined);

const ALL_LANGUAGES = [
  CODE_EXAMPLE_TYPES.CURL,
  CODE_EXAMPLE_TYPES.NODEJS,
  CODE_EXAMPLE_TYPES.PYTHON,
];

describe('BILLING_PROJECT_HEADER', () => {
  it('is the header the /llm edge reads', () => {
    expect(BILLING_PROJECT_HEADER).toBe('X-Project-Id');
  });
});

describe('generateCodeExample — curl', () => {
  it('sends the billing project in X-Project-Id', () => {
    expect(sampleFor(CODE_EXAMPLE_TYPES.CURL)).toContain('-H "X-Project-Id: 77"');
  });

  it('never mentions OpenAI-Project', () => {
    expect(sampleFor(CODE_EXAMPLE_TYPES.CURL)).not.toContain('OpenAI-Project');
  });

  it('omits the header when no project is known', () => {
    const code = sampleWithoutProject(CODE_EXAMPLE_TYPES.CURL);
    expect(code).not.toContain('X-Project-Id');
    expect(code).toContain('-H "Authorization: Bearer Your_Personal_Token"');
  });
});

describe('generateCodeExample — Node.js', () => {
  it('sends the billing project through defaultHeaders', () => {
    expect(sampleFor(CODE_EXAMPLE_TYPES.NODEJS)).toContain(
      "defaultHeaders: { 'X-Project-Id': '77' }",
    );
  });

  it('does not use the SDK project option', () => {
    const code = sampleFor(CODE_EXAMPLE_TYPES.NODEJS);
    expect(code).not.toContain('OpenAI-Project');
    expect(code).not.toMatch(/\bproject:\s*'/);
  });

  /*
   * The previous version put `project: '…'` on its own line after
   * `baseURL: '…'` with no comma, so every sample that carried a project was
   * a syntax error the moment a reader pasted it.
   */
  it('separates the client options with a comma', () => {
    expect(sampleFor(CODE_EXAMPLE_TYPES.NODEJS)).toContain(
      `baseURL: '${API_URL}',\n  defaultHeaders:`,
    );
  });

  it('omits the option when no project is known', () => {
    const code = sampleWithoutProject(CODE_EXAMPLE_TYPES.NODEJS);
    expect(code).not.toContain('X-Project-Id');
    expect(code).toContain(`baseURL: '${API_URL}'\n});`);
  });
});

describe('generateCodeExample — Python', () => {
  it('sends the billing project through default_headers', () => {
    expect(sampleFor(CODE_EXAMPLE_TYPES.PYTHON)).toContain(
      'default_headers={"X-Project-Id": "77"}',
    );
  });

  it('does not use the SDK project argument', () => {
    const code = sampleFor(CODE_EXAMPLE_TYPES.PYTHON);
    expect(code).not.toContain('OpenAI-Project');
    expect(code).not.toMatch(/\bproject\s*=\s*"/);
  });

  it('separates the client arguments with a comma', () => {
    expect(sampleFor(CODE_EXAMPLE_TYPES.PYTHON)).toContain(
      `base_url="${API_URL}",\n    default_headers=`,
    );
  });

  it('omits the argument when no project is known', () => {
    const code = sampleWithoutProject(CODE_EXAMPLE_TYPES.PYTHON);
    expect(code).not.toContain('X-Project-Id');
    expect(code).toContain(`base_url="${API_URL}"\n)`);
  });
});

describe('generateCodeExample — every language', () => {
  it.each(ALL_LANGUAGES)('%s renders the project id it is given, and no other', (language) => {
    const code = sampleFor(language);
    expect(code).toContain(BILLING_PROJECT_HEADER);
    expect(code).toContain(WORKING_PROJECT_ID);
  });

  it.each(ALL_LANGUAGES)('%s never mentions OpenAI-Project', (language) => {
    expect(sampleFor(language)).not.toContain('OpenAI-Project');
  });
});
