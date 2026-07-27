/**
 * Ported from apps/elitea-ui/src/assets/agent-icon.svg (Wave-1 icon port, unit S2).
 * Name collision with agent.svg resolved by content: this is the robot-mascot glyph. Unreferenced by any consumer in the old app (grep: 0 hits) — ported anyway per no-placeholder rule.
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as AgentRobotIcon } from './svg/agent-robot-icon.svg?react';
