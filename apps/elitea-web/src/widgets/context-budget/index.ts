/**
 * widgets/context-budget — the "Context Budget" panel at the foot of the chat
 * participants rail. See `ui/ContextBudget.tsx` for the mounting contract and
 * the one deliberate scope cut (no edit-strategy modal).
 */
export { ContextBudget } from './ui/ContextBudget';
export type { ContextBudgetProps } from './ui/ContextBudget';
export { ContextBudgetPanel } from './ui/ContextBudgetPanel';
export type { ContextBudgetPanelProps } from './ui/ContextBudgetPanel';
export { toContextBudgetStats, formatNumberWithSpaces } from './lib/contextStatus';
export type { ContextBudgetStats } from './lib/contextStatus';
