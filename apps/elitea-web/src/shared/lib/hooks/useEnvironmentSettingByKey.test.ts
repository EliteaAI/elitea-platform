import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PARTICIPANT_NAME,
  DEFAULT_TOAST_DURATION,
  ENVIRONMENT_KEYS,
} from './useEnvironmentSettingByKey';

describe('ENVIRONMENT_KEYS', () => {
  it('contains expected keys', () => {
    expect(ENVIRONMENT_KEYS.SYSTEM_SENDER_NAME).toBe('system_sender_name');
    expect(ENVIRONMENT_KEYS.ERROR_TOAST_DURATION).toBe('error_toast_duration');
  });
});

describe('DEFAULT_PARTICIPANT_NAME', () => {
  it('is a non-empty string', () => {
    expect(typeof DEFAULT_PARTICIPANT_NAME).toBe('string');
    expect(DEFAULT_PARTICIPANT_NAME.length).toBeGreaterThan(0);
  });
});

describe('DEFAULT_TOAST_DURATION', () => {
  it('is a positive number', () => {
    expect(typeof DEFAULT_TOAST_DURATION).toBe('number');
    expect(DEFAULT_TOAST_DURATION).toBeGreaterThan(0);
  });
});
