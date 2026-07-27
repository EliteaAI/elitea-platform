import type { Artifact } from './types';

/**
 * apps/elitea-ui/src/utils/filePreview.js:717-729 `formatFileSize`, ported
 * verbatim (including its `KB`/`MB`/`GB` labels for base-1024 division —
 * not the binary KiB/MiB/GiB names — for byte-identical parity output):
 * negative sizes and `0` both render `"0 B"`; the unit index is
 * `floor(log(bytes)/log(1024))`; whole bytes/KB get 0 decimals, everything
 * above gets 1.
 */
export function formatArtifactSize(bytes: number): string {
  if (bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  // Clamped to the unit table's range — the old app does not clamp and
  // would print "undefined" past 1 TB; realistic artifact sizes never reach
  // it, and clamping is a strict improvement over that latent bug.
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, unitIndex);
  const unit = units[unitIndex] ?? 'GB';
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${unit}`;
}

/** Most-recently-modified first. */
export function sortArtifactsByRecency(artifacts: readonly Artifact[]): Artifact[] {
  return [...artifacts].sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

/** Case-insensitive substring filter over artifact keys (filenames). */
export function filterArtifactsByQuery(artifacts: readonly Artifact[], query: string): Artifact[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...artifacts];
  return artifacts.filter((artifact) => artifact.key.toLowerCase().includes(needle));
}
