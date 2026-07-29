import { describe, expect, it } from 'vitest';

import * as slice from './index';

/**
 * Pins the slice's RUNTIME public surface (spec §3.3: index.ts is the only
 * file other slices may import). `export type` interfaces are erased by
 * `verbatimModuleSyntax` and never appear on the runtime namespace object,
 * so this list is deliberately the value-export subset only — see
 * `./index.ts`'s own module doc for the full (type + value) surface and the
 * §3.5 budget accounting (exactly 20/20 across both).
 * Precedent: `entities/conversation/index.test.ts`, `features/chat-conversation-list/index.test.ts`.
 */
const PUBLIC_SURFACE = [
  'ChatConversationStarters',
  'conversationStarterHooks',
  'mentionHooks',
  'SlashSuggestionList',
  'UserMentionList',
  'NewChatInput',
  'chatInputCompositionHooks',
  'voiceHooks',
  'VoiceControlButton',
  'VoiceMiniPlayer',
  'ImageAttachment',
  'chatAttachmentHooks',
] as const;

describe('features/chat-input public surface', () => {
  it('exports exactly the documented runtime set', () => {
    expect(Object.keys(slice).sort()).toEqual([...PUBLIC_SURFACE].sort());
  });

  it('every exported bundle only carries defined function members', () => {
    const bundles = [slice.conversationStarterHooks, slice.mentionHooks, slice.chatInputCompositionHooks, slice.voiceHooks, slice.chatAttachmentHooks];
    for (const bundle of bundles) {
      for (const value of Object.values(bundle)) {
        expect(typeof value).toBe('function');
      }
    }
  });

  it('every exported component is defined', () => {
    const components = [slice.ChatConversationStarters, slice.SlashSuggestionList, slice.UserMentionList, slice.NewChatInput, slice.VoiceControlButton, slice.VoiceMiniPlayer, slice.ImageAttachment];
    for (const component of components) {
      expect(component).toBeDefined();
    }
  });
});
