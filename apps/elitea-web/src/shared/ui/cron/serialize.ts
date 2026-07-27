/**
 * Structured state -> cron expression (inverse of `parse.ts`).
 */
import type { CronExpressionState, CronFieldState } from './model';
import { CRON_FIELD_ORDER } from './model';

export function serializeField(field: CronFieldState): string {
  switch (field.kind) {
    case 'every':
      return '*';
    case 'list':
      return field.values.join(',');
    case 'range':
      return `${field.from}-${field.to}`;
    case 'step':
      return `*/${field.step}`;
  }
}

export function serializeCronState(state: CronExpressionState): string {
  return CRON_FIELD_ORDER.map((fieldId) => serializeField(state[fieldId])).join(' ');
}
