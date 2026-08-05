/**
 * Code-example helpers for the AI Configuration feature.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/helpers/codeExamples.helpers.js`.
 */

import { CODE_EXAMPLE_TYPES } from './codeExamples';

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
  const projectHeader = projectId ? `  -H "OpenAI-Project: ${projectId}" \\` : '';
  const projectHeaderBlock = projectId ? `\n${projectHeader}` : '';

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
  const projectParam = projectId ? `\n  project: '${projectId}'` : '';

  return `import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '${authToken}',
  baseURL: '${apiUrl}'${projectParam}
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
  const projectParam = projectId ? `\n    project="${projectId}"` : '';

  return `from openai import OpenAI

client = OpenAI(
    api_key="${authToken}",
    base_url="${apiUrl}"${projectParam}
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
