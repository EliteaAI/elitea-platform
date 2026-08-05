/**
 * ModeSwitch — port of `apps/elitea-ui/src/pages/ModeSwitch.jsx` (Wave-2 unit A13).
 *
 * This page is DEAD CODE in the baseline (`enableToggle = false`). The port
 * preserves the structure faithfully but notes the dead-code status in a
 * comment so future reviewers do not mistake the toggle checkbox for active
 * behavior.
 *
 * In the new app the toggle checkbox is gated behind the same `false` flag,
 * so the page renders only its heading. Theme switching is handled
 * exclusively by `ThemeModeToggle` (promoted to `shared/ui`).
 */
import { memo } from 'react';

/** A mode-switch page (dead code — `enableToggle` is `false`). */
export const ModeSwitch = memo(() => {
  const enableToggle = false;

  return (
    <div>
      <h1>Switch Mode</h1>
      {enableToggle && (
        <>
          <label htmlFor="mode-toggle" style={{ marginRight: '10px' }}>
            Toggle Mode:
          </label>
          <input
            id="mode-toggle"
            type="checkbox"
            checked={false}
            onChange={() => {}}
          />
          <span>Dark Mode</span>
        </>
      )}
    </div>
  );
});

ModeSwitch.displayName = 'ModeSwitch';
