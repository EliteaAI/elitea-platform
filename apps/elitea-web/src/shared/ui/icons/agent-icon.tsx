/**
 * Ported from apps/elitea-ui/src/assets/agent.svg (Wave-1 icon port, unit S2).
 * Name collision with agent-icon.svg resolved by content: this is the 2x2 grid glyph (actively used, e.g. flow-editor node.helpers.jsx).
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as AgentIcon } from './svg/agent-icon.svg?react';
