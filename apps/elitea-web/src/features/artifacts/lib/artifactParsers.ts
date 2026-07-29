import type { ArtifactDataFile } from '../model/types';

function parseDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  if (delimiter === '\t') return line.split('\t');
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];
    if (character === '"' && quoted && nextCharacter === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      cells.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

export function parseDataFile(content: string, type: 'csv' | 'tsv'): ArtifactDataFile {
  const normalized = content.trim();
  if (normalized === '') return { headers: [], rows: [] };
  const delimiter = type === 'csv' ? ',' : '\t';
  const [header = '', ...lines] = normalized.split(/\r?\n/);
  return {
    headers: parseDelimitedLine(header, delimiter),
    rows: lines.map((line) => parseDelimitedLine(line, delimiter)),
  };
}

export type ArtifactPreviewKind = 'markdown' | 'csv' | 'tsv' | 'mermaid' | 'image' | 'text' | 'docx' | 'unsupported';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const TEXT_EXTENSIONS = new Set([
  'txt',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'go',
  'java',
  'sql',
  'sh',
]);

export function artifactPreviewKind(filename: string): ArtifactPreviewKind {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'csv') return 'csv';
  if (extension === 'tsv') return 'tsv';
  if (extension === 'mermaid' || extension === 'mmd') return 'mermaid';
  if (extension === 'docx' || extension === 'doc') return 'docx';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  return 'unsupported';
}
