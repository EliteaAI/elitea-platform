/**
 * Preset dropdown (spec §9.3 unit S7: "a preset dropdown"). `react-js-cron`
 * ships `shortcuts: true` by default (verified against the upstream README:
 * `['@yearly','@annually','@monthly','@weekly','@daily','@midnight',
 * '@hourly']`) and neither modal disables it, so the old UI *does* expose a
 * shortcut picker. These six are that vocabulary translated to standard
 * 5-field cron (`@midnight`/`@daily` collapse to the same expression). The
 * seventh, `weekly-saturday`, is not from react-js-cron — it is
 * `IndexCronDefault`/`PipelineCronDefault` (`'0 0 * * 6'`, both
 * `indexDetails.constants.js:42` and `PipelineScheduleModal.jsx:14`), i.e.
 * the one schedule both modals actually default new schedules to.
 */
import { t } from '../lib/t';
import { parseCronExpression } from './parse';
import { serializeCronState } from './serialize';

export interface CronPreset {
  readonly id: string;
  readonly key: string;
  readonly fallback: string;
  readonly expression: string;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { id: 'every-minute', key: 'shared.ui.cron.preset.everyMinute', fallback: 'Every minute', expression: '* * * * *' },
  { id: 'hourly', key: 'shared.ui.cron.preset.hourly', fallback: 'Every hour', expression: '0 * * * *' },
  { id: 'daily', key: 'shared.ui.cron.preset.daily', fallback: 'Every day at midnight', expression: '0 0 * * *' },
  {
    id: 'weekly-saturday',
    key: 'shared.ui.cron.preset.weeklySaturday',
    fallback: 'Every Saturday at midnight',
    expression: '0 0 * * 6',
  },
  {
    id: 'monthly',
    key: 'shared.ui.cron.preset.monthly',
    fallback: 'Every month on the 1st',
    expression: '0 0 1 * *',
  },
  {
    id: 'yearly',
    key: 'shared.ui.cron.preset.yearly',
    fallback: 'Every year on Jan 1st',
    expression: '0 0 1 1 *',
  },
];

export function presetLabel(preset: CronPreset): string {
  return t(preset.key, preset.fallback);
}

/** The dropdown's own placeholder value for "none of the above" (disabled, display-only). */
export const CUSTOM_PRESET_VALUE = '__custom__';

/**
 * Resolves a `Select` value to the expression it should apply, or `null`
 * when there is nothing to apply (`CUSTOM_PRESET_VALUE`, or an id that is
 * not — or is no longer — in `CRON_PRESETS`). Pulled out of
 * `CronPresetSelect`'s `onChange` so it is unit-testable without needing to
 * drive a click through a `disabled` MUI `MenuItem`.
 */
export function resolvePresetExpression(selectedId: string): string | null {
  if (selectedId === CUSTOM_PRESET_VALUE) return null;
  return CRON_PRESETS.find((preset) => preset.id === selectedId)?.expression ?? null;
}

/**
 * `CronPresetSelect`'s entire `onChange` body: resolve the id, and call
 * `onSelect` only when it resolved to something. Kept here (not inline in
 * the component) so the "nothing resolved" branch — real per
 * `resolvePresetExpression`'s contract, but unreachable by clicking the
 * `disabled` "Custom" `MenuItem` — is unit-testable with a plain function
 * call instead of fighting a disabled menu item's pointer-events in jsdom.
 */
export function applyPresetSelection(selectedId: string, onSelect: (expression: string) => void): void {
  const expression = resolvePresetExpression(selectedId);
  if (expression) onSelect(expression);
}

/**
 * Canonicalises `expression` (parse -> serialize) before comparing, so a
 * preset still shows as "active" when the value came from anywhere other
 * than this dropdown but is semantically identical (e.g. `'0 0 * * 06'`
 * would not match textually but nothing on this editor's path ever produces
 * a non-canonical form, so this is a defensive normalisation, not a load-
 * bearing one).
 */
export function findMatchingPresetId(expression: string): string | null {
  const parsed = parseCronExpression(expression);
  if (!parsed.ok) return null;
  const canonical = serializeCronState(parsed.state);
  return CRON_PRESETS.find((preset) => preset.expression === canonical)?.id ?? null;
}
