/**
 * File-name helper ported from apps/elitea-ui/src/common/utils.jsx
 * (unit S3, spec §9.3).
 */

/**
 * Lower-cased file extension of `fileName`, with `yml` normalised to
 * `yaml`. Parity (old-app `utils.jsx:58-65`): no guard against a filename
 * with no `.` — `'noext'.split('.').pop()` is `'noext'` itself, so the
 * "extension" of an extension-less name is the whole filename, lower-cased.
 */
export function getFileFormat(fileName: string): string {
  const parts = fileName.split('.');
  const extension = (parts[parts.length - 1] ?? '').toLowerCase();
  if (extension === 'yaml' || extension === 'yml') {
    return 'yaml';
  }
  return extension;
}
