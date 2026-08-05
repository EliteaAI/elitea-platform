/**
 * `StateVariableItemProps`, split into its own file so both `./
 * StateVariableItem.tsx` and `./StateVariableItem.controller.ts` can import
 * it without either importing FROM the other (a real, if type-only, import
 * cycle) — same "shared type in its own file" fix `./
 * StateVariableTable.columns.tsx`'s own doc comment applies to
 * `StateTableRow`.
 */

/** @public */
export interface StateVariableItemProps {
  readonly mode?: 'create' | 'display' | undefined;
  readonly name: string;
  readonly type: string;
  readonly enabled?: boolean | undefined;
  readonly isDefault?: boolean | undefined;
  readonly defaultValue?: unknown;
  readonly drawerWidth?: number | undefined;
  readonly validateName?: ((name: string, excludeName?: string | null) => string) | undefined;
  readonly onToggle?: ((name: string, enabled: boolean) => void) | undefined;
  readonly onDelete?: ((name: string) => void) | undefined;
  readonly onUpdateName?: ((name: string, newName: string) => void) | undefined;
  readonly onUpdateType?: ((name: string, type: string) => void) | undefined;
  readonly onUpdateDefaultValue?: ((name: string, type: string, value: unknown) => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly editable?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}
