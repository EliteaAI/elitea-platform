import { describe, expect, it } from 'vitest';

import type { SxProps, Theme } from '@mui/material/styles';
import { stepConnectorClasses } from '@mui/material/StepConnector';

import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';

import {
  dialogPaperSx,
  processConnectorSx,
  processStepIconInnerSx,
  processStepIconOuterSx,
  runStatusContainerSx,
  runStatusTextSx,
} from './RunStateDialog.styles';

const theme: Theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

/** Every `*Sx` export in `./RunStateDialog.styles.ts` is implemented as a `(theme: Theme) => {...}` function — `SxProps<Theme>`'s declared type is a wider union (object/array/boolean variants too) for API flexibility, so the function form is asserted here rather than narrowed structurally. */
function resolve(sxValue: SxProps<Theme>): Record<string, unknown> {
  return (sxValue as (resolvedTheme: Theme) => Record<string, unknown>)(theme);
}

describe('RunStateDialog.styles', () => {
  it('processConnectorSx colours the line published when not an error, rejected when an error', () => {
    const published = resolve(processConnectorSx(false));
    const rejected = resolve(processConnectorSx(true));
    expect(JSON.stringify(published)).not.toBe(JSON.stringify(rejected));
  });

  it('processConnectorSx toggles display based on visible', () => {
    const hidden = resolve(processConnectorSx(false, false));
    const shown = resolve(processConnectorSx(false, true));
    expect(hidden['display']).toBe('none');
    expect(shown['display']).toBeUndefined();
  });

  // The `Stepper` `connector` prop's real per-step connectors are always
  // nested one level *inside* their following `Step` (per `@mui/material/
  // Step`'s own render: `[hasConnector ? connector : null, children]`),
  // never their own parent's last child — only this component's own
  // trailing `timeline.length < 2` placeholder instance (appended as a
  // direct extra `Stepper` child after every real `Step`) is ever
  // `:last-child`. That selector is this file's only lever for giving the
  // placeholder baseline's neutral gray line without a status-colour
  // dependency, in a shared `sx` function whose two call sites (real vs.
  // placeholder) are otherwise indistinguishable from `isError`/`visible`
  // alone.
  it('processConnectorSx gives the &:last-child (trailing placeholder) line a neutral colour, independent of isError', () => {
    const lineKey = `& .${stepConnectorClasses.line}`;

    const publishedLine = resolve(processConnectorSx(false, true))[lineKey] as Record<string, unknown>;
    const rejectedLine = resolve(processConnectorSx(true, true))[lineKey] as Record<string, unknown>;
    // Sanity check: the real (non-last-child) line IS isError-coloured.
    expect(publishedLine['borderColor']).not.toBe(rejectedLine['borderColor']);

    const publishedLastChild = resolve(processConnectorSx(false, true))['&:last-child'] as Record<
      string,
      Record<string, unknown>
    >;
    const rejectedLastChild = resolve(processConnectorSx(true, true))['&:last-child'] as Record<
      string,
      Record<string, unknown>
    >;
    const publishedPlaceholderColor = publishedLastChild[lineKey]?.['borderColor'];
    const rejectedPlaceholderColor = rejectedLastChild[lineKey]?.['borderColor'];

    // The placeholder's colour does not depend on isError...
    expect(publishedPlaceholderColor).toBe(rejectedPlaceholderColor);
    // ...and is not the same colour as the real, status-coloured line.
    expect(publishedPlaceholderColor).not.toBe(publishedLine['borderColor']);
    expect(rejectedPlaceholderColor).not.toBe(rejectedLine['borderColor']);
  });

  it('runStatusContainerSx/runStatusTextSx pick a border/text colour per status', () => {
    const completed = resolve(runStatusContainerSx('Completed'));
    const errored = resolve(runStatusContainerSx('Error'));
    expect(completed['border']).not.toBe(errored['border']);

    const completedText = resolve(runStatusTextSx('Completed'));
    const errorText = resolve(runStatusTextSx('Error'));
    expect(completedText['color']).not.toBe(errorText['color']);
  });

  it('processStepIconOuterSx/InnerSx react to the active/isError flags', () => {
    const activeOuter = resolve(processStepIconOuterSx(true, false));
    const inactiveOuter = resolve(processStepIconOuterSx(false, false));
    expect(activeOuter['border']).not.toBe(inactiveOuter['border']);

    const okInner = resolve(processStepIconInnerSx(false));
    const errorInner = resolve(processStepIconInnerSx(true));
    expect(okInner['backgroundColor']).not.toBe(errorInner['backgroundColor']);
  });

  it('dialogPaperSx scales width/height off the editor dimensions', () => {
    const result = resolve(dialogPaperSx(1000, 800));
    expect(result['width']).toBe('900px');
    expect(result['maxHeight']).toBe('640px');
  });
});
