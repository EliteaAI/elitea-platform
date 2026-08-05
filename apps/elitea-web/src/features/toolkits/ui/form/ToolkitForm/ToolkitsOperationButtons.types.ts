/**
 * `ToolkitsOperationButtons.tsx`'s own prop types — split out purely to
 * stay under the §3.5 400-line-per-file budget.
 */
export interface SaveToolkitPayload {
  readonly projectId: string | undefined;
  readonly toolId: string | number | undefined;
  readonly values: Readonly<Record<string, unknown>>;
  readonly name: string | undefined;
}

/**
 * Every optional field below carries an explicit `| undefined` (not just
 * `?:`) — this app's `exactOptionalPropertyTypes` (`tsconfig.json`)
 * distinguishes "prop absent" from "prop present but `undefined`", and
 * `ToolkitForm.tsx`'s own optional props (which this component's props
 * largely mirror) are themselves already `| T | undefined`-typed, so a
 * plain `?: T` target here would reject them at the JSX call site. Same
 * convention `shared/ui`'s `FieldHeaderProps` doc comment already
 * documents for this exact constraint.
 *
 * §3.5's `component-props` budget (12) grouped the baseline's originally
 * flat ~24-field prop list into `status`/`form`/`save`/`display` option
 * objects, matching `shared/ui`'s own `BaseModal.tsx` `header`/`actions`
 * precedent for the identical budget. `display` in particular carries
 * fields `ToolkitsOperationButtons.tsx`'s own logic never reads
 * (`isDirty`/`type`/`configuration`/`isCreatingConfiguration`/
 * `isTestingConnection`/`view`/`onChangeView`/`hideViewToggle` — grepped:
 * none appear outside this interface) — kept for shape-parity with
 * `ToolkitForm.tsx`'s own render, which passes them through
 * unconditionally, not because that component consumes them.
 */
interface ToolkitsOperationButtonsStatus {
  readonly hasErrors?: boolean | undefined;
  readonly hasNotSavedToolConfiguration?: boolean | undefined;
}

interface ToolkitsOperationButtonsForm {
  /** The outer form's current values (baseline: Formik `values`). */
  readonly values: Readonly<Record<string, unknown>>;
  /** The outer form's initial values (baseline: Formik `initialValues`). */
  readonly initialValues: Readonly<Record<string, unknown>> | undefined;
  readonly onReset?: (() => void) | undefined;
}

interface ToolkitsOperationButtonsSave {
  readonly onSave: (payload: SaveToolkitPayload) => Promise<Readonly<Record<string, unknown>>>;
  readonly onSuccess?: ((savedValues: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly onError?: ((message: string) => void) | undefined;
  readonly onConfigurationCreated?: (() => void) | undefined;
}

/** Accepted for shape-parity with `ToolkitForm.tsx`'s own render (which passes all of these through unconditionally) — see `ToolkitsOperationButtonsStatus`'s own doc comment for why none of them are read by `ToolkitsOperationButtons.tsx`'s own logic. */
interface ToolkitsOperationButtonsDisplay {
  readonly isDirty?: boolean | undefined;
  readonly type?: string | undefined;
  readonly configuration?: { readonly elitea_title?: string | undefined; readonly private?: boolean | undefined } | undefined;
  readonly isCreatingConfiguration?: boolean | undefined;
  readonly isTestingConnection?: boolean | undefined;
  readonly view?: string | undefined;
  readonly onChangeView?: ((view: string) => void) | undefined;
  readonly hideViewToggle?: boolean | undefined;
}

export interface ToolkitsOperationButtonsProps {
  readonly isAdding: boolean;
  readonly status?: ToolkitsOperationButtonsStatus | undefined;
  readonly onCreateConfiguration: () => Promise<unknown>;
  readonly onTestConnection: () => Promise<boolean>;
  readonly onRevertCredentials: () => void;
  /** The current toolkit-type schema, read only for its `properties[key].toolkit_name`-flagged entry (`getToolkitName`, `ToolkitsOperationButtons.tsx`) — deliberately loose (`Readonly<Record<string, unknown>>` property values, not a narrower shape) since the real caller-supplied schema (`ToolkitForm.tsx`'s `RawToolkitTypeSchema`) types every property's inner shape as `unknown`. */
  readonly toolSchema?: { readonly properties?: Readonly<Record<string, unknown>> } | undefined;
  readonly setShowValidation?: ((show: boolean) => void) | undefined;
  readonly form: ToolkitsOperationButtonsForm;
  readonly isTeamProject: boolean;
  readonly save: ToolkitsOperationButtonsSave;
  readonly projectId: string | undefined;
  readonly display?: ToolkitsOperationButtonsDisplay | undefined;
}
