/**
 * The platform-flag lock (issue #519).
 *
 * ## The problem this exists for
 *
 * `mcp_enabled` is ONE row for the whole deployment, and journey 36b exists to
 * prove that turning it off changes the platform. While it is off, the platform
 * IS changed — for every other journey as well. The MCP surfaces disappear:
 * `useIsMcpVisible()` returns false, `ToolkitTypeSelector` returns null, the
 * `/mcps` route is closed, and `ToolBase` stops drawing the "Make tools
 * available by MCP" field.
 *
 * `fullyParallel` is on, so a different set of journeys was inside that window
 * on every run. Measured in this repository, on one tree:
 *
 *  - journey 17.3 failing on the missing MCP checkbox, 2 runs in 10;
 *  - the two MCP journeys of JRNY-018 failing on an empty catalogue and an
 *    absent search box, in three separate CI runs of `E2E (webkit)`.
 *
 * A mutex over the WRITERS alone cannot fix that: the readers never took it.
 *
 * ## The lock
 *
 * One writer, many readers, over the filesystem, because the readers are in
 * different worker PROCESSES (and, when the suite is run locally with both
 * engines, in different browser projects against one stack).
 *
 *  - the writer is a directory. `mkdir` fails atomically on an existing
 *    directory on every platform, which is the whole mechanism, and it needs no
 *    dependency — the reason lockfiles have used it for decades.
 *  - each reader is a file in `readers/`. The writer waits for that directory
 *    to drain before it enters.
 *
 * A reader creates its file and then LOOKS AGAIN for the writer. That second
 * look is what closes the window between "no writer" and "my file exists": a
 * writer that arrived in between is seen, the reader removes its file and backs
 * off, and the writer — which was already waiting on that same file — goes
 * through. Neither side can pass the other.
 *
 * Nothing here can wedge the suite. Both sides break a token older than
 * `STALE_MS` and both sides give up waiting at that bound and continue, because
 * a lock that can stop CI is a worse failure than the race it prevents.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(tmpdir(), 'elitea-e2e-platform-flags');
const WRITER = join(ROOT, 'writer');
const READERS = join(ROOT, 'readers');

/** Older than this and a token belongs to a run that is gone. */
const STALE_MS = 90_000;
const POLL_MS = 100;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function ensureDirs(): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  await mkdir(READERS, { recursive: true });
}

/** True while a live writer holds the lock. Breaks a stale one on the way. */
async function writerHeld(): Promise<boolean> {
  try {
    const info = await stat(WRITER);
    if (Date.now() - info.mtimeMs > STALE_MS) {
      await rm(WRITER, { recursive: true, force: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** The reader tokens that are still live. Removes the ones that are not. */
async function liveReaders(): Promise<number> {
  let names: string[] = [];
  try {
    names = await readdir(READERS);
  } catch {
    return 0;
  }
  let live = 0;
  for (const name of names) {
    const path = join(READERS, name);
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > STALE_MS) {
        await rm(path, { force: true });
        continue;
      }
      live += 1;
    } catch {
      // Removed while it was read. It is not live.
    }
  }
  return live;
}

/**
 * Runs `body` with the platform flags held exclusively: no reader that took
 * `withPlatformFlagsUnchanged` is inside the window.
 */
export async function withPlatformFlagLock<T>(body: () => Promise<T>): Promise<T> {
  await ensureDirs();

  const deadline = Date.now() + STALE_MS;
  for (;;) {
    try {
      await mkdir(WRITER);
      break;
    } catch {
      // Also breaks a stale writer, so this cannot spin for ever.
      await writerHeld();
      if (Date.now() > deadline) {
        await rm(WRITER, { recursive: true, force: true });
        continue;
      }
      await sleep(POLL_MS);
    }
  }

  try {
    const drainBy = Date.now() + STALE_MS;
    while ((await liveReaders()) > 0 && Date.now() < drainBy) {
      await sleep(POLL_MS);
    }
    return await body();
  } finally {
    await rm(WRITER, { recursive: true, force: true });
  }
}

/**
 * Takes the SHARED lock and returns the release.
 *
 * Take it in a journey that READS a platform flag — the MCP surfaces are the
 * ones that exist today. Readers never wait for each other, so outside journey
 * 36's window the cost is one `stat` and one file.
 */
export async function acquirePlatformFlagRead(): Promise<() => Promise<void>> {
  await ensureDirs();

  const token = join(READERS, `${String(process.pid)}-${randomUUID()}`);
  const deadline = Date.now() + STALE_MS;

  for (;;) {
    while ((await writerHeld()) && Date.now() < deadline) {
      await sleep(POLL_MS);
    }
    await writeFile(token, String(Date.now()));
    if (!(await writerHeld())) break;
    // A writer arrived between the two looks. Stand aside; it is already
    // waiting for this token.
    await rm(token, { force: true });
    if (Date.now() > deadline) break;
    await sleep(POLL_MS);
  }

  return async () => {
    await rm(token, { force: true });
  };
}

/**
 * Registers the shared lock around every test of the calling file.
 *
 * A hook pair rather than a wrapper so a spec file states the dependency once,
 * at the top instead of indenting every body — and so a test added to that
 * file later cannot forget it. Module state is safe: a worker process runs one
 * test at a time.
 */
export function readsPlatformFlags(test: {
  beforeEach: (fn: () => Promise<void>) => void;
  afterEach: (fn: () => Promise<void>) => void;
}): void {
  let release: (() => Promise<void>) | undefined;

  test.beforeEach(async () => {
    release = await acquirePlatformFlagRead();
  });

  test.afterEach(async () => {
    await release?.();
    release = undefined;
  });
}
