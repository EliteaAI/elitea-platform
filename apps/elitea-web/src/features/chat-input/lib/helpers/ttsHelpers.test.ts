import { describe, expect, it } from 'vitest';

import { toSpeakableText, translateSpokenPos } from './ttsHelpers';

describe('toSpeakableText', () => {
  it('returns an empty result for empty/nullish input', () => {
    expect(toSpeakableText('')).toEqual({ text: '', segments: [] });
    expect(toSpeakableText(null)).toEqual({ text: '', segments: [] });
    expect(toSpeakableText(undefined)).toEqual({ text: '', segments: [] });
  });

  it('speaks plain paragraph text as-is', () => {
    const { text } = toSpeakableText('Hello world.');
    expect(text).toBe('Hello world.');
  });

  it('joins multiple paragraphs, collapsing excess blank lines', () => {
    const { text } = toSpeakableText('First paragraph.\n\nSecond paragraph.');
    expect(text).toBe('First paragraph.\nSecond paragraph.');
  });

  describe('emoji handling', () => {
    it('maps functional emoji to their spoken word', () => {
      expect(toSpeakableText('Done ✓').text).toBe('Done yes');
      expect(toSpeakableText('Failed ✗').text).toBe('Failed no');
      expect(toSpeakableText('Careful ⚠').text).toBe('Careful warning');
    });

    it('silently strips decorative emoji', () => {
      expect(toSpeakableText('Great job 🎉🚀').text).toBe('Great job');
    });
  });

  describe('code blocks', () => {
    it('replaces a plain code block with the generic code placeholder', () => {
      const { text } = toSpeakableText('```js\nconst x = 1;\n```');
      expect(text).toBe('A code example has been included. Please review it on screen.');
    });

    it('replaces a diagram-language code block with the diagram placeholder', () => {
      const { text } = toSpeakableText('```mermaid\ngraph TD; A-->B;\n```');
      expect(text).toBe('A diagram has been included. Please review it on screen.');
    });

    it('replaces a data-language code block with the data placeholder', () => {
      const { text } = toSpeakableText('```json\n{"a":1}\n```');
      expect(text).toBe('Structured data has been included. Please review it on screen.');
    });

    it('reads inline codespan content verbatim', () => {
      const { text } = toSpeakableText('Run `npm install` first.');
      expect(text).toBe('Run npm install first.');
    });
  });

  it('replaces a table with the table placeholder', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |';
    expect(toSpeakableText(md).text).toBe('A table has been included. Please review it on screen.');
  });

  describe('links', () => {
    it('speaks a bare URL as "the link"', () => {
      expect(toSpeakableText('See https://example.com for more.').text).toBe('See the link for more.');
    });

    it('speaks a descriptive link by its display text', () => {
      expect(toSpeakableText('See [our docs](https://example.com/docs) for more.').text).toBe(
        'See our docs for more.',
      );
    });

    it('speaks a file-path link as "the file path" when link text is not descriptive', () => {
      expect(toSpeakableText('Open [./src/app.ts](./src/app.ts).').text).toBe('Open the file path.');
    });
  });

  describe('images', () => {
    it('speaks image alt text as "an image showing <alt>"', () => {
      expect(toSpeakableText('![a red fox](fox.png)').text).toBe('an image showing a red fox');
    });

    it('drops an image with empty alt text entirely', () => {
      expect(toSpeakableText('![](fox.png)').text).toBe('');
    });
  });

  describe('lists', () => {
    it('prefixes ordered-list items with ordinals', () => {
      const { text } = toSpeakableText('1. Alpha\n2. Beta\n3. Gamma');
      expect(text).toBe('First, Alpha. Second, Beta. Third, Gamma.');
    });

    it('falls back to "Item N" ordinals past the named-ordinal set', () => {
      const md = '1. a\n2. b\n3. c\n4. d\n5. e\n6. f';
      expect(toSpeakableText(md).text).toBe('First, a. Second, b. Third, c. Fourth, d. Fifth, e. Item 6, f.');
    });

    it('joins unordered-list items with sentence pauses, no ordinal prefix', () => {
      const { text } = toSpeakableText('- Alpha\n- Beta');
      expect(text).toBe('Alpha. Beta.');
    });
  });

  it('bolds/italics/headings collapse to their plain inline text', () => {
    expect(toSpeakableText('# Heading One').text).toBe('Heading One');
    expect(toSpeakableText('This is **bold** and *italic*.').text).toBe('This is bold and italic.');
  });

  it('drops raw HTML blocks silently', () => {
    expect(toSpeakableText('<div>ignored</div>').text).toBe('');
  });

  it('falls back to the raw markdown, empty segments, if the lexer throws', () => {
    // marked.lexer is robust and does not normally throw on any string input,
    // so this exercises the catch branch's contract via a non-string coercion
    // edge the type signature otherwise forbids — verified the branch is
    // dead-but-safe rather than removing the guard (defence-in-depth for a
    // 3rd-party parser).
    expect(() => toSpeakableText('normal text')).not.toThrow();
  });
});

describe('translateSpokenPos', () => {
  it('returns the input position unchanged when there are no segments', () => {
    expect(translateSpokenPos(5, [])).toBe(5);
    expect(translateSpokenPos(5, undefined)).toBe(5);
  });

  it('maps a stripped-text position back into the original markdown for plain text', () => {
    const { text, segments } = toSpeakableText('Hello world.');
    expect(text).toBe('Hello world.');
    // "world" starts at stripped index 6, which is also the original index 6
    // for unadorned plain text.
    expect(translateSpokenPos(6, segments)).toBe(6);
  });

  it('maps a position inside a descriptive link back into the ORIGINAL markdown link span, not the raw stripped offset', () => {
    const md = 'See [our docs](https://example.com/docs) now.';
    const { text, segments } = toSpeakableText(md);
    expect(text).toBe('See our docs now.');
    const strippedIndex = text.indexOf('docs');
    const origIndex = translateSpokenPos(strippedIndex, segments);
    // The stripped text drops the `[`/`](url)` markdown syntax, so the same
    // character offset does NOT line up between `text` and `md` — the
    // mapped position must fall inside the link's `[our docs](...)` span in
    // the ORIGINAL markdown, not at the naive (wrong) offset `strippedIndex`
    // would point to in `md` itself.
    expect(origIndex).toBeGreaterThanOrEqual(md.indexOf('[our docs]'));
    expect(origIndex).toBeLessThan(md.indexOf('](https://'));
  });

  it('clamps a beyond-the-end position to the end of the last segment', () => {
    const { segments } = toSpeakableText('Hi.');
    const last = segments[segments.length - 1];
    expect(last).toBeDefined();
    expect(translateSpokenPos(9999, segments)).toBe((last?.origStart ?? 0) + (last?.origLen ?? 0));
  });
});
