import type { ReactNode } from 'react';

import { isCreateConfigurationMode, isManualOrCreateConfigurationMode } from '../model/toolConfigurationMode';

/**
 * `ToolConfigurationForm` — ported from
 * `apps/elitea-ui/src/pages/Applications/Components/Tools/
 * ToolConfigurationForm.jsx` (Wave-2 promotion pass, Part 2's second file).
 *
 * DISCLOSED REDESIGN: the baseline directly renders `ConfigurationSelect`
 * (a legacy `components/` widget with no port anywhere in this app yet) or
 * `CredentialsSelect` (`features/credentials/ui` — a `features/` slice
 * `entities/` may not import, `no-upward-from-entities`) depending on
 * `configurationViewOptions`, and reads `useConfigurations`/
 * `useGetCurrentConfigurationAsSchemas` (both RTK-Query, features-layer)
 * internally for the picker's data. None of that fetching/rendering can
 * live here. What this component keeps from the baseline is exactly the
 * VISIBILITY logic — when to show the picker slot, the "Configuration
 * Name" input slot, and the manual-fields `children` — as pure prop-driven
 * decisions; the caller renders whichever concrete picker/name-input
 * widget it wants into the slots. The mode-comparison logic itself
 * (`Manual_Title`/`Create_Personal_Title`/`Create_Project_Title`) is
 * `../model/toolConfigurationMode.ts`, this promotion pass's other Part 2
 * file's sibling extraction.
 */
export interface ToolConfigurationFormProps {
  /** The toolkit/tool type key being configured — `undefined` hides everything. */
  readonly configurationType: string | undefined;
  /** The current `configuration.configuration_title` mode value (a `ConfigurationMode` member, or a real saved configuration's title). */
  readonly configurationMode: string | undefined;
  readonly showOnlyConfigurationFields?: boolean;
  readonly hideConfigurationNameInput?: boolean;
  /** Gate for the manual-fields `children` — the baseline's `showConfigurableFields` local state (driven by `CredentialsSelect`'s own callback, hence caller-owned here). */
  readonly showConfigurableFields?: boolean;
  /** Caller-rendered `ConfigurationSelect` or `CredentialsSelect`, per its own `CONFIGURATION_VIEW_OPTIONS` choice. */
  readonly configurationPicker?: ReactNode;
  /** Caller-rendered "Configuration Name" input, shown only in a Create_* mode. */
  readonly configurationNameField?: ReactNode;
  /** The manual settings fields. */
  readonly children?: ReactNode;
}

export function ToolConfigurationForm({
  configurationType,
  configurationMode,
  showOnlyConfigurationFields = false,
  hideConfigurationNameInput = false,
  showConfigurableFields = true,
  configurationPicker,
  configurationNameField,
  children,
}: ToolConfigurationFormProps): ReactNode {
  const showManualFields = showConfigurableFields && isManualOrCreateConfigurationMode(configurationMode);

  return (
    <>
      {configurationType !== undefined && (
        <>
          {!showOnlyConfigurationFields && configurationPicker}
          {!hideConfigurationNameInput && isCreateConfigurationMode(configurationMode) && configurationNameField}
        </>
      )}
      {showManualFields && children}
    </>
  );
}
