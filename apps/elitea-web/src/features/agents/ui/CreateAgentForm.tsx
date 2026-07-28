import type { ChangeEvent, FocusEvent, ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from '@/shared/lib/limits';
import { t } from '@/shared/i18n';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

import { useCreateAgentFormState } from '../model/useCreateAgentFormState';
import type { AgentDraftValues, AgentFieldChange } from '../model/types';

import { ApplicationAdvanceSettings } from './ApplicationAdvanceSettings';
import { ApplicationVariables } from './ApplicationVariables';
import { InstructionsInput } from './InstructionsInput';
import { WelcomeMessageInput } from './WelcomeMessageInput';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/form/CreateAgentForm.jsx`.
 *
 * DISCLOSED REDESIGN — no ambient form context (see `../model/types.ts`'s
 * module doc comment): `values`/`onFieldChange` replace every
 * `useFormikContext()` read/`setFieldValue` call. `onFieldChange` mirrors
 * Formik's own `setFieldValue(path, value)` signature exactly — see that
 * file's doc comment for why this is the ONE generic escape hatch instead
 * of one typed callback per field.
 *
 * Cross-sub-unit slots, all disclosed, all EXPECTED not to have landed yet
 * per this batch's own brief:
 *  - `generateAgentButtonSlot` — the baseline's `GenerateAgentButton`
 *    (`ui/generate-agent-modal/`, this batch's own A1d designation). Only
 *    `GenerateAgentReviewForm`/`SuggestionItem`/`ResourceSuggestions` of
 *    that cluster had landed in this worktree at the time this file was
 *    written — no `GenerateAgentButton` itself. Rendered only outside
 *    pipeline mode (`entityType !== 'pipeline'`), matching the baseline's
 *    own conditional.
 *  - `iconSlot` — the baseline's editable `EntityIcon`
 *    (`components/EntityIcon.jsx`, `editable={true}`, `onChangeIcon`,
 *    upload flow). Sibling A1h's own scoped `EntityIcon.tsx`
 *    (`../ui/EntityIcon.tsx`) explicitly does NOT cover this: its own doc
 *    comment states it is "for `ToolCard.jsx`'s ONE call site... which
 *    always passes `editable={false}`" and that the editable/upload mode
 *    "is a separate, large feature... no owner in this sub-unit's file
 *    list." A real gap, not a naming mismatch.
 *  - `tagsSlot` — the baseline's `TagEditor`
 *    (`pages/Common/Components/TagEditor.jsx`), consumed by three
 *    different domains (`CreateSkillForm`, this file, `ApplicationEditForm`)
 *    with no `shared/ui` port anywhere in this worktree
 *    (`find shared/ui -iname '*Tag*'` — only `HeadingChip`, a read-only
 *    display chip, no editable tag-input equivalent).
 *  - `conversationStartersSlot` — the baseline's `ConversationStarters`
 *    (`components/ConversationStarters.jsx`, 370 lines, consumed by 5 files
 *    across the agent/pipeline/chat domains). Only its pure helper half
 *    (`../lib/helpers/conversationStarters.helpers.ts`) had landed in this
 *    worktree; the UI component itself had not.
 *
 * Each slot keeps this file's LAYOUT position faithful to the baseline
 * (same accordion, same ordering) even where its CONTENT cannot be filled
 * yet — matching `entities/application-form/ui/ApplicationConfigurationLayout
 * .tsx`'s own established "take the panel as an injected slot" precedent for
 * exactly this kind of not-yet-buildable dependency.
 */
interface GeneralFieldsNameProps {
  readonly value: string;
  readonly atMax: boolean;
  readonly focused: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
}

interface GeneralFieldsDescriptionProps {
  readonly value: string;
  readonly focused: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onFocus: () => void;
  readonly onBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

interface GeneralFieldsProps {
  readonly name: GeneralFieldsNameProps;
  readonly description: GeneralFieldsDescriptionProps;
  readonly disabled: boolean;
  readonly iconSlot: ReactNode;
  readonly tagsSlot: ReactNode;
}

/**
 * Split out of `CreateAgentForm` purely to keep its own cyclomatic
 * complexity under the oxlint budget (12) — same reason
 * `StyledShowContextModal.tsx` splits `ModalHeader`/`ModalBody`. The `name`/
 * `description` props are grouped option objects, not 12 flat props — same
 * "group into one object" answer to the §3.5 12-prop budget `BasicAccordion`
 * `slotSx` and `InputBase` `actions`/`expand` already establish.
 */
function GeneralFields({ name, description, disabled, iconSlot, tagsSlot }: GeneralFieldsProps): ReactNode {
  return (
    <Box sx={accordionContentSx}>
      <Box sx={nameContainerSx}>
        {iconSlot}
        <Box sx={nameWrapperInputSx}>
          <StyledInputEnhancer
            autoComplete="off"
            id="name"
            name="name"
            label={t('features.agents.createAgentForm.nameLabel', 'Name')}
            disabled={disabled}
            onChange={name.onChange}
            onFocus={name.onFocus}
            onBlur={name.onBlur}
            value={name.value}
            required
            slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH, 'data-testid': 'agent-name-input' } }}
          />
          {name.focused && name.atMax && (
            <Typography
              variant="labelTiny"
              sx={nameCharactersLabelSx}
            >
              {t('features.agents.createAgentForm.nameCharactersLeft', ' 0 is left from {{max}} characters', { max: MAX_NAME_LENGTH })}
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={descriptionWrapperSx}>
        <StyledInputEnhancer
          autoComplete="off"
          id="description"
          label={t('features.agents.createAgentForm.descriptionLabel', 'Description')}
          required
          expand={{ minRows: 1, maxRows: 15 }}
          onChange={description.onChange}
          onFocus={description.onFocus}
          onBlur={description.onBlur}
          value={description.value}
          disabled={disabled}
          slotProps={{ htmlInput: { maxLength: MAX_DESCRIPTION_LENGTH, 'data-testid': 'agent-description-input' } }}
        />
        {description.focused && description.value.length > 0 && (
          <Typography
            variant="labelTiny"
            sx={descriptionCharactersLabelSx}
          >
            {t('features.agents.createAgentForm.descriptionCharactersLeft', '{{count}} characters left', {
              count: MAX_DESCRIPTION_LENGTH - description.value.length,
            })}
          </Typography>
        )}
      </Box>

      {tagsSlot}
    </Box>
  );
}

export interface CreateAgentFormProps {
  readonly values: AgentDraftValues;
  readonly onFieldChange: AgentFieldChange;
  readonly disabled?: boolean | undefined;
  readonly showInstructions?: boolean | undefined;
  readonly entityType?: 'application' | 'pipeline' | undefined;
  /**
   * Rendered as `BasicAccordion`'s `summaryAction` — that summary row is
   * ITSELF a native `<button>` (`StyledAccordionSummary` wraps MUI's
   * `ButtonBase`; see that component's own doc comment). This slot's
   * content must therefore not be (or contain) a literal `<button>` —
   * nested `<button>`s are invalid HTML and React warns on them at
   * runtime (confirmed by this file's own test suite). The real
   * `GenerateAgentButton` (A1d) must render as a non-button interactive
   * element (an MUI `Chip`, a `role="button"` `Box`, etc) when used here.
   */
  readonly generateAgentButtonSlot?: ReactNode | undefined;
  readonly iconSlot?: ReactNode | undefined;
  readonly tagsSlot?: ReactNode | undefined;
  readonly conversationStartersSlot?: ReactNode | undefined;
  readonly sx?: SxProps<Theme> | undefined;
}

export function CreateAgentForm({
  values,
  onFieldChange,
  disabled = false,
  showInstructions = true,
  entityType = 'application',
  generateAgentButtonSlot,
  iconSlot,
  tagsSlot,
  conversationStartersSlot,
  sx,
}: CreateAgentFormProps): ReactNode {
  const versionDetails = values.version_details;
  const state = useCreateAgentFormState(values, onFieldChange);

  return (
    <Box sx={combineSx(rootContainerSx, sx)}>
      <BasicAccordion
        showMode="left"
        slotSx={{ accordion: accordionSx }}
        items={[
          {
            title: t('features.agents.createAgentForm.generalTitle', 'General'),
            summaryAction: entityType !== 'pipeline' ? generateAgentButtonSlot : undefined,
            content: (
              <GeneralFields
                name={{
                  value: state.name,
                  atMax: state.nameAtMax,
                  focused: state.nameFocused,
                  onChange: state.onChangeName,
                  onFocus: state.onNameFocus,
                  onBlur: state.onNameBlur,
                }}
                description={{
                  value: state.description,
                  focused: state.descriptionFocused,
                  onChange: state.onDescriptionChange,
                  onFocus: state.onDescriptionFocus,
                  onBlur: state.onDescriptionBlur,
                }}
                disabled={disabled}
                iconSlot={iconSlot}
                tagsSlot={tagsSlot}
              />
            ),
          },
        ]}
      />
      {showInstructions && (
        <Box sx={instructionsContainerSx}>
          <InstructionsInput
            instructions={versionDetails?.instructions}
            onInstructionsChange={state.onInstructionsChange}
            disabled={disabled}
          />
        </Box>
      )}
      <ApplicationVariables
        variables={state.variables}
        onChangeVariable={state.onChangeVariable}
      />
      <Box sx={welcomeMessageInputSx}>
        <WelcomeMessageInput
          welcomeMessage={versionDetails?.welcome_message}
          onWelcomeMessageChange={state.onWelcomeMessageChange}
          versionId={versionDetails?.id}
          disabled={disabled}
        />
      </Box>
      <Box sx={conversationStartersSx}>{conversationStartersSlot}</Box>
      <Box sx={advanceSettingsSx}>
        <ApplicationAdvanceSettings
          stepLimit={versionDetails?.meta?.step_limit}
          onStepLimitChange={state.onStepLimitChange}
        />
      </Box>
    </Box>
  );
}

const rootContainerSx: SxProps<Theme> = {
  margin: '0.75rem auto 0',
  maxWidth: '40.1875rem',
};

const accordionSx: SxProps<Theme> = (theme: Theme) => ({
  background: theme.vars.palette.background.tabPanel,
});

const accordionContentSx: SxProps<Theme> = {
  paddingBottom: '1.5rem',
};

const nameContainerSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  height: '4.25rem',
  width: '100%',
  gap: '1rem',
};

const nameWrapperInputSx: SxProps<Theme> = {
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

const instructionsContainerSx: SxProps<Theme> = {
  paddingBottom: '1rem',
  marginTop: '1rem',
};

const welcomeMessageInputSx: SxProps<Theme> = {
  marginTop: '1rem',
};

const conversationStartersSx: SxProps<Theme> = {
  marginTop: '1rem',
};

const advanceSettingsSx: SxProps<Theme> = {
  marginTop: '1rem',
};
