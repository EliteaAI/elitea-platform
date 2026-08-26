
export type TSupportAssistantContext = {
  assistant_name?: string;
  assistant_version?: string;
  project_id?: number;
  project_name?: string;
  current_page?: string;
  current_entity_type?: string;
  current_entity_id?: number;
  current_entity_name?: string;
  selected_provider?: string;
  selected_model?: string;
  meta?: Record<string, unknown>;
};

/**
 * `GET /support_assistant/config`.
 *
 * ONLY `enabled` IS REQUIRED, which is a correction to the reference's shape
 * rather than a looser transcription of it. The server answers a disabled
 * deployment with `{"enabled": false}` and NOTHING ELSE — no project id, no
 * operator strings, no identity — so that a feature which is off is not also a
 * channel reporting which project the platform reserved for support. A type
 * that demanded the rest would be describing a body the server never sends.
 *
 * Every consumer therefore defaults: see `useInitAssistant`, where the props
 * are the fallback for a field the operator has not set.
 */
export type TAssistantConfig = {
  enabled: boolean;
  title?: string | undefined;
  welcome_message?: string | undefined;
  placeholder?: string | undefined;
  support_project_id?: number | undefined;
  user?:
    | {
        id?: number | undefined;
        name?: string | undefined;
        avatar?: string | undefined;
      }
    | undefined;
};

export type TEliteaAssistantPosition = 'bottom-right' | 'bottom-left';

/*
 * `TEliteaAssistantProps` USED TO STAND HERE and is gone with the embedding
 * seams it described — `apiUrl`, `token`, `withCredentials`, `socketPath`,
 * `apiAdapter`. Inside this app each of them has exactly one correct value, so
 * `EliteaAssistant.tsx` declares its own narrower prop type instead. See its
 * doc comment.
 */

export type TEliteaAssistantRef = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  expandFullscreen: () => void;
  collapseFullscreen: () => void;
  toggleFullscreen: () => void;
  showPopup: () => void;
  hidePopup: () => void;
  isOpen: () => boolean;
  isExpanded: () => boolean;
};
