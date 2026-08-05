import type { SkillDraft } from '../model/types';

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTags(value: string): readonly string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  return trimmed
    .slice(1, -1)
    .split(',')
    .map(unquote)
    .filter(Boolean);
}

export function parseSkillMarkdown(content: string): SkillDraft {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) throw new Error('The file must start with YAML frontmatter.');

  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  const name = unquote(fields.get('name') ?? '');
  const description = unquote(fields.get('description') ?? '');
  if (name === '' || description === '') {
    throw new Error('Frontmatter must contain name and description.');
  }

  return {
    name,
    description,
    instructions: (match[2] ?? '').trim(),
    tags: parseTags(fields.get('tags') ?? ''),
  };
}
