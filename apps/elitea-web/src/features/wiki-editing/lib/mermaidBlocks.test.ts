/**
 * Mermaid block location and replacement.
 *
 * replaceMermaidBlock writes back into a page the user is reading. A bug here
 * does not corrupt a diagram — it corrupts the document around it, and the
 * caller saves whatever comes back. Every test below therefore checks the
 * WHOLE document, not just the block.
 */
import { describe, expect, it } from 'vitest';

import {
  extractMermaidBlocks,
  extractMermaidFromResponse,
  replaceMermaidBlock,
} from './mermaidBlocks';

const PAGE = [
  '# Architecture',
  '',
  'Some prose.',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  'More prose.',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  A ->> B: hi',
  '```',
  '',
  'Closing prose.',
].join('\n');

describe('extractMermaidBlocks', () => {
  it('finds every block, in order, with its source', () => {
    const blocks = extractMermaidBlocks(PAGE);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.code).toBe('graph TD\n  A --> B');
    expect(blocks[1]?.code).toBe('sequenceDiagram\n  A ->> B: hi');
    expect(blocks.map((b) => b.index)).toEqual([0, 1]);
  });

  it('finds nothing in a page with no diagrams', () => {
    expect(extractMermaidBlocks('# Title\n\nJust prose.')).toEqual([]);
  });

  it('ignores an UNCLOSED block', () => {
    // Only the closing fence pushes a block. A half-written fence at the end
    // of a page is not something to rewrite, and treating it as one would let
    // a fix append past the end of the document.
    expect(extractMermaidBlocks('# T\n\n```mermaid\ngraph TD\n  A --> B')).toEqual([]);
  });

  it('does not treat a non-mermaid fence as a block', () => {
    const page = '```js\nconst a = 1;\n```\n\n```mermaid\ngraph TD\n```';
    const blocks = extractMermaidBlocks(page);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.code).toBe('graph TD');
  });
});

describe('replaceMermaidBlock', () => {
  it('replaces one block and leaves everything else byte-identical', () => {
    const result = replaceMermaidBlock(PAGE, 0, 'graph LR\n  X --> Y');
    expect(result).toContain('graph LR\n  X --> Y');
    // The prose, the heading and the OTHER diagram all survive untouched.
    expect(result).toContain('# Architecture');
    expect(result).toContain('Some prose.');
    expect(result).toContain('More prose.');
    expect(result).toContain('Closing prose.');
    expect(result).toContain('sequenceDiagram\n  A ->> B: hi');
    expect(result).not.toContain('  A --> B\n```');
  });

  it('replaces the SECOND block without touching the first', () => {
    const result = replaceMermaidBlock(PAGE, 1, 'flowchart LR\n  P --> Q');
    expect(result).toContain('graph TD\n  A --> B');
    expect(result).toContain('flowchart LR\n  P --> Q');
    expect(result).not.toContain('sequenceDiagram');
  });

  it('keeps the fences', () => {
    const result = replaceMermaidBlock(PAGE, 0, 'graph LR');
    expect(result.split('```mermaid')).toHaveLength(3);
    expect(extractMermaidBlocks(result)).toHaveLength(2);
  });

  it('an unknown index returns the document UNCHANGED', () => {
    // The caller saves whatever comes back. Returning a truncated document for
    // a missing block would destroy the page.
    expect(replaceMermaidBlock(PAGE, 7, 'graph LR')).toBe(PAGE);
    expect(replaceMermaidBlock(PAGE, -1, 'graph LR')).toBe(PAGE);
  });

  it('is idempotent when the replacement equals the original', () => {
    expect(replaceMermaidBlock(PAGE, 0, 'graph TD\n  A --> B')).toBe(PAGE);
  });
});

describe('extractMermaidFromResponse', () => {
  it('takes the fenced block out of a chatty reply', () => {
    const reply = 'Here is the corrected diagram:\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nHope that helps!';
    expect(extractMermaidFromResponse(reply)).toBe('graph TD\n  A --> B');
  });

  it('accepts a bare fence', () => {
    expect(extractMermaidFromResponse('```\ngraph TD\n```')).toBe('graph TD');
  });

  it('falls back to the whole reply when there is no fence', () => {
    expect(extractMermaidFromResponse('graph TD\n  A --> B')).toBe('graph TD\n  A --> B');
  });

  it('declines an empty reply rather than saving nothing as a diagram', () => {
    expect(extractMermaidFromResponse('   ')).toBeNull();
    expect(extractMermaidFromResponse('')).toBeNull();
  });
});
