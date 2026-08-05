/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/
 * toolComponent.helpers.js` (20 lines, Wave-2 unit A4b).
 *
 * BARREL-ALIASING TRAP, resolved by reading past the barrel (mission brief's
 * own warning, confirmed by reading `ui/index.js`/`ui/form/index.js`/
 * `ui/form/ToolBase/index.js` in full): the baseline imports `{ToolkitForm}
 * from '@/[fsd]/features/toolkits/ui'`, which is `export * as ToolkitForm
 * from './form'` — a NAMESPACE re-export of the whole `ui/form/` module,
 * NOT the `ToolkitForm` component that same `ui/form/index.js` ALSO
 * re-exports under its own name (from `./ToolkitForm/ToolkitForm.jsx`).
 * `ToolkitForm.ToolBase`/`ToolkitForm.ToolCustom` below therefore resolve
 * to the `ToolBase`/`ToolCustom` COMPONENTS (`ui/form/ToolBase/ToolBase.jsx`,
 * `ui/form/ToolCustom.jsx`), never to the `ToolkitForm.jsx` component — this
 * port imports those two components directly, by their real names, sidestepping
 * the alias collision entirely instead of reproducing it.
 *
 * `ToolConfluence`/`ToolJira` (A4c) and `ToolBase`/`ToolCustom` (A4d) are
 * intra-slice sibling files this sub-unit does not own — referenced at their
 * baseline-mirroring expected paths (`../../ui/form/ToolBase/*`,
 * `../../ui/form/ToolCustom`); intra-slice imports are free regardless of
 * landing order (R-L3 only restricts crossing INTO a different slice).
 * `ToolTypes` comes from `entities/toolkit` (the Wave-2 promotion pass's
 * ported copy of this exact baseline catalogue — see
 * `../constants/toolkitForm.constants.ts`), not a local duplicate.
 */
import { ToolTypes } from '@/entities/toolkit';
import type { ComponentType } from 'react';

import { ToolBase } from '../../ui/form/ToolBase/ToolBase';
import { ToolConfluence } from '../../ui/form/ToolBase/ToolConfluence';
import { ToolJira } from '../../ui/form/ToolBase/ToolJira';
import { ToolCustom } from '../../ui/form/ToolCustom';

/** The subset of a toolkit-type schema `getToolComponent` needs: presence of a `type` field distinguishes an OpenAPI-shaped/typed schema (-> `ToolBase`) from an untyped one (-> `ToolCustom`). */
export interface ToolComponentSchema {
  readonly type?: unknown;
}

/**
 * A polymorphic "which form renders this toolkit type" reference. `ToolBase`/
 * `ToolCustom`/`ToolConfluence`/`ToolJira` each declare their OWN, mutually
 * incompatible, specific prop contract (`ToolBaseProps`/`ToolCustomProps`/...
 * — A4c/A4d's real, independently-designed components, confirmed by reading
 * them after they landed). Function-prop contravariance means none of those
 * four concrete component types is assignable to a single shared
 * `ComponentType<SomeUnion>` without erasing the prop type — the SAME
 * "resolved by a runtime discriminant, caller supplies discriminant-
 * appropriate props" shape every dynamic-component-dispatch utility in the
 * React ecosystem erases to `ComponentType<any>` for (there is no narrower
 * sound alternative: the whole POINT of this function is that the caller
 * doesn't know which of the four prop shapes it's getting until it inspects
 * `type` itself, at which point the caller — not this function — is
 * responsible for supplying the matching props).
 */
export type ToolFormComponent = ComponentType<any>;

/**
 * Resolves which settings-form component renders a toolkit type's fields.
 * `jira`/`confluence` get their own hand-built forms UNLESS `isCredential`
 * is set (a credential/configuration context reuses the generic form
 * instead — mirrors the baseline's `if (!isCredential) return ToolJira`
 * early-return-only-when-not-credential shape). `type === undefined`
 * returns `undefined` (no component — mirrors the baseline's bare `return;`).
 * Every other type falls through to `ToolBase` (has a typed schema) or
 * `ToolCustom` (no typed schema, generic key/value form).
 */
export function getToolComponent(type: string | undefined, toolSchema?: ToolComponentSchema, isCredential = false): ToolFormComponent | undefined {
  switch (type) {
    case ToolTypes.jira.value:
      if (!isCredential) return ToolJira;
      break;
    case ToolTypes.confluence.value:
      if (!isCredential) return ToolConfluence;
      break;
    case undefined:
      return undefined;
    default:
      break;
  }
  return toolSchema && toolSchema.type ? ToolBase : ToolCustom;
}
