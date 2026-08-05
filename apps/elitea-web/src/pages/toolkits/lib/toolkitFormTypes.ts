import type { ComponentProps } from 'react';

import { ToolkitForm } from '@/features/toolkits';

/**
 * The shape `ToolkitForm`'s (and, transitively, `ConfigurationTab`'s
 * `toolDetailState.editToolDetail`) `editToolDetail` prop expects
 * (`ToolkitFormEditDetail`, `features/toolkits/ui/form/ToolkitForm/
 * ToolkitForm.tsx`), derived structurally from the already-exported
 * `ToolkitForm` component's own prop type rather than spending a FIFTH
 * `features/toolkits`' index.ts export slot naming it directly — that
 * slice's public API is already at the §3.5 20-symbol ceiling (see
 * `features/toolkits/index.ts`'s own doc comment). `ComponentProps<typeof
 * ToolkitForm>['editToolDetail']` is exactly `ToolkitFormEditDetail` at
 * every real call site in this `pages/toolkits/**` unit — both
 * `CreateToolkit.tsx` and `EditToolkit.tsx` need to name this one shared
 * shape for their own local `useState`, so it lives here once rather than
 * being re-derived twice.
 */
export type EditToolDetail = NonNullable<ComponentProps<typeof ToolkitForm>['editToolDetail']>;
