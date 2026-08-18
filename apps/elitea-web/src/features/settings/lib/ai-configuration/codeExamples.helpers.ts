/**
 * Code-example helpers for the AI Configuration feature.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/helpers/codeExamples.helpers.js`.
 */

import { CODE_EXAMPLE_TYPES } from './codeExamples';

/**
 * The header that names the project which pays for the call.
 *
 * `spec-llm-project-scope` §6.1: the `/llm` edge reads `X-Project-Id` first,
 * then `OpenAI-Organization`. It ignores `OpenAI-Project` on purpose.
 *
 * These samples used to emit `OpenAI-Project`, and `useCodePreview` filled it
 * from `model.project_id` — the project that OWNS the model. The models query
 * passes `includeShared`, so that value is often the public project, not the
 * project of the user. A caller who copied the sample sent a header the edge
 * discards, and read a project id that does not pay for anything. §9 of the
 * spec makes `X-Project-Id` and the working project the contract here.
 */
export const BILLING_PROJECT_HEADER = 'X-Project-Id';

export const getFileNameForLanguage = (language: string): string => {
  switch (language) {
    case CODE_EXAMPLE_TYPES.CURL:
      return 'api_example.sh';
    case CODE_EXAMPLE_TYPES.NODEJS:
      return 'api_example.js';
    case CODE_EXAMPLE_TYPES.PYTHON:
      return 'api_example.py';
    default:
      return 'api_example.txt';
  }
};

export const getEditorLanguage = (codeType: string): string => {
  switch (codeType) {
    case CODE_EXAMPLE_TYPES.CURL:
      return 'bash';
    case CODE_EXAMPLE_TYPES.NODEJS:
      return 'javascript';
    case CODE_EXAMPLE_TYPES.PYTHON:
      return 'python';
    default:
      return 'text';
  }
};

const generateCurlExample = (
  apiUrl: string,
  modelName: string,
  authToken: string,
  projectId: string | undefined,
): string => {
  const projectHeaderBlock = projectId ? `\n  -H "${BILLING_PROJECT_HEADER}: ${projectId}" \\` : '';

  return `curl ${apiUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${authToken}"\\${projectHeaderBlock}
  -d '{
    "model": "${modelName}",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "Write a haiku about recursion in programming."
      }
    ]
  }'`;
};

const generateNodejsExample = (
  apiUrl: string,
  modelName: string,
  authToken: string,
  projectId: string | undefined,
): string => {
  /*
   * `defaultHeaders`, not the `project` option: the OpenAI Node SDK sends
   * `project` as the `OpenAI-Project` header, which the edge discards.
   * The leading comma also repairs the sample — the previous version put
   * `project: '…'` on a new line after `baseURL: '…'` with no comma between
   * them, so every sample that carried a project was a syntax error.
   */
  const projectOption = projectId
    ? `,\n  defaultHeaders: { '${BILLING_PROJECT_HEADER}': '${projectId}' }`
    : '';

  return `import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '${authToken}',
  baseURL: '${apiUrl}'${projectOption}
});

async function main() {
  const completion = await client.chat.completions.create({
    model: '${modelName}',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant.'
      },
      {
        role: 'user',
        content: 'Write a haiku about recursion in programming.'
      }
    ],
  });

  console.log(completion.choices[0].message.content);
}

main();`;
};

const generatePythonExample = (
  apiUrl: string,
  modelName: string,
  authToken: string,
  projectId: string | undefined,
): string => {
  /*
   * `default_headers`, not the `project` argument: the OpenAI Python SDK
   * sends `project` as the `OpenAI-Project` header, which the edge discards.
   * The leading comma repairs the same missing-separator defect the Node
   * sample had.
   */
  const projectOption = projectId
    ? `,\n    default_headers={"${BILLING_PROJECT_HEADER}": "${projectId}"}`
    : '';

  return `from openai import OpenAI

client = OpenAI(
    api_key="${authToken}",
    base_url="${apiUrl}"${projectOption}
)

completion = client.chat.completions.create(
    model="${modelName}",
    messages=[
        {
            "role": "system",
            "content": "You are a helpful assistant."
        },
        {
            "role": "user",
            "content": "Write a haiku about recursion in programming."
        }
    ],
)

print(completion.choices[0].message.content)`;
};

/**
 * Generate code example based on language.
 *
 * @param projectId - The BILLING project: the project the user works in. The
 *   samples put it in `X-Project-Id` (see `BILLING_PROJECT_HEADER`). Do not
 *   pass `model.project_id` — that is the project which owns the model.
 */
export const generateCodeExample = (
  language: string,
  apiUrl: string,
  modelName: string,
  authToken: string,
  projectId: string | undefined,
): string => {
  switch (language) {
    case CODE_EXAMPLE_TYPES.CURL:
      return generateCurlExample(apiUrl, modelName, authToken, projectId);
    case CODE_EXAMPLE_TYPES.NODEJS:
      return generateNodejsExample(apiUrl, modelName, authToken, projectId);
    case CODE_EXAMPLE_TYPES.PYTHON:
      return generatePythonExample(apiUrl, modelName, authToken, projectId);
    default:
      return `# No example available for language: ${language}`;
  }
};

export const generateCanvasTitle = (integrationName: string | undefined, modelName: string | undefined): string => {
  if (!integrationName || !modelName) {
    return 'Code Examples';
  }
  return `${integrationName} • ${modelName}`;
};
