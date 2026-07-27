/**
 * Clipboard helper ported from apps/elitea-ui/src/common/utils.jsx
 * (`handleCopy`, `utils.jsx:707-723`) and its dependency
 * apps/elitea-ui/src/utils/browserUtils.js (`copyToClipboard`,
 * `fallbackCopyToClipboard`) — unit S3, spec §9.3.
 *
 * `browserUtils.js` is not one of S3's two porting targets (`utils.jsx` +
 * `constants.js`), so its small clipboard fallback is reproduced locally
 * here rather than imported cross-scope, matching the pattern this unit's
 * brief sanctions for S6 helpers: "define your own minimal local version".
 * 21 call sites in the old app depend on `handleCopy`, so this is a live,
 * widely-used helper, not dead code.
 */

function legacyCopyViaTextarea(text: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      const textField = document.createElement('textarea');
      textField.innerText = text;
      textField.style.position = 'fixed';
      textField.style.left = '-999999px';
      textField.style.top = '-999999px';
      document.body.appendChild(textField);
      textField.focus();
      textField.select();
      // oxlint-disable-next-line typescript/no-deprecated -- this IS the deprecated legacy fallback; parity with the old app's own use of it.
      const successful = document.execCommand('copy');
      textField.remove();
      if (successful) {
        resolve(true);
      } else {
        reject(new Error('Copy command failed'));
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function isClipboardSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
}

async function universalCopyToClipboard(text: string): Promise<boolean> {
  if (isClipboardSupported()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopyViaTextarea(text);
    }
  }
  return legacyCopyViaTextarea(text);
}

/**
 * Copies `text` to the clipboard, preferring the async Clipboard API and
 * falling back to a hidden-textarea `execCommand('copy')`.
 *
 * Preserved quirk (N4, old-app `utils.jsx:716-723`): if BOTH the primary
 * path and its internal fallback fail, the `catch` block fires
 * `navigator.clipboard.writeText(text)` again — fire-and-forget, NOT
 * awaited, and NOT wrapped in try/catch, so a second failure becomes an
 * unhandled promise rejection rather than surfacing from `handleCopy`
 * itself. The old code's `navigator ? navigator.clipboard.writeText(text) :
 * copyToClipboard(text)` ternary's `else` branch is additionally dead in
 * any real browser (`navigator` is always defined there) — both quirks are
 * ported byte-for-byte rather than cleaned up; see the S3 report.
 */
export async function handleCopy(text: string): Promise<void> {
  try {
    await universalCopyToClipboard(text);
  } catch {
    // Parity: fire-and-forget, unawaited, exactly like the old app.
    void navigator.clipboard.writeText(text);
  }
}
