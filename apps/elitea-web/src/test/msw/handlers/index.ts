import type { RequestHandler } from 'msw';

/**
 * MSW handler registry (spec §6.5 R-M2). Empty at Wave 0 by design — unit M1
 * populates it from orval-generated handlers and Channel-B fixtures. Every
 * entry added here must go through `registerValidatedHandlers` (R-M3) and
 * derive its body from a fixture file, never an inline object literal (R-M2,
 * checked by scripts/check-handlers.mjs when M1 lands it).
 */
export const handlers: RequestHandler[] = [];
