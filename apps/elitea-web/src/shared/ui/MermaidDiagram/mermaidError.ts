import { t } from '@/shared/i18n';

/**
 * A parsed mermaid failure, ready to render.
 *
 * The baseline (`apps/elitea-ui/src/components/MermaidDiagramOutput/
 * DiagramOutput.jsx`, `createUserFriendlyErrorMessage`) built ONE string with
 * `**bold**` markers in it and re-parsed those markers back out in JSX. That
 * round trip is dropped: the three parts are kept apart as data, so the
 * component renders them without a second parser, and so the offending snippet
 * is rendered as TEXT rather than as anything a marker could turn into markup.
 */
export interface MermaidDiagramError {
  /** One-line summary, already localized. */
  readonly summary: string;
  /** The offending diagram line, verbatim, when mermaid reported one. */
  readonly snippet: string | undefined;
  /** What to try, already localized. */
  readonly hint: string;
}

/** Mermaid parser dialects, matched in order; the first hit wins. */
function matchPattern(text: string): { summary: string; hint: string } | undefined {
  if (/expecting 'semi'|expecting 'newline'|expecting 'eof'/i.test(text)) {
    return {
      summary: t('shared.mermaid.error.syntax', 'Syntax error: missing semicolon, new line, or unexpected characters'),
      hint: t('shared.mermaid.error.syntaxHint', 'Check for typos, missing punctuation, or extra characters at the end of lines.'),
    };
  }
  if (/expecting 'start_link'|expecting 'link'/i.test(text)) {
    return {
      summary: t('shared.mermaid.error.link', 'Link syntax error: invalid arrow or connection format'),
      hint: t('shared.mermaid.error.linkHint', 'Use a supported arrow such as "-->" between nodes.'),
    };
  }
  if (/expecting 'vertex'|expecting 'id'/i.test(text)) {
    return {
      summary: t('shared.mermaid.error.node', 'Node definition error: invalid node name or id'),
      hint: t('shared.mermaid.error.nodeHint', 'Node names should use letters, digits and underscores only.'),
    };
  }
  if (/lexical error/i.test(text)) {
    return {
      summary: t('shared.mermaid.error.lexical', 'Invalid character or symbol in the diagram'),
      hint: t('shared.mermaid.error.lexicalHint', 'Remove unsupported special characters.'),
    };
  }
  if (/parse error/i.test(text)) {
    return {
      summary: t('shared.mermaid.error.parse', 'Diagram structure error'),
      hint: t('shared.mermaid.error.parseHint', 'Check the diagram type declaration and the overall syntax.'),
    };
  }
  return undefined;
}

/** Pulls the offending source line out of mermaid's own error prose. */
function extractSnippet(text: string): string | undefined {
  const patterns = [/line \d+:\s*(.+?)\s*-{5,}>\s*Expecting/i, /line \d+:\s*(.+?)\s*Expecting/i, /line \d+:\s*(.+?)(?:\n|$)/i];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const captured = match?.[1]?.trim();
    if (captured !== undefined && captured !== '') {
      return captured
        .replace(/\s*-{5,}>\s*.*$/i, '')
        .replace(/\s*Expecting.*$/i, '')
        .replace(/\s*,?\s*got\s+['"][^'"]*['"].*$/i, '')
        .replace(/[,;]\s*$/, '')
        .trim();
    }
  }
  return undefined;
}

/**
 * Turns whatever mermaid threw into something a reader can act on.
 *
 * Ported from the baseline's `createUserFriendlyErrorMessage`, with the same
 * pattern table and the same snippet-extraction ladder. Never throws and never
 * returns an empty summary — this function IS the graceful-failure path, so a
 * shape it does not recognise still produces a usable message rather than
 * propagating.
 */
export function toDiagramError(error: unknown): MermaidDiagramError {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const lineNumber = /line (\d+)/i.exec(text)?.[1];
  const matched = matchPattern(text);

  const base =
    matched ??
    {
      summary: t('shared.mermaid.error.generic', 'Diagram syntax error detected'),
      hint: t(
        'shared.mermaid.error.genericHint',
        'Check the diagram against the Mermaid documentation — common causes are missing arrows, invalid node names, or a wrong diagram type declaration.',
      ),
    };

  const summary =
    lineNumber === undefined
      ? base.summary
      : t('shared.mermaid.error.withLine', '{{summary}} (line {{line}})', { summary: base.summary, line: lineNumber });

  return { summary, snippet: extractSnippet(text), hint: base.hint };
}
