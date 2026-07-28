import { describe, expect, it } from 'vitest';

import { AI_ASSISTANT_LANGUAGE_OPTIONS, detectContentType } from './aiAssistantLanguage';

describe('AI_ASSISTANT_LANGUAGE_OPTIONS', () => {
  it('includes json, python, text and jinja among the options', () => {
    const values = AI_ASSISTANT_LANGUAGE_OPTIONS.map((option) => option.value);
    expect(values).toEqual(expect.arrayContaining(['json', 'python', 'text', 'jinja']));
  });

  it('has no duplicate values', () => {
    const values = AI_ASSISTANT_LANGUAGE_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('has 43 entries, matching the ported baseline list', () => {
    expect(AI_ASSISTANT_LANGUAGE_OPTIONS).toHaveLength(43);
  });
});

describe('detectContentType', () => {
  it('returns text for empty/null/undefined content', () => {
    expect(detectContentType('')).toBe('text');
    expect(detectContentType('   ')).toBe('text');
    expect(detectContentType(null)).toBe('text');
    expect(detectContentType(undefined)).toBe('text');
  });

  it('detects valid JSON', () => {
    expect(detectContentType('{"a": 1, "b": [1,2,3]}')).toBe('json');
    expect(detectContentType('[1, 2, 3]')).toBe('json');
  });

  it('does not detect malformed JSON as json', () => {
    expect(detectContentType('{a: 1,')).not.toBe('json');
  });

  it('detects jinja2 templates', () => {
    expect(detectContentType('Hello {{ name }}, {% if x %}yes{% endif %}')).toBe('jinja');
    expect(detectContentType('{# a comment #}')).toBe('jinja');
  });

  it('detects python via shebang', () => {
    expect(detectContentType('#!/usr/bin/env python\nprint("hi")')).toBe('python');
  });

  it('detects python via import/def/class patterns', () => {
    expect(detectContentType('import os\n\ndef main():\n    print("hi")')).toBe('python');
    expect(detectContentType('class Foo:\n    def bar(self):\n        self.x = 1')).toBe('python');
  });

  it('detects yaml key: value documents', () => {
    const yaml = 'name: test\nversion: 1\nkind: pipeline\ndescription: something\n';
    expect(detectContentType(yaml)).toBe('yaml');
  });

  it('detects yaml via a document separator', () => {
    expect(detectContentType('---\nname: test\n')).toBe('yaml');
  });

  it('detects markdown headers', () => {
    expect(detectContentType('# Heading\n\nSome text with a [link](http://x.com)')).toBe('markdown');
  });

  it('detects markdown code fences', () => {
    expect(detectContentType('Some text\n```\ncode block\n```')).toBe('markdown');
  });

  it('falls back to plain text for unrecognized content', () => {
    expect(detectContentType('just some plain words with no markers')).toBe('text');
  });

  it('falls back to plain text for content types this detector does not attempt (e.g. HTML)', () => {
    expect(detectContentType('<!DOCTYPE html><html><body>hi</body></html>')).toBe('text');
  });
});
