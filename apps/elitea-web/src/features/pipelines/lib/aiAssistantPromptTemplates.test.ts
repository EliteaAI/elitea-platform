import { describe, expect, it } from 'vitest';

import {
  AI_PROMPT_TEMPLATES,
  buildFieldContextPrompt,
  getPromptTemplate,
  getServicePromptKeyForFieldName,
} from './aiAssistantPromptTemplates';

describe('getPromptTemplate', () => {
  it('resolves a direct field name case-insensitively', () => {
    expect(getPromptTemplate('System')).toEqual(AI_PROMPT_TEMPLATES.system);
    expect(getPromptTemplate('code')).toEqual(AI_PROMPT_TEMPLATES.code);
  });

  it('resolves aliases to their target template', () => {
    expect(getPromptTemplate('Condition')).toEqual(AI_PROMPT_TEMPLATES.router);
    expect(getPromptTemplate('final message')).toEqual(AI_PROMPT_TEMPLATES.final_message);
    expect(getPromptTemplate('printer')).toEqual(AI_PROMPT_TEMPLATES.final_message);
    expect(getPromptTemplate('description')).toEqual(AI_PROMPT_TEMPLATES.decision);
  });

  it('returns null for an unknown field name', () => {
    expect(getPromptTemplate('unknown_field')).toBeNull();
  });

  it('returns null for undefined field name', () => {
    expect(getPromptTemplate(undefined)).toBeNull();
  });
});

describe('getServicePromptKeyForFieldName', () => {
  it('returns the servicePromptKey for a known field', () => {
    expect(getServicePromptKeyForFieldName('task')).toBe('llm_task_assistant');
  });

  it('returns null for an unknown field', () => {
    expect(getServicePromptKeyForFieldName('nope')).toBeNull();
  });
});

describe('buildFieldContextPrompt', () => {
  it('falls back to the basic prompt when the field has no template', () => {
    const result = buildFieldContextPrompt('make it better', 'unknown_field', 'old content');
    expect(result).toContain('Current content:');
    expect(result).toContain('old content');
    expect(result).toContain('Instruction: make it better');
  });

  it('falls back to the basic prompt when a template exists but no basePromptOverride is supplied', () => {
    const result = buildFieldContextPrompt('rewrite this', 'system', 'hello');
    expect(result).toContain('Instruction: rewrite this');
    expect(result).not.toContain('User request and instructions');
  });

  it('builds the templated prompt with state variables when requiresStateVariables is set', () => {
    const result = buildFieldContextPrompt('generate code', 'code', '', 'state: {foo}', '', {
      basePromptOverride: 'Base code prompt',
    });
    expect(result.startsWith('Base code prompt')).toBe(true);
    expect(result).toContain('state: {foo}');
    expect(result).toContain('User request and instructions: ```generate code```');
  });

  it('omits state variables info when the template does not require it', () => {
    const result = buildFieldContextPrompt('write system prompt', 'system', '', 'state: {foo}', '', {
      basePromptOverride: 'Base system prompt',
    });
    expect(result).not.toContain('state: {foo}');
  });

  it('includes available nodes info only when requiresAvailableNodes is set', () => {
    const result = buildFieldContextPrompt('route it', 'router', '', '', 'nodes: [a, b]', {
      basePromptOverride: 'Base router prompt',
    });
    expect(result).toContain('nodes: [a, b]');
  });

  it('appends current content with the improved-version instructions when currentContent is non-empty', () => {
    const result = buildFieldContextPrompt('improve', 'task', 'existing text', '', '', {
      basePromptOverride: 'Base task prompt',
    });
    expect(result).toContain('Current content:');
    expect(result).toContain('existing text');
    expect(result).toContain('Return ONLY the final improved version');
  });

  it('does not append the current-content section when currentContent is blank', () => {
    const result = buildFieldContextPrompt('improve', 'task', '   ', '', '', {
      basePromptOverride: 'Base task prompt',
    });
    expect(result).not.toContain('Return ONLY the final improved version');
  });
});
