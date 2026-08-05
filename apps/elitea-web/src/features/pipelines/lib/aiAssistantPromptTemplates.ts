/**
 * AI Assistant prompt templates for different field types in pipeline nodes.
 * Ported verbatim (pure, dependency-free) from `apps/elitea-ui/src/[fsd]/
 * features/pipelines/ai-assistant/lib/constants/promptTemplates.js`
 * (baseline, 141 lines) — unit A2a.
 */

/** One field-type's Service Prompt binding + whether it needs pipeline-state context injected into the built prompt. */
export interface AiPromptTemplate {
  readonly servicePromptKey: string;
  readonly description: string;
  readonly requiresStateVariables?: boolean;
  readonly requiresAvailableNodes?: boolean;
}

export const AI_PROMPT_TEMPLATES: Readonly<Record<string, AiPromptTemplate>> = {
  system: {
    servicePromptKey: 'llm_system_assistant',
    description: 'System message generation for LLM node',
  },
  task: {
    servicePromptKey: 'llm_task_assistant',
    description: 'Human/task message generation for LLM node',
  },
  code: {
    servicePromptKey: 'code_assistant',
    description: 'Code generation or improvement for Code node',
    requiresStateVariables: true,
  },
  router: {
    servicePromptKey: 'router_assistant',
    description: 'Routing condition generation for Router node',
    requiresStateVariables: true,
    requiresAvailableNodes: true,
  },
  template: {
    servicePromptKey: 'state_modifier_assistant',
    description: 'Jinja2 template generation for State Modifier node',
    requiresStateVariables: true,
  },
  decision: {
    servicePromptKey: 'decision_assistant',
    description: 'Description generation for Decision node',
    requiresStateVariables: true,
    requiresAvailableNodes: true,
  },
  final_message: {
    servicePromptKey: 'printer_assistant',
    description: 'Final message generation for Printer node',
    requiresStateVariables: false,
  },
};

/**
 * Field name aliases — maps alternative field names to their corresponding
 * template keys, so multiple field names can point at the same template.
 */
const TEMPLATE_ALIASES: Readonly<Record<string, string>> = {
  condition: 'router', // Maps 'Condition' field (case-insensitive) to router template
  'final message': 'final_message',
  final_message: 'final_message',
  printer: 'final_message',
  description: 'decision',
};

/**
 * Get the template configuration for a specific field.
 * Returns `null` for fields that do not have a dedicated AI prompt template.
 */
export function getPromptTemplate(fieldName: string | undefined): AiPromptTemplate | null {
  const normalizedFieldName = fieldName?.toLowerCase();
  if (normalizedFieldName === undefined) return null;
  const templateKey = TEMPLATE_ALIASES[normalizedFieldName] ?? normalizedFieldName;
  return AI_PROMPT_TEMPLATES[templateKey] ?? null;
}

/**
 * Resolve a Service Prompt key for a given fieldName.
 * Returns `null` for fields that do not have a dedicated AI prompt template.
 */
export function getServicePromptKeyForFieldName(fieldName: string | undefined): string | null {
  const template = getPromptTemplate(fieldName);
  return template?.servicePromptKey ?? null;
}

/** Extra, field-independent knobs `buildFieldContextPrompt` accepts. */
export interface BuildFieldContextPromptOptions {
  readonly basePromptOverride?: string;
}

const NO_TEMPLATE_PROMPT = (userQuery: string, currentContent: string): string =>
  `Current content:\n\n\n\`\`\`\n${currentContent}\n\`\`\`\n\nInstruction: ${userQuery}\n\nIMPORTANT: Return ONLY the final improved version. Do NOT include:\n- The original content again\n- Explanations or comments\n- Markdown code blocks around the result\n- "Here's the improved version" or similar phrases\n\nStart with the first character of the improved content:`;

const CURRENT_CONTENT_INSTRUCTIONS =
  '\n\nIMPORTANT: Return ONLY the final improved version. Do NOT include:\n- The original content again\n- Explanations or comments\n- Markdown code blocks around the result\n- "Here\'s the improved version" or similar phrases\n\nStart with the first character of the improved content:';

/** Appends the state-variables/available-nodes context sections a template requires, when the corresponding info string is non-empty. Split out of `buildFieldContextPrompt` to keep that function's cyclomatic complexity under the §3.5 budget (12). */
function appendTemplateContext(
  sections: string[],
  template: AiPromptTemplate,
  stateVariablesInfo: string,
  availableNodesInfo: string,
): void {
  if (template.requiresStateVariables && stateVariablesInfo) {
    sections.push('\n-----\n', stateVariablesInfo);
  }
  if (template.requiresAvailableNodes && availableNodesInfo) {
    sections.push('\n-----\n', availableNodesInfo);
  }
}

/**
 * Build the AI prompt with field-specific context. Standardized approach:
 * base prompt + state variables + available nodes + user query + current
 * content.
 */
export function buildFieldContextPrompt(
  userQuery: string,
  fieldName: string | undefined,
  currentContent = '',
  stateVariablesInfo = '',
  availableNodesInfo = '',
  options: BuildFieldContextPromptOptions = {},
): string {
  const template = getPromptTemplate(fieldName);
  const basePrompt = template ? String(options.basePromptOverride ?? '').trim() : '';

  if (!template || !basePrompt) {
    return NO_TEMPLATE_PROMPT(userQuery, currentContent);
  }

  const sections = [basePrompt];
  appendTemplateContext(sections, template, stateVariablesInfo, availableNodesInfo);
  sections.push('\n-----\n', 'User request and instructions: ```', userQuery, '```');

  if (currentContent.trim()) {
    sections.push('\n\nCurrent content:\n\n```\n', currentContent, '\n```', CURRENT_CONTENT_INSTRUCTIONS);
  }
  return sections.join('');
}
