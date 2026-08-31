import { describe, expect, it } from 'vitest';

import { toDiagramError } from './mermaidError';

describe('toDiagramError', () => {
  it('recognises a link-syntax failure and reports the line number', () => {
    const error = toDiagramError(
      new Error("Parse error on line 2:\n...A -> B\n------^\nExpecting 'start_link', got 'ALPHA'"),
    );
    expect(error.summary).toContain('Link syntax error');
    expect(error.summary).toContain('2');
    expect(error.hint).not.toBe('');
  });

  it('extracts the offending source line as a separate field, not as markup', () => {
    const error = toDiagramError(new Error("Parse error on line 3:\nA --> ---------> Expecting 'SEMI'"));
    expect(error.snippet).toBe('A -->');
    // The baseline embedded `**bold**` markers in one string and re-parsed
    // them in JSX; the snippet stays plain data here so nothing re-parses it.
    expect(error.summary).not.toContain('**');
  });

  it('still produces a usable message for an unrecognised failure', () => {
    const error = toDiagramError(new Error('something went sideways in the layout engine'));
    expect(error.summary).not.toBe('');
    expect(error.hint).not.toBe('');
    expect(error.snippet).toBeUndefined();
  });

  it('does not throw on a non-Error value', () => {
    expect(() => toDiagramError('lexical error near "@"')).not.toThrow();
    expect(toDiagramError(undefined).summary).not.toBe('');
    expect(toDiagramError(null).summary).not.toBe('');
  });
});
