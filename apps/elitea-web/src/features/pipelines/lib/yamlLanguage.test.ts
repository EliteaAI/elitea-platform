import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { createYamlLanguage } from './yamlLanguage';

interface Token {
  name: string;
  text: string;
}

/** Every leaf (non-empty, childless) syntax-tree node for `doc`, in document order — the real, parsed token stream `createYamlLanguage` produces. */
function tokensFor(doc: string): Token[] {
  const state = EditorState.create({ doc, extensions: [createYamlLanguage()] });
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) throw new Error('YAML syntax tree did not become available synchronously');
  const tokens: Token[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.node.firstChild) return; // only leaves carry a token's own tag
      if (node.from === node.to) return; // zero-width (e.g. the tree's own Document wrapper)
      tokens.push({ name: node.name, text: doc.slice(node.from, node.to) });
    },
  });
  return tokens;
}

describe('createYamlLanguage', () => {
  it('tags a mapping key as propertyName and its colon as punctuation, but leaves the unquoted scalar value untagged', () => {
    const tokens = tokensFor('name: hello');
    expect(tokens).toEqual([
      { name: 'propertyName', text: 'name' },
      { name: 'punctuation', text: ':' },
    ]);
  });

  it('tags a `#` comment as a single comment token spanning the rest of the line', () => {
    const tokens = tokensFor('# a full-line comment\nkey: value # trailing');
    expect(tokens).toContainEqual({ name: 'comment', text: '# a full-line comment' });
    expect(tokens).toContainEqual({ name: 'comment', text: '# trailing' });
  });

  it('does not mistake a colon inside a plain scalar value (e.g. a URL) for a second key', () => {
    const tokens = tokensFor('url: http://example.com');
    expect(tokens).toEqual([
      { name: 'propertyName', text: 'url' },
      { name: 'punctuation', text: ':' },
    ]);
  });

  it('tags a double-quoted string (with backslash escapes) as one string token', () => {
    const tokens = tokensFor('greeting: "hello \\"world\\""');
    expect(tokens).toContainEqual({ name: 'string', text: '"hello \\"world\\""' });
  });

  it('tags a single-quoted string, honouring the doubled-`\'` escape, as one string token', () => {
    const tokens = tokensFor("note: 'it''s fine'");
    expect(tokens).toContainEqual({ name: 'string', text: "'it''s fine'" });
  });

  it('tags booleans/null keywords as atom and numbers as number', () => {
    const tokens = tokensFor('flag: true\nnil: null\ncount: 42\nratio: -3.5');
    expect(tokens).toContainEqual({ name: 'atom', text: 'true' });
    expect(tokens).toContainEqual({ name: 'atom', text: 'null' });
    expect(tokens).toContainEqual({ name: 'number', text: '42' });
    expect(tokens).toContainEqual({ name: 'number', text: '-3.5' });
  });

  it('tags a list item dash as punctuation and still recognises a mapping key after it', () => {
    const tokens = tokensFor('steps:\n  - name: build\n    id: 1');
    expect(tokens).toContainEqual({ name: 'punctuation', text: '-' });
    expect(tokens).toContainEqual({ name: 'propertyName', text: 'name' });
    expect(tokens).toContainEqual({ name: 'propertyName', text: 'id' });
  });

  it('tags anchors, aliases, and tags distinctly from plain scalars', () => {
    const tokens = tokensFor('base: &anchor value\nref: *anchor\ntyped: !!str text');
    expect(tokens).toContainEqual({ name: 'labelName', text: '&anchor' });
    expect(tokens).toContainEqual({ name: 'labelName', text: '*anchor' });
    expect(tokens).toContainEqual({ name: 'typeName', text: '!!str' });
  });

  it('tags `---`/`...` document markers as meta', () => {
    const tokens = tokensFor('---\nkey: value\n...');
    expect(tokens).toContainEqual({ name: 'meta', text: '---' });
    expect(tokens).toContainEqual({ name: 'meta', text: '...' });
  });

  it('does not throw on blank lines, whitespace-only lines, an unterminated quote, or an empty document', () => {
    expect(() => tokensFor('\n\n  \nfoo: bar\n\n')).not.toThrow();
    expect(() => tokensFor('a: "unterminated')).not.toThrow();
    expect(() => tokensFor("a: 'unterminated")).not.toThrow();
    expect(() => tokensFor('')).not.toThrow();
  });
});
