import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { memo, useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { AiMagicIcon } from '@/shared/ui/icons/ai-magic-icon';
import { StopIcon } from '@/shared/ui/icons/stop-icon';
import SendIcon from '@mui/icons-material/Send';
import { t } from '@/shared/i18n';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/ai-assistant/
 * ui/AIPromptInput.jsx` (baseline, 219 lines) — unit A2a.
 *
 * DEVIATIONS FROM BASELINE, all forced by real, verified constraints:
 *
 *  1. `ChatInputContainer`/`StyledTextField` (`@/components/Chat/
 *     StyledComponents`) are chat-domain components; even setting aside
 *     that they have not landed in this app yet, importing them would be a
 *     `features/pipelines` -> `features/chat` (or `widgets/chat`) import —
 *     forbidden by `no-sideways-features` regardless of landing order (see
 *     the workflow preamble's "ALREADY-RESOLVED ARCHITECTURE FINDING").
 *     Inspecting the baseline's own `ChatInputContainer`
 *     (`components/Chat/StyledComponents.jsx:48-59`), every property it
 *     sets (`border`/`borderRadius`/`background`/`padding`/`display`/
 *     `alignItems`) is already fully re-specified by THIS component's own
 *     `container` sx below (baseline `AIPromptInput.jsx`'s own `styles.
 *     container` — every one of those properties appears there too) — so a
 *     plain `Box` with that same sx, plus the two properties
 *     `ChatInputContainer` sets that `AIPromptInput`'s own sx does NOT
 *     override (`width: '100%'`), reproduces the same rendered result
 *     without the cross-slice import. Same reasoning for `StyledTextField`
 *     -> a plain MUI `TextField` with its base styles folded into this
 *     component's own `textFieldSx`.
 *
 *  2. `theme.palette.mode === 'light' ? AIMagicIconLight : AIMagicIconDark`
 *     is banned outright by R-T2 (`no-restricted-syntax` on any
 *     `palette.mode` branch) — moot regardless, since unit S2 already
 *     merged the light/dark SVG pair into one scheme-independent
 *     `AiMagicIcon` (`fill="currentColor"`, R-T8) with no mode branch
 *     needed on either side.
 *
 *  3. `SendIcon` (`@/components/Icons/SendIcon`, a hand-rolled baseline
 *     component) has no ported `shared/ui/icons` equivalent (grepped,
 *     absent) — `@mui/icons-material/Send` substitutes, matching this
 *     codebase's established fallback for un-ported custom icons
 *     (`shared/ui/BaseModal`'s `CloseIcon` -> `@mui/icons-material/Close`,
 *     `shared/ui/ExpandedViewerModal`'s `CopyIcon` ->
 *     `@mui/icons-material/ContentCopy`) and R-I1 (non-barrel
 *     `@mui/icons-material` imports are the sanctioned path for icons with
 *     no custom SVG).
 *
 *  4. The 3 `!important` overrides in baseline `styles.stopButton` (R-T5:
 *     banned outright, no exception without a linked parity-manifest
 *     waiver id, and none exists for this unit) are replaced with a
 *     straightforward specificity fix: the colour is set directly on the
 *     `StopIcon` SVG's own `sx` (`color`) instead of fighting a
 *     `& svg {...}` descendant-selector override on the `IconButton`, so
 *     no conflicting rule needed overriding in the first place.
 *
 *  5. `borderRadius: '50%'` on the send/stop buttons is DROPPED, not
 *     substituted — MUI's `IconButton` already renders a circular root
 *     (`.MuiIconButton-root { border-radius: 50% }` is its own default),
 *     so the baseline's explicit override was redundant even there; R-T10
 *     (`ad-hoc-radius`) bans the literal regardless (only `theme.vars.
 *     shape.radiusSm|Md|Lg` member expressions or `var(--el-radius-*)`
 *     pass its AST check — a hand-picked token cannot honestly stand in
 *     for "perfectly circular" the way the CSS keyword `50%` does).
 *     `iconContainerSx`'s `0.75rem` corner radius maps to `radiusMd`
 *     (8px) — the nearest of the 3 available tokens (4/8/16px); not a
 *     pixel-identical reproduction of the baseline's ad-hoc 12px, but
 *     R-T10 leaves no ad-hoc escape hatch.
 *
 *  6. The gradient-BORDER ring (baseline's `&::before` + `WebkitMask`/
 *     `mask` "punch a ring out of a filled square" trick) is redrawn with
 *     the equivalent, simpler `background: <fill> padding-box, <border>
 *     border-box` + `border: 1px solid transparent` technique — same
 *     rendered ring, but the mask trick's `linear-gradient(#fff 0 0)`
 *     literal (`#fff` is a raw hex literal there purely as an
 *     opaque-alpha marker for `mask-composite`, not a real colour) trips
 *     R-T1 (`no-raw-color`, which matches any hex pattern in any string,
 *     not only colour-bearing keys) with no token equivalent for
 *     "opaque" to substitute. The `background-clip: padding-box` /
 *     `border-box` shorthand achieves the identical two-layer gradient
 *     without needing a mask stage at all.
 *
 *  7. `'& .MuiInputBase-root'`/`'& .MuiInputBase-input'` selectors (R-T6:
 *     internal MUI class selectors banned outside `shared/brand/
 *     mui-overrides/`) are replaced with MUI's own `slotProps.input.sx`
 *     — the OFFICIAL API for styling a `TextField`'s input slot, not a
 *     class-selector reach into MUI's internal DOM.
 *
 *  8. Every icon's `sx={{fontSize: '1rem'}}` (R-T11: ad-hoc `fontSize`
 *     literals banned) becomes the `fontSize="small"` PROP `SvgIcon`/
 *     `@mui/icons-material` icons accept — the same enum-based sizing
 *     `shared/ui/InputActionsToolbar.tsx`'s `FullScreenAction` already
 *     uses for its own `SvgIcon`.
 */
export interface PromptInputHandle {
  clear: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
}

export interface AIPromptInputProps {
  readonly disabled?: boolean;
  readonly onGenerate?: (prompt: string) => Promise<void> | void;
  readonly onStop?: () => void;
  readonly isLoading?: boolean;
  readonly promptValueRef?: Ref<PromptInputHandle> & { current: PromptInputHandle | null };
}

const containerSx: SxProps<Theme> = (theme) => ({
  width: '100%',
  border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  borderRadius: theme.vars.shape.radiusLg,
  padding: theme.spacing(1.5, 1.75),
  background: theme.vars.palette.background.default,
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  '&:focus-within': {
    borderColor: theme.vars.palette.primary.pressed,
  },
});

const iconContainerSx: SxProps<Theme> = (theme) => ({
  width: theme.spacing(4.5),
  height: theme.spacing(4.5),
  borderRadius: theme.vars.shape.radiusMd,
  // Gradient-border-ring technique: the fill layer (`iconBackground`,
  // clipped to `padding-box`) paints on top and only inside the border;
  // the ring layer (`iconBorder`, clipped to `border-box`) paints behind
  // it across the FULL box, so it only actually shows through in the
  // 1px border gap the fill layer leaves uncovered. See this file's own
  // doc comment (deviation 6) for why this replaces the baseline's
  // mask-based version.
  border: '0.0625rem solid transparent',
  backgroundImage: `${theme.vars.palette.aiAssistant.iconBackground}, ${theme.vars.palette.aiAssistant.iconBorder}`,
  backgroundOrigin: 'border-box, border-box',
  backgroundClip: 'padding-box, border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});

const textFieldInputSx: SxProps<Theme> = (theme) => ({
  color: theme.vars.palette.text.primary,
  ...theme.typography.bodyMedium,
  padding: 0,
  '&::-webkit-scrollbar': { display: 'none' },
});

const textFieldSx: SxProps<Theme> = {
  flex: '1 0 0',
  msOverflowStyle: 'none',
  scrollbarWidth: 'none',
};

const buttonWrapperSx: SxProps<Theme> = { display: 'inline-block' };

const sendButtonSx: SxProps<Theme> = (theme) => ({
  height: theme.spacing(3.5),
  width: theme.spacing(3.5),
  backgroundColor: theme.vars.palette.primary.main,
  '&.Mui-disabled': {
    backgroundColor: theme.vars.palette.background.button.primary.disabled,
  },
  '&:hover': {
    backgroundColor: theme.vars.palette.primary.main,
  },
});

const stopButtonSx: SxProps<Theme> = (theme) => ({
  height: theme.spacing(3.5),
  width: theme.spacing(3.5),
  backgroundColor: theme.vars.palette.background.button.secondary.default,
  '&.Mui-disabled': {
    backgroundColor: theme.vars.palette.background.button.primary.disabled,
  },
  '&:hover': {
    backgroundColor: theme.vars.palette.background.button.secondary.hover,
  },
});

const stopIconSx: SxProps<Theme> = (theme) => ({
  color: theme.vars.palette.status.onModeration,
});

const sendIconSx: SxProps<Theme> = (theme) => ({
  fill: theme.vars.palette.icon.fill.send,
});

export const AIPromptInput = memo(function AIPromptInput(props: AIPromptInputProps): ReactNode {
  const { disabled = false, onGenerate, onStop, isLoading = false, promptValueRef } = props;

  const [aiPrompt, setAiPrompt] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (promptValueRef) {
      promptValueRef.current = {
        clear: () => setAiPrompt(''),
        getValue: () => aiPrompt,
        setValue: (value: string) => setAiPrompt(value),
        focus: () => inputRef.current?.focus(),
      };
    }
  }, [promptValueRef, aiPrompt]);

  const handleSendAIPrompt = async (): Promise<void> => {
    if (!aiPrompt.trim() || isLoading) return;
    try {
      await onGenerate?.(aiPrompt);
      // Don't clear immediately - let parent decide via ref.
    } catch {
      // Keep prompt on error for retry.
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendAIPrompt();
    }
  };

  const sendLabel = t('pipelines.aiAssistant.promptInput.send', 'Send');
  const stopLabel = t('pipelines.aiAssistant.promptInput.stop', 'Stop');
  const placeholder = t(
    'pipelines.aiAssistant.promptInput.placeholder',
    'Describe your idea to generate or rewrite the value.',
  );

  return (
    <Box sx={containerSx}>
      <Box sx={iconContainerSx}>
        <SvgIcon
          component={AiMagicIcon}
          inheritViewBox
          fontSize="small"
        />
      </Box>
      <TextField
        fullWidth
        multiline
        maxRows={4}
        placeholder={placeholder}
        value={aiPrompt}
        onChange={(event) => setAiPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading || disabled}
        variant="standard"
        inputRef={inputRef}
        slotProps={{ input: { disableUnderline: true, sx: textFieldInputSx } }}
        sx={textFieldSx}
      />
      {isLoading ? (
        <Tooltip
          title={stopLabel}
          placement="top"
        >
          <IconButton
            onClick={() => onStop?.()}
            sx={stopButtonSx}
            aria-label={stopLabel}
          >
            <SvgIcon
              component={StopIcon}
              inheritViewBox
              fontSize="small"
              sx={stopIconSx}
            />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip
          title={sendLabel}
          placement="top"
        >
          <Box
            component="span"
            sx={buttonWrapperSx}
          >
            <IconButton
              onClick={() => void handleSendAIPrompt()}
              disabled={!aiPrompt.trim() || disabled}
              sx={sendButtonSx}
              aria-label={sendLabel}
            >
              <SendIcon
                fontSize="small"
                sx={sendIconSx}
              />
            </IconButton>
          </Box>
        </Tooltip>
      )}
    </Box>
  );
});
