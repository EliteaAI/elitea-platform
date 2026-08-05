import { describe, expect, it } from 'vitest';

import { ToolEvents, ToolTypes, hostingOptions, toolIconStaticUrl } from './toolForm';

describe('ToolTypes', () => {
  it('has a label/value pair for every key, keyed by its own value', () => {
    for (const [key, entry] of Object.entries(ToolTypes)) {
      expect(entry.value === key || key === 'open_api').toBe(true);
      expect(typeof entry.label).toBe('string');
    }
  });

  it('maps both "openapi" and "open_api" to the same wire value', () => {
    expect(ToolTypes.openapi.value).toBe('openapi');
    expect(ToolTypes.open_api.value).toBe('openapi');
  });
});

describe('ToolEvents', () => {
  it('exposes the 7 baseline event names', () => {
    expect(Object.keys(ToolEvents)).toHaveLength(7);
    expect(ToolEvents.SaveEvent).toBe('SaveEvent');
  });
});

describe('hostingOptions', () => {
  it('has Cloud (true) and Server (false) entries', () => {
    expect(hostingOptions).toEqual([
      { label: 'Cloud', value: true },
      { label: 'Server', value: false },
    ]);
  });
});

describe('toolIconStaticUrl', () => {
  it('strips a trailing "/api/v2/" and appends the icon path', () => {
    expect(toolIconStaticUrl('https://dev.elitea.ai/api/v2/')).toBe(
      'https://dev.elitea.ai/app/application_tool_icon',
    );
  });

  it('strips a trailing "/api/v2" (no slash) and appends the icon path', () => {
    expect(toolIconStaticUrl('https://dev.elitea.ai/api/v2')).toBe('https://dev.elitea.ai/app/application_tool_icon');
  });
});
