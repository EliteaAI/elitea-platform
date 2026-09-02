/**
 * Finding and replacing mermaid blocks inside a wiki page's markdown.
 *
 * PORTED FROM apps/deepwiki-ui/src/DeepWikiApp.jsx:2695-2747. It is the
 * load-bearing half of the quick fix: `replaceMermaidBlock` writes back into a
 * page the user is reading, so a bug here does not corrupt a diagram — it
 * corrupts the document around it.
 *
 * BLOCKS ARE FOUND BY LINE SCAN, not by regular expression, and that is the
 * legacy choice preserved. A `/```mermaid([\s\S]*?)```/g` would be shorter and
 * would match a fence inside an indented code block that is showing mermaid
 * source as an example — replacing there rewrites documentation about mermaid
 * rather than a diagram.
 */

/** One mermaid block, located in the document. */
export interface MermaidBlock {
  /** The block's source, without the fences. */
  readonly code: string;
  /** 1-indexed line of the block's FIRST content line (after the opening fence). */
  readonly startLine: number;
  /** 1-indexed line of the CLOSING fence. */
  readonly endLine: number;
  /** Position among the mermaid blocks in this document, from 0. */
  readonly index: number;
}

/**
 * Every mermaid block in the document, in order.
 *
 * An UNCLOSED block yields nothing. The legacy scanner only pushes on the
 * closing fence, and that is preserved: a half-written fence at the end of a
 * page is not a block to be rewritten, and treating it as one would let a fix
 * append its replacement past the end of the document.
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const lines = markdown.split('\n');
  let inBlock = false;
  let blockStartLine = 0;
  let blockContent: string[] = [];

  lines.forEach((line, lineIndex) => {
    if (line.trim().startsWith('```mermaid')) {
      inBlock = true;
      blockStartLine = lineIndex + 1;
      blockContent = [];
      return;
    }
    if (inBlock && line.trim() === '```') {
      blocks.push({
        code: blockContent.join('\n'),
        startLine: blockStartLine,
        endLine: lineIndex + 1,
        index: blocks.length,
      });
      inBlock = false;
      return;
    }
    if (inBlock) blockContent.push(line);
  });

  return blocks;
}

/**
 * Replace one block's source, leaving the rest of the document byte-identical.
 *
 * An UNKNOWN INDEX returns the document unchanged. The legacy version logged to
 * the console and did the same; the return value is what matters, because the
 * caller saves whatever comes back — returning a truncated document on a
 * missing block would destroy the page.
 */
export function replaceMermaidBlock(
  markdown: string,
  blockIndex: number,
  newCode: string,
): string {
  const block = extractMermaidBlocks(markdown)[blockIndex];
  if (!block) return markdown;

  const lines = markdown.split('\n');
  // startLine is 1-indexed at the first CONTENT line, so slicing to it keeps
  // the opening fence. endLine is the closing fence, so slicing from
  // endLine - 1 keeps it and everything after.
  const before = lines.slice(0, block.startLine);
  const after = lines.slice(block.endLine - 1);
  return [...before, newCode, ...after].join('\n');
}

/**
 * The mermaid source inside a model's reply.
 *
 * A model asked to fix a diagram answers with prose around a fenced block as
 * often as with bare source. Taking the whole reply would put "Here is the
 * corrected diagram:" inside the diagram.
 */
export function extractMermaidFromResponse(response: string): string | null {
  const fenced = /```mermaid\n([\s\S]*?)```/.exec(response);
  if (fenced?.[1] !== undefined) return fenced[1].trimEnd();

  // A bare fence, which some models use when told the content is mermaid.
  const bare = /```\n([\s\S]*?)```/.exec(response);
  if (bare?.[1] !== undefined) return bare[1].trimEnd();

  // No fence at all: the whole reply, if it looks like a diagram. The check is
  // deliberately weak — mermaid has many diagram types — but it is not absent,
  // because saving an apology as a diagram is worse than declining the fix.
  const trimmed = response.trim();
  return trimmed === '' ? null : trimmed;
}
