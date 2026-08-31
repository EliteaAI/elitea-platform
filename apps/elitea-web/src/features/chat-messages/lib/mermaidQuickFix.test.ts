/**
 * The pure half of the mermaid quick-fix. `getMermaidQuickFixModelInfo`
 * returning `null` is what makes the button disappear rather than toast, so
 * every "no usable model" shape is pinned here.
 */
import { describe, expect, it } from 'vitest';

import {
  buildMermaidQuickFixPrompt,
  extractMermaidCode,
  extractPredictText,
  getMermaidQuickFixModelInfo,
} from './mermaidQuickFix';

describe('getMermaidQuickFixModelInfo', () => {
  it('prefers the low-tier default', () => {
    expect(
      getMermaidQuickFixModelInfo({
        low_tier_default_model_name: 'small',
        low_tier_default_model_project_id: '7',
        default_model_name: 'big',
        default_model_project_id: '9',
      }),
    ).toEqual({ modelName: 'small', modelProjectId: 7, tooltip: 'Quick Fix: small (low-tier)', isFallback: false });
  });

  it('falls back to the plain default, then to the first listed model', () => {
    expect(getMermaidQuickFixModelInfo({ default_model_name: 'big', default_model_project_id: 9 })?.modelName).toBe(
      'big',
    );
    expect(getMermaidQuickFixModelInfo({ items: [{ name: 'only', project_id: 3 }] })?.modelName).toBe('only');
  });

  it('returns null when nothing usable is present — this is what hides the button', () => {
    expect(getMermaidQuickFixModelInfo(undefined)).toBeNull();
    expect(getMermaidQuickFixModelInfo(null)).toBeNull();
    expect(getMermaidQuickFixModelInfo({})).toBeNull();
    expect(getMermaidQuickFixModelInfo({ items: [] })).toBeNull();
    // A name with no project id is NOT usable — the predict call needs both.
    expect(getMermaidQuickFixModelInfo({ low_tier_default_model_name: 'small' })).toBeNull();
    expect(getMermaidQuickFixModelInfo({ low_tier_default_model_name: '', low_tier_default_model_project_id: 7 })).toBeNull();
    expect(
      getMermaidQuickFixModelInfo({ low_tier_default_model_name: 'small', low_tier_default_model_project_id: 'abc' }),
    ).toBeNull();
  });
});

describe('buildMermaidQuickFixPrompt', () => {
  it('appends the error and the diagram under the authored prompt', () => {
    const prompt = buildMermaidQuickFixPrompt({ basePrompt: '  Fix it.  ', error: 'boom', code: 'graph TD' });
    expect(prompt.startsWith('Fix it.')).toBe(true);
    expect(prompt).toContain('Mermaid error:\nboom');
    expect(prompt).toContain('Mermaid code:\ngraph TD');
  });
});

describe('extractMermaidCode', () => {
  it('unwraps a ```mermaid fence, then any fence, then falls through to raw text', () => {
    expect(extractMermaidCode('here:\n```mermaid\ngraph TD\n```\n')).toBe('graph TD');
    expect(extractMermaidCode('```\ngraph LR\n```')).toBe('graph LR');
    expect(extractMermaidCode('graph BT')).toBe('graph BT');
    expect(extractMermaidCode(undefined)).toBe('');
    expect(extractMermaidCode(null)).toBe('');
  });
});

describe('extractPredictText', () => {
  it('reads each of predict_llm\'s answer shapes', () => {
    expect(extractPredictText('plain')).toBe('plain');
    expect(extractPredictText({ result: 'nested' })).toBe('nested');
    expect(extractPredictText({ result: { elitea_response: 'a' } })).toBe('a');
    expect(extractPredictText({ result: { output: 'b' } })).toBe('b');
    expect(
      extractPredictText({ result: { chat_history: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'c' }] } }),
    ).toBe('c');
    expect(extractPredictText({ result: { messages: [{ content: [{ text: 'd' }] }] } })).toBe('d');
    expect(extractPredictText(null)).toBe('');
  });

  it('returns empty text for a structure it cannot serialise, so the caller refuses it', () => {
    const cyclic: Record<string, unknown> = { messages: [] };
    cyclic.self = cyclic;
    expect(extractPredictText({ result: cyclic })).toBe('');
  });
});
