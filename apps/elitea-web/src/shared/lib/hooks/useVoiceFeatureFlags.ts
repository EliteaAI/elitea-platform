/**
 * The platform's Voice Features switches — unit A14, issue #200.
 *
 * ## Why this is in `shared/lib` when its four MCP siblings are feature-local
 *
 * `useIsMcpVisible` exists four times over, once per feature slice, each copy
 * carrying the same "kept feature-local … promote once a second consumer
 * exists" note — because `no-sideways-features` forbids one feature importing
 * another, and every consumer happened to be a feature.
 *
 * These flags do not have that shape. Their consumers sit in two different
 * layers: `widgets/chat/ui/chat-button/VoiceButton.tsx` (the mounted one, and
 * the reason this section is live at all) and
 * `features/chat-input/ui/VoiceControlButton.tsx`. A feature may not import a
 * widget, so a feature-local copy in `chat-input` could not have been the
 * widget's source, and a widget-local one could not have been the feature's.
 * `shared` is the only home both may reach — which is the promotion condition
 * those four files describe, actually met.
 *
 * ## What these replaced
 *
 * Two module constants, in each of the two components:
 *
 *     const VOICE_FEATURES_ENABLED = true;
 *     const VOICE_FEATURES_TEMPORARILY_DISABLED = false;
 *
 * The admin Features page has offered switches named after both since the
 * reference SPA, and neither had any relationship to the control it named. That
 * is the defect unit A14 exists to remove, in its purest form: an operator hides
 * voice input platform-wide, is shown a success, and every user keeps the
 * button.
 *
 * ## Reading, not gating
 *
 * These are presentation flags and nothing more. Voice capture happens in the
 * browser, so there is no server-side surface to close — unlike `mcp_enabled`,
 * whose master-switch half is a 403 on three routes. Anything a hidden voice
 * button could have reached (the project ASR model lookup) is authorised on its
 * own terms.
 */
import { useGetPlatformSettings } from '@/shared/api/generated/admin/admin';
import type { PlatformSettings } from '@/shared/api/generated/model';

export interface VoiceFeatureFlags {
  /** False hides every voice control. */
  readonly enabled: boolean;
  /** True leaves them visible but non-interactive, with the admin tooltip. */
  readonly temporarilyDisabled: boolean;
}

export function useVoiceFeatureFlags(): VoiceFeatureFlags {
  const query = useGetPlatformSettings();
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const settings = query.data?.data as PlatformSettings | undefined;
  return {
    // `!== false`, not `=== true`. While the query is in flight — and on a
    // deployment older than this field — the answer must be "enabled", or every
    // chat would flicker its voice button out and back on every page load.
    enabled: settings?.voice_features_enabled !== false,
    // `=== true` here, the other way round, and for the same reason: the
    // conservative default for "disable this control" is not to.
    temporarilyDisabled: settings?.voice_features_temporarily_disabled === true,
  };
}
