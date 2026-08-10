import type { ChangeEvent, FocusEvent, ReactNode, SyntheticEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { Tag } from '@/entities/tag';
import { dedupeTagsByName, sortTagsByName, tagLabel } from '@/entities/tag';
import { useListTags } from '@/shared/api/generated/tags/tags';
import { unwrapList } from '@/shared/api/unwrap';
import { t } from '@/shared/i18n';
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, TAG_NAME_MAX_LENGTH } from '@/shared/lib/limits';
import { PROMPT_PAYLOAD_KEY } from '@/shared/lib/prompt-payload';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

import { useFieldFocus } from '../lib/useFieldFocus';

import { EntityIcon } from './EntityIcon';

/**
 * Old app's `NormalTagNameInputRegExp` (`common/constants.js:91`,
 * `/^[\w,\s]+$/g`, paired with `TagEditor.jsx:27`'s help text "Only
 * alphanumeric characters, white space, comma and underscore allowed")
 * collapsed into one "is this a legal tag name" check for the freeSolo-create
 * path — the character class keeps the baseline's comma allowance.
 */
function isValidTagName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= TAG_NAME_MAX_LENGTH && /^[\w,\s]+$/.test(trimmed);
}

interface AgentTagEditorProps {
  projectId: string | undefined;
  value: readonly Tag[];
  onChange: (tags: readonly Tag[]) => void;
}

/**
 * Local, scoped-down replacement for the baseline's
 * `pages/Common/Components/TagEditor.jsx`, which wraps
 * `@/ComponentsLib/AutoCompleteDropDown` — a generic multi-select-with-
 * freeform-create component that has no port anywhere in `shared/ui` yet
 * (not part of S1's 67, not in this sub-unit's owned files). Rebuilt on
 * MUI's own `Autocomplete` (`multiple`, `freeSolo`) instead: same core
 * interaction (pick an existing tag or type a new one), without the
 * baseline's per-character colour-coding and duplicate-name inline warning
 * chrome.
 */
function AgentTagEditor({ projectId, value, onChange }: AgentTagEditorProps): ReactNode {
  const tagsQuery = useListTags(projectId ?? '', { query: { enabled: projectId !== undefined } });
  const availableTags = useMemo<Tag[]>(() => {
    // Unwrapped through the one helper (R-A6, #132) rather than a per-call-site
    // cast: this endpoint answers `{rows,total}` today, but the cast made that
    // assumption invisible and an unrecognised shape silently empty.
    return sortTagsByName(unwrapList<Tag>(tagsQuery.data, 'listTags'));
  }, [tagsQuery.data]);

  const handleChange = useCallback(
    (_event: SyntheticEvent, newValue: readonly (Tag | string)[]) => {
      const resolved = newValue.map((entry): Tag | undefined => {
        if (typeof entry !== 'string') return entry;
        if (!isValidTagName(entry)) return undefined;
        const existing = availableTags.find((tag) => tag.name === entry.trim());
        return existing ?? { id: -Date.now(), name: entry.trim(), data: null };
      });
      onChange(dedupeTagsByName(resolved.filter((tag): tag is Tag => tag !== undefined)));
    },
    [availableTags, onChange],
  );

  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      options={availableTags}
      value={value as Tag[]}
      onChange={handleChange}
      getOptionLabel={(option) => (typeof option === 'string' ? option : tagLabel(option))}
      isOptionEqualToValue={(option, selected) =>
        typeof option === 'string' || typeof selected === 'string' ? option === selected : option.id === selected.id
      }
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          label={t('agents.applicationEditForm.tagsLabel', 'Tags')}
        />
      )}
    />
  );
}

/** @public */
export interface ApplicationEditFormProps {
  name: string;
  onNameChange: (value: string) => void;
  nameError?: string | undefined;
  description: string;
  onDescriptionChange: (value: string) => void;
  descriptionError?: string | undefined;
  tags: readonly Tag[];
  onTagsChange: (tags: readonly Tag[]) => void;
  projectId: string | undefined;
  /**
   * Baseline: `isFromPipeline = useIsFromPipelineDetail()` (route-matching),
   * driving `entityType={isFromPipeline ? 'pipeline' : 'application'}`. This
   * component is dual-used by both agent and pipeline editing in the
   * baseline, so the icon must reflect which entity is actually being
   * edited. An explicit prop, not a route hook — same "caller already has
   * route context" convention `DeleteApplicationButton.tsx`'s
   * `applicationId` prop documents, and the same reason this component
   * already takes every other value as an explicit prop instead of an
   * ambient read.
   */
  isFromPipeline?: boolean;
  style?: SxProps<Theme>;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Components/
 * Applications/ApplicationEditForm.jsx`.
 *
 * DISCLOSED DEVIATIONS:
 *  - No ambient form context. Every field is an explicit `value`/`onChange`
 *    pair instead of `useFormikContext()` reads — this app has no Formik
 *    dependency (`../model/types.ts`'s module doc comment: "this app uses
 *    react-hook-form, not formik"). Individual typed props, not one big
 *    `values`/`onFieldChange` pair, matching the sibling
 *    `ApplicationAdvanceSettings.tsx`'s own convention for a small, fixed
 *    field set (its module doc comment: "`stepLimit`/`onStepLimitChange`
 *    are explicit props instead of `useFormikContext()` reads").
 *  - Icon: renders the real, already-landed `EntityIcon` (`./EntityIcon.tsx`,
 *    a sibling A1 sub-unit's scoped port of the baseline's
 *    `components/EntityIcon.jsx`) with no `icon` — i.e. its per-entity-type
 *    fallback glyph. That component's own doc comment already discloses the
 *    reason there is no EDITABLE icon-picker mode anywhere in this app yet
 *    (`SelectIconDialog` has no port, "a future unit that needs an EDITABLE
 *    entity icon should build that mode fresh") — this port inherits that
 *    same, already-established gap rather than re-disclosing a new one.
 *    `entityType` DOES restore the baseline's `isFromPipeline ? 'pipeline' :
 *    'application'` conditional (`ApplicationEditForm.jsx:97-100`), driven by
 *    the `isFromPipeline` prop above — `'application'` maps to this app's
 *    `EntityIcon`'s `'agent'` (its type only ever accepts `'agent' |
 *    'pipeline' | 'toolkit'`, verified directly against that file).
 *  - `shared/ui`'s `StyledInputEnhancer` (this app's version) takes
 *    `InputBaseProps`-shaped props (`expand`/`actions` option objects, not
 *    raw `multiline`/`maxRows`/`hasActionsToolBar` booleans — see that
 *    component's own doc comment for why) — the Description field is
 *    adapted to that shape; behaviour (expand to a full-screen editor,
 *    hover toolbar) is equivalent, not identical pixel-for-pixel.
 *  - Tags: see `AgentTagEditor` above.
 *  - `useTagListQuery`/`useSelectedProjectId` (baseline, Redux-backed)
 *    replaced with the generated `useListTags` + an explicit `projectId`
 *    prop (the caller already resolves it via this slice's own
 *    `useSelectedProjectId`, `../api/useSelectedProjectId.ts`).
 *  - Wraps its content in `BasicAccordion` (`showMode="left"`, title
 *    `'General'`) — matching the baseline's own `<BasicAccordion ...
 *    items={[{ title: 'General', ... }]} />` (`ApplicationEditForm.jsx:86-178`)
 *    and the same convention every sibling panel in this sub-unit already
 *    follows (`ApplicationAdvanceSettings.tsx`/`ApplicationEditorNotes.tsx`/
 *    `ApplicationTools.tsx`/`ApplicationVariables.tsx`). `style` now targets
 *    the accordion's root slot (`slotSx.root`) instead of the outer content
 *    box, mirroring those same siblings' `sx`-to-`slotSx.root` wiring.
 */
export function ApplicationEditForm({
  name,
  onNameChange,
  nameError,
  description,
  onDescriptionChange,
  descriptionError,
  tags,
  onTagsChange,
  projectId,
  isFromPipeline = false,
  style,
}: ApplicationEditFormProps): ReactNode {
  const [localName, setLocalName] = useState(name);
  const { toggleFieldFocus, isFocused } = useFieldFocus();

  // Sync local state when the caller's value changes externally (e.g. on form reset/discard).
  useEffect(() => {
    setLocalName(name);
  }, [name]);

  const onChangeName = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setLocalName(event.target.value);
  }, []);

  const onNameBlur = useCallback(() => {
    const trimmedName = localName.trim();
    setLocalName(trimmedName);
    onNameChange(trimmedName);
    toggleFieldFocus(null);
  }, [localName, onNameChange, toggleFieldFocus]);

  const onChangeDescription = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onDescriptionChange(event.target.value);
    },
    [onDescriptionChange],
  );

  const handleDescriptionBlur = useCallback(
    (_event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      toggleFieldFocus(null);
    },
    [toggleFieldFocus],
  );

  return (
    <BasicAccordion
      showMode="left"
      slotSx={{ accordion: accordionSx, ...(style !== undefined ? { root: style } : {}) }}
      items={[
        {
          title: t('agents.applicationEditForm.generalTitle', 'General'),
          content: (
            <Box>
              <Box sx={nameContainerSx}>
                <EntityIcon
                  entityType={isFromPipeline ? 'pipeline' : 'agent'}
                  sx={iconWrapperSx}
                />
                <Box sx={nameWrapperSx}>
                  <StyledInputEnhancer
                    autoComplete="off"
                    id="name"
                    name="name"
                    label={t('agents.applicationEditForm.nameLabel', 'Name')}
                    error={nameError !== undefined}
                    helperText={nameError}
                    onChange={onChangeName}
                    onBlur={onNameBlur}
                    onFocus={() => toggleFieldFocus(PROMPT_PAYLOAD_KEY.name)}
                    value={localName}
                    required
                    slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH, 'data-testid': 'agent-name-input' } }}
                  />
                  {isFocused(PROMPT_PAYLOAD_KEY.name) && localName.length === MAX_NAME_LENGTH && (
                    <Typography
                      variant="labelTiny"
                      sx={nameCharactersLabelSx}
                    >
                      {t('agents.applicationEditForm.charactersLeftZero', ' 0 characters left')}
                    </Typography>
                  )}
                </Box>
              </Box>

              <Box sx={descriptionWrapperSx}>
                <StyledInputEnhancer
                  autoComplete="off"
                  label={t('agents.applicationEditForm.descriptionLabel', 'Description')}
                  id="description"
                  name="description"
                  required
                  expand={{ maxRows: 15 }}
                  actions={{ enabled: true }}
                  onChange={onChangeDescription}
                  onBlur={handleDescriptionBlur}
                  onFocus={() => toggleFieldFocus(PROMPT_PAYLOAD_KEY.description)}
                  value={description}
                  error={descriptionError !== undefined}
                  helperText={descriptionError}
                  slotProps={{ htmlInput: { maxLength: MAX_DESCRIPTION_LENGTH, 'data-testid': 'agent-description-input' } }}
                />
                {isFocused(PROMPT_PAYLOAD_KEY.description) && description.length > 0 && (
                  <Typography
                    variant="labelTiny"
                    sx={descriptionCharactersLabelSx}
                  >
                    {t('agents.applicationEditForm.charactersLeft', '{{count}} characters left', {
                      count: MAX_DESCRIPTION_LENGTH - description.length,
                    })}
                  </Typography>
                )}
              </Box>

              <AgentTagEditor
                projectId={projectId}
                value={tags}
                onChange={onTagsChange}
              />
            </Box>
          ),
        },
      ]}
    />
  );
}

const accordionSx: SxProps<Theme> = (theme: Theme) => ({
  background: theme.vars.palette.background.tabPanel,
});

const nameContainerSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  height: '4.25rem',
  width: '100%',
  gap: '1rem',
};

const iconWrapperSx: SxProps<Theme> = {
  width: '2.25rem',
  height: '2.25rem',
};

const nameWrapperSx: SxProps<Theme> = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

const nameCharactersLabelSx: SxProps<Theme> = {
  textAlign: 'right',
  width: '100%',
  position: 'absolute',
  bottom: '3.5rem',
};

const descriptionWrapperSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

const descriptionCharactersLabelSx: SxProps<Theme> = {
  textAlign: 'right',
  width: '100%',
  position: 'relative',
  top: '0.5rem',
};
