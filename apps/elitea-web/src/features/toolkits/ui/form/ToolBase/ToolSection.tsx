import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { RadioButtonGroup } from '@/shared/ui/RadioButtonGroup';

import {
  capitalizeFirstChar,
  collectUnselectedFields,
  compareSectionProps,
  computeSectionRequiredErrors,
  resolveDefaultSubsection,
  resolveFieldsToShowWhenDisabled,
  resolveSectionEntries,
  resolveSectionFieldRequired,
  resolveSectionVisibility,
  snapshotSubsectionValues,
} from './ToolSection.helpers';
import type { SectionPropEntries } from './ToolSection.helpers';
import type { ToolSectionSubsection, ToolSectionVisibility } from './ToolSection.types';
import { ToolBaseProperty } from './ToolBaseProperty';
import type { ToolBasePropertyCredentialContext, ToolBasePropertyFormState, ToolBasePropertyProps, ToolBasePropertySlots } from './ToolBaseProperty';
import type { EditToolField, SetEditToolDetail, ToolPropertySchema } from './types';

// `ToolSectionVisibility` REMOVED from this re-export: `ToolBase.types.ts`/
// `ToolBase.options.ts` (the real cross-file consumers of `ToolSectionSubsection`)
// import that one through this barrel, but nothing imports `ToolSectionVisibility`
// through it — `ToolSection.helpers.ts` (its only real consumer) already
// imports it straight from `./ToolSection.types`.
export type { ToolSectionSubsection } from './ToolSection.types';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolBase/ToolSection.jsx` (344 lines) — a metadata "section" (e.g. `auth`)
 * with multiple mutually-exclusive `subsections` (e.g. OAuth vs. API-key
 * auth), rendered as a radio switcher plus that subsection's own fields.
 * Split into this file (state + effects + 2 render helpers,
 * `DisabledAuthSection`/`SectionFieldList`) plus `ToolSection.helpers.ts`
 * (pure, non-JSX helpers) to stay under the §3.5 400-line/12-complexity
 * budgets — a file-organization change only, no behaviour change.
 *
 * Faithful port; the one real behaviour change is the same
 * `no-Formik`/§3.5 prop-grouping this whole unit applies everywhere —
 * `formState`/`credentialContext`/`slots` are grouped exactly as
 * `ToolBaseProperty.tsx` declares them, passed straight through.
 */
interface ToolSectionSchema {
  readonly properties?: Readonly<Record<string, ToolPropertySchema | undefined>>;
}

/** §3.5 12-prop-budget grouping: this section's own identity (which subsections, whether the section as a whole is required). */
interface ToolSectionIdentity {
  readonly sectionKey: string;
  readonly subsections: readonly ToolSectionSubsection[];
  readonly required: boolean;
  readonly schema: ToolSectionSchema | undefined;
}

export interface ToolSectionProps {
  readonly identity: ToolSectionIdentity;
  readonly formState: ToolBasePropertyFormState;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly editField: EditToolField;
  readonly handleInputChange: (fieldPath: string) => (event: ChangeEvent<HTMLInputElement>) => void;
  readonly setEditToolDetail: SetEditToolDetail;
  readonly onNotSelectedFieldsChange?: ((fields: readonly string[]) => void) | undefined;
  readonly visibility?: ToolSectionVisibility | undefined;
  readonly disabled?: boolean | undefined;
  readonly credentialContext?: ToolBasePropertyCredentialContext | undefined;
  readonly slots?: ToolBasePropertySlots | undefined;
}

export function ToolSection({
  identity,
  formState,
  settings,
  editField,
  handleInputChange,
  setEditToolDetail,
  onNotSelectedFieldsChange,
  visibility,
  disabled,
  credentialContext,
  slots,
}: ToolSectionProps): ReactNode {
  const { sectionKey, subsections, required, schema } = identity;
  const { showOnlyConfigurationFields, disableConfigFields, checkboxAsteriskRequired } = resolveSectionVisibility(visibility);
  const properties = schema?.properties ?? {};

  const sectionOptions = useMemo(() => {
    const base = sectionKey === 'auth' && !required ? [{ label: 'Anonymous', value: 'none' }] : [];
    return [...base, ...subsections.map((subsection) => ({ label: subsection.name, value: subsection.name }))];
  }, [required, sectionKey, subsections]);

  const defaultOption = useMemo(
    () => resolveDefaultSubsection(subsections, settings)?.name,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the baseline: only recomputed when settings/subsections identity changes, matching ToolSection.jsx:57.
    [settings, subsections],
  );

  const firstOption = sectionOptions[0]?.value ?? '';
  const [selectedOption, setSelectedOption] = useState(defaultOption ?? firstOption);

  const fields = useMemo(() => subsections.find((subsection) => subsection.name === selectedOption)?.fields ?? [], [selectedOption, subsections]);
  const notSelectedFields = useMemo(
    () => subsections.filter((subsection) => subsection.name !== selectedOption).flatMap((subsection) => subsection.fields ?? []),
    [selectedOption, subsections],
  );

  useEffect(() => {
    onNotSelectedFieldsChange?.(notSelectedFields);
  }, [notSelectedFields, onNotSelectedFieldsChange]);

  useEffect(() => {
    if (sectionOptions.length > 0 && !sectionOptions.some((option) => option.value === selectedOption)) {
      setSelectedOption(sectionOptions[0]?.value ?? '');
    }
  }, [sectionOptions, selectedOption]);

  const sectionProps = useMemo(
    () => [...resolveSectionEntries(fields, properties, showOnlyConfigurationFields)].sort(compareSectionProps),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `properties` is derived from `schema` each render; mirrors the baseline's own `schema.properties` dependency.
    [fields, showOnlyConfigurationFields],
  );

  const sectionValuesCache = useRef<Record<string, Record<string, unknown>>>({});

  const onChangeOption = useCallback(
    (newOption: string) => {
      const snapshot = snapshotSubsectionValues(subsections, selectedOption, settings);
      if (Object.keys(snapshot).length > 0) {
        sectionValuesCache.current = {
          ...sectionValuesCache.current,
          [selectedOption]: { ...sectionValuesCache.current[selectedOption], ...snapshot },
        };
      }

      setSelectedOption(newOption);

      const unselectedSettings = collectUnselectedFields(subsections, newOption);
      const restoredSettings = sectionValuesCache.current[newOption] ?? {};

      setEditToolDetail((previous) => ({
        ...previous,
        settings: { ...previous.settings, ...unselectedSettings, ...restoredSettings },
      }));

      for (const field of Object.keys(unselectedSettings)) {
        editField(`settings.${field}`, null);
      }
      for (const [field, value] of Object.entries(restoredSettings)) {
        editField(`settings.${field}`, value as never);
      }
    },
    [editField, selectedOption, setEditToolDetail, settings, subsections],
  );

  useEffect(() => {
    if (!required) return;
    const requiredPropertiesError = computeSectionRequiredErrors(fields, properties, settings, notSelectedFields);
    formState.setToolErrors?.((previous) => ({ ...previous, ...requiredPropertiesError }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the baseline's own dependency array (ToolSection.jsx:216), intentionally omitting `properties`/`formState`.
  }, [settings, required, fields, notSelectedFields, selectedOption]);

  const buildPropertyProps = useCallback(
    (key: string, propertySchema: ToolPropertySchema, isRequired: boolean, disableThisField: boolean) => ({
      field: { key, schema: propertySchema, required: isRequired },
      formState,
      settings,
      editField,
      handleInputChange,
      visibility: { disableConfigFields: disableThisField },
      disabled: disabled && propertySchema.type !== 'configuration',
      credentialContext,
      slots,
    }),
    [formState, settings, editField, handleInputChange, disabled, credentialContext, slots],
  );

  if (disableConfigFields) {
    const fieldsToShow = resolveFieldsToShowWhenDisabled(sectionProps, settings);
    // The baseline returns null here for ANY section (not only `auth`) once
    // every config-marked field is unset AND there are no regular fields —
    // `ToolSection.jsx:233-235`, unconditional on `sectionKey`.
    if (fieldsToShow.length === 0) return null;
    if (sectionKey === 'auth') {
      return (
        <DisabledAuthSection
          sectionKey={sectionKey}
          fieldsToShow={fieldsToShow}
          buildPropertyProps={buildPropertyProps}
        />
      );
    }
  }

  return (
    <>
      <Box sx={headerSx}>
        <Typography
          component="div"
          variant="bodySmall"
        >
          {capitalizeFirstChar(sectionKey)}
        </Typography>
        <RadioButtonGroup
          value={selectedOption}
          items={sectionOptions}
          onChange={onChangeOption}
          wrapRow
        />
      </Box>
      <SectionFieldList
        sectionProps={sectionProps}
        required={required}
        showOnlyConfigurationFields={showOnlyConfigurationFields}
        checkboxAsteriskRequired={checkboxAsteriskRequired}
        disableConfigFields={disableConfigFields}
        buildPropertyProps={buildPropertyProps}
      />
    </>
  );
}

type BuildPropertyProps = (key: string, propertySchema: ToolPropertySchema, isRequired: boolean, disableThisField: boolean) => ToolBasePropertyProps;

interface DisabledAuthSectionProps {
  readonly sectionKey: string;
  readonly fieldsToShow: SectionPropEntries;
  readonly buildPropertyProps: BuildPropertyProps;
}

/** The `disableConfigFields && sectionKey === 'auth'` branch (`ToolSection.jsx:238-273`) — split out to keep `ToolSection` itself under the §3.5 complexity budget. */
function DisabledAuthSection({ sectionKey, fieldsToShow, buildPropertyProps }: DisabledAuthSectionProps): ReactNode {
  return (
    <>
      <Box sx={disabledAuthHeaderSx}>
        <Typography
          component="div"
          variant="bodySmall"
        >
          {capitalizeFirstChar(sectionKey)}
        </Typography>
      </Box>
      {fieldsToShow.map(([key, propertySchema]) => (
        <ToolBaseProperty
          key={key}
          {...buildPropertyProps(key, propertySchema, false, propertySchema.configuration === true)}
        />
      ))}
    </>
  );
}

interface SectionFieldListProps {
  readonly sectionProps: SectionPropEntries;
  readonly required: boolean;
  readonly showOnlyConfigurationFields: boolean;
  readonly checkboxAsteriskRequired: boolean;
  readonly disableConfigFields: boolean;
  readonly buildPropertyProps: BuildPropertyProps;
}

/** The normal (non-disabled) subsection field list (`ToolSection.jsx:293-317`) — split out to keep `ToolSection` itself under the §3.5 complexity budget. */
function SectionFieldList({ sectionProps, required, showOnlyConfigurationFields, checkboxAsteriskRequired, disableConfigFields, buildPropertyProps }: SectionFieldListProps): ReactNode {
  return sectionProps.map(([key, propertySchema]) => (
    <ToolBaseProperty
      key={key}
      {...buildPropertyProps(key, propertySchema, resolveSectionFieldRequired(propertySchema, required, showOnlyConfigurationFields, checkboxAsteriskRequired), disableConfigFields)}
    />
  ));
}

const disabledAuthHeaderSx = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'flex-start',
  paddingTop: '0.5rem',
  paddingLeft: '0.75rem',
  marginBottom: '1rem',
};

const headerSx = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'flex-start',
  paddingTop: '0.5rem',
  paddingLeft: '0.75rem',
  minHeight: '4rem',
};
