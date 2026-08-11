/**
 * Proof for scripts/lib/container-lookup.sh (#228).
 *
 * The load-bearing test is the RED/GREEN pair at the bottom. It runs the OLD
 * `grep -m1` idiom and the NEW helper through a real pipeline under
 * `set -euo pipefail` and asserts the old one fails the way #228 describes
 * while the new one does not.
 *
 * Without that pair this file would pass against the bug: every table-driven
 * case above operates on a string already in memory, so no pipe exists and
 * SIGPIPE cannot happen. A unit test of the selection logic alone cannot see
 * this defect — which is exactly why it survived.
 *
 * Two harness details that are easy to get wrong, and were:
 *
 *  - The listing is passed through the ENVIRONMENT, not interpolated into the
 *    script. `JSON.stringify` renders a newline as backslash-n, and bash does
 *    not expand that inside double quotes, so an interpolated multi-line
 *    listing silently arrives as one line containing literal `\n`.
 *  - The producer emits its MATCHES FIRST and the filler after. `grep -m1`
 *    only takes SIGPIPE if it exits while the producer is still writing; if
 *    the match is last, grep reads to EOF and the bug does not reproduce.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const LIB = join(dirname(fileURLToPath(import.meta.url)), 'container-lookup.sh');

/** Run resolve_container_name() in a real bash, under the caller's own flags. */
function resolve(project, service, names) {
  const script = `
    set -euo pipefail
    . "$LIB"
    resolve_container_name "$PROJECT" "$SERVICE" "$NAMES"
  `;
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, LIB, PROJECT: project, SERVICE: service, NAMES: names },
  });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
}

describe('resolve_container_name', () => {
  const listing = [
    'centry-postgres-1',
    'elitea-standalone-postgres-1',
    'nav225-postgres-1',
    'nav225-elitea-main-1',
  ].join('\n');

  it('prefers the project-scoped name over any other match', () => {
    const { status, out } = resolve('nav225', 'postgres', listing);
    expect(status).toBe(0);
    expect(out).toBe('nav225-postgres-1');
  });

  it('falls back to the service pattern when the project does not match', () => {
    const { status, out } = resolve('absent-project', 'postgres', listing);
    expect(status).toBe(0);
    expect(out).toBe('centry-postgres-1');
  });

  it('returns exactly one name — never two joined by a newline (#228)', () => {
    const { out } = resolve('nav225', 'postgres', listing);
    expect(out).not.toContain('\n');
    expect(out.split('\n')).toHaveLength(1);
  });

  // `grep -m1` stopped at the FIRST match; the replacement must too, or a
  // replica-2 container could be picked over replica-1 depending only on the
  // order the compose tool happens to print. A mutation that kept the LAST
  // scoped match survived the rest of this file.
  it('keeps the FIRST project-scoped match when several qualify', () => {
    const replicas = [
      'centry-postgres-1',
      'nav225-postgres-1',
      'nav225-postgres-2',
    ].join('\n');
    expect(resolve('nav225', 'postgres', replicas).out).toBe('nav225-postgres-1');
  });

  it('keeps the FIRST fallback match when several qualify', () => {
    const replicas = ['centry-postgres-1', 'other-postgres-2'].join('\n');
    expect(resolve('absent', 'postgres', replicas).out).toBe('centry-postgres-1');
  });

  it('resolves a different service from the same listing', () => {
    expect(resolve('nav225', 'elitea-main', listing).out).toBe('nav225-elitea-main-1');
  });

  it('is empty when nothing matches, and still succeeds', () => {
    const { status, out } = resolve('nav225', 'cassandra', listing);
    expect(status).toBe(0);
    expect(out).toBe('');
  });

  it('is empty for an empty listing', () => {
    expect(resolve('nav225', 'postgres', '').out).toBe('');
  });

  it('treats an empty project as "no preference"', () => {
    expect(resolve('', 'postgres', listing).out).toBe('centry-postgres-1');
  });
});

describe('#228: the pipeline under set -o pipefail', () => {
  // Matches first so `grep -m1` exits early, filler after so the producer is
  // still writing when it does. 40k lines is well past the pipe buffer on both
  // Linux (64 KiB) and macOS (16 KiB), so the SIGPIPE is reliable, not racy.
  const PRODUCER =
    "{ echo nav225-postgres-1; echo centry-postgres-1; seq 1 40000 | sed 's/^/filler-/'; }";

  it('RED: the old `grep -m1` idiom yields TWO names or dies', () => {
    const old = `
      set -euo pipefail
      names=$( ${PRODUCER} | grep -m1 "nav225.*postgres" || \
               ${PRODUCER} | grep -m1 'postgres' || true )
      printf '%s' "$names"
    `;
    const r = spawnSync('bash', ['-c', old], { encoding: 'utf8' });
    const collectedTwo = r.stdout.trim().includes('\n');
    expect(collectedTwo || r.status !== 0).toBe(true);
  });

  it('GREEN: the helper returns one name and exits 0 on the same producer', () => {
    const fixed = `
      set -euo pipefail
      . "$LIB"
      names=$( ${PRODUCER} || true )
      resolve_container_name 'nav225' 'postgres' "$names"
    `;
    const r = spawnSync('bash', ['-c', fixed], {
      encoding: 'utf8',
      env: { ...process.env, LIB },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('nav225-postgres-1');
  });
});
