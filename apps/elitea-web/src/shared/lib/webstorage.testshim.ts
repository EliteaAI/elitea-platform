/**
 * Test-environment Web Storage shim (carry-forward item "action for M1",
 * `elitea-docs/.../ui/decisions-ui-reimplementation-2026-07-26.md`).
 *
 * WHY THIS EXISTS — the failure it fixes, reproduced 2026-08-06:
 *
 *   ExperimentalWarning: localStorage is not available because
 *   --localstorage-file was not provided.
 *   TypeError: Cannot read properties of undefined (reading 'getItem')
 *       ... in <Sidebar> / <AppShell>
 *
 * Under vitest 4 on Node 24, Node ships its OWN experimental `localStorage`
 * global. In the `node` (jsdom) vitest project that global SHADOWS jsdom's
 * implementation, and because the process is started without
 * `--localstorage-file` Node's version resolves to `undefined`. The result is
 * that `window.localStorage` — which jsdom would otherwise provide — is
 * `undefined`, so any component reading it during an effect throws.
 *
 * This is an environment defect, not a product one: the app code is correct
 * and works in a real browser. The shim therefore installs a REAL in-memory
 * `Storage` only when the global is missing or broken, and never replaces a
 * working implementation — so if a future Node/jsdom/vitest combination fixes
 * the shadowing, this becomes inert rather than silently taking over.
 *
 * Deliberately NOT a mock (§6.2: "mocks stop at the network boundary"). It is
 * a faithful `Storage` implementation — same semantics for `length`,
 * `key(n)`, string coercion of keys and values, and `removeItem` on a missing
 * key being a no-op — so tests exercise real storage behaviour.
 */

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length(): number {
      return entries.size;
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return entries.get(String(key)) ?? null;
    },
    setItem(key: string, value: string): void {
      entries.set(String(key), String(value));
    },
    removeItem(key: string): void {
      entries.delete(String(key));
    },
    clear(): void {
      entries.clear();
    },
  } satisfies Storage;
}

function isUsable(candidate: unknown): boolean {
  if (candidate === undefined || candidate === null) return false;
  try {
    const storage = candidate as Storage;
    const probe = '__elitea_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install an in-memory `localStorage`/`sessionStorage` on `window` and
 * `globalThis` wherever the environment does not already provide a working
 * one. Idempotent. Returns the names it had to shim, so a caller (or a test)
 * can assert on what the environment was missing.
 */
export function installWebStorageShim(): readonly string[] {
  const shimmed: string[] = [];
  const targets: readonly (typeof globalThis)[] =
    typeof window === 'undefined' || (window as unknown) === globalThis
      ? [globalThis]
      : [globalThis, window as unknown as typeof globalThis];

  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (isUsable((globalThis as Record<string, unknown>)[name])) continue;
    const storage = createMemoryStorage();
    for (const target of targets) {
      Object.defineProperty(target, name, {
        value: storage,
        configurable: true,
        writable: true,
      });
    }
    shimmed.push(name);
  }
  return shimmed;
}
