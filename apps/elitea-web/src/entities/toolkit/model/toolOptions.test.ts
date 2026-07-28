import { describe, expect, it } from 'vitest';

import { ToolTypes } from './toolForm';
import { ToolOptionsByType } from './toolOptions';

describe('ToolOptionsByType', () => {
  it('has an entry for every non-custom, non-application, non-image-generation, non-service-now tool type', () => {
    // None of these have a per-type options array in the baseline's
    // `toolOptions.js` either — `gitlab_org` deliberately reuses `gitlab`'s
    // array (see `toolInitialValues.ts`'s `selectedTools('gitlab')` call
    // for the `gitlab_org` entry, matching `consts.js`'s own
    // `gitlabToolOptions.map(...)` reuse for both types).
    const excluded = new Set([
      'custom',
      'application',
      'image_generation_model',
      'service_now',
      'openapi',
      'open_api',
      'gitlab_org',
      'zephyr_enterprise',
      'zephyr_essential',
      'zephyr_squad',
    ]);
    for (const key of Object.keys(ToolTypes)) {
      if (excluded.has(key)) continue;
      expect(ToolOptionsByType[key], `expected ToolOptionsByType.${key} to exist`).toBeDefined();
    }
  });

  it('yagmail has exactly one option', () => {
    expect(ToolOptionsByType.yagmail).toEqual([{ label: 'Send e-mail', value: 'send_gmail_message' }]);
  });
});
