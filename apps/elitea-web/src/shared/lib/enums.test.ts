import { describe, expect, it } from 'vitest';

import {
  AuthenticationTypes,
  CapabilityTypes,
  ComponentMode,
  PipelineEditorMode,
  ROLES,
  ThemeModeOptions,
  ToolkitViewOptions,
  ViewMode,
  ViewOptions,
  WELCOME_MESSAGE_ID,
} from './enums';

describe('domain enums', () => {
  it('PipelineEditorMode', () => {
    expect(PipelineEditorMode).toEqual({ Flow: 'flow', Yaml: 'yaml' });
  });

  it('CapabilityTypes carries label+value pairs', () => {
    expect(CapabilityTypes.completion).toEqual({ label: 'Text', value: 'completion' });
    expect(CapabilityTypes.chat_completion.value).toBe('chat_completion');
    expect(CapabilityTypes.embeddings.label).toBe('Embeddings');
  });

  it('ROLES', () => {
    expect(ROLES).toEqual({ System: 'system', User: 'user', Assistant: 'assistant' });
  });

  it('WELCOME_MESSAGE_ID', () => {
    expect(WELCOME_MESSAGE_ID).toBe('welcome_message_id');
  });

  it('ViewOptions / ToolkitViewOptions / ThemeModeOptions / ComponentMode / ViewMode', () => {
    expect(ViewOptions).toEqual({ Table: 'table', Cards: 'cards' });
    expect(ToolkitViewOptions).toEqual({ Json: 'json', Form: 'form' });
    expect(ThemeModeOptions).toEqual({ Dark: 'dark', Light: 'light' });
    expect(ComponentMode).toEqual({ CREATE: 'CREATE', EDIT: 'EDIT', VIEW: 'VIEW' });
    expect(ViewMode).toEqual({ Owner: 'owner', Public: 'public' });
  });

  it('AuthenticationTypes preserves the exact old-app label+value pairs (constants.js:670-683)', () => {
    expect(AuthenticationTypes).toEqual({
      None: { label: 'None', value: 'none' },
      APIKey: { label: 'API Key', value: 'api_key' },
      OAuth: { label: 'OAuth', value: 'oauth' },
    });
    // The confirmed live consumer reads exactly this path.
    expect(AuthenticationTypes.None.value).toBe('none');
  });
});
