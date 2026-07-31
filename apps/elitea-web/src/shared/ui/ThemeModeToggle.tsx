/**
 * ThemeModeToggle — promoted from `apps/elitea-ui/src/components/ThemeModeToggle.jsx`
 * (Wave-2 unit A13, issue #26).
 *
 * In the new app theme state lives in MUI's `useColorScheme` hook (wired up by
 * `BrandThemeProvider` with `modeStorageKey: 'el-mode'`). This component
 * replaces the baseline's Redux-based `switchMode` action with direct calls to
 * `setColorScheme`.
 *
 * Consumed by: Unit A9's `UserSettings` (hence promoted to `shared/ui` rather
 * than left in `pages/mode-switch`).
 *
 * Deviations from baseline:
 *  - Uses `useColorScheme().setColorScheme` instead of Redux `dispatch(actions.switchMode())`.
 *  - Uses `TabGroupButton` with the new `items` prop instead of `arrayBtn`.
 *  - Uses `shared/ui/icons` for MoonIcon/SunIcon (already ported in Wave-1/S2).
 *  - Uses `shared/lib/enums`'s `ThemeModeOptions` (already ported in Wave-1/S3).
 *  - `displayName` preserved for React DevTools parity.
 */
import { memo, useCallback, useMemo } from 'react';

import { useColorScheme } from '@mui/material/styles';

import { ThemeModeOptions } from '@/shared/lib/enums';
import { TabGroupButton } from '@/shared/ui/TabGroupButton';
import type { TabGroupButtonItem } from '@/shared/ui/TabGroupButton';
import { MoonIcon } from '@/shared/ui/icons/moon-icon';
import { SunIcon } from '@/shared/ui/icons/sun-icon';

/** Theme mode values used by this toggle. */
type ThemeModeValue = 'dark' | 'light';

/**
 * A small MUI `ToggleButtonGroup`-backed control that lets the user switch
 * between dark and light color schemes.
 */
const ThemeModeToggle = memo(() => {
  const { colorScheme, setColorScheme } = useColorScheme();

  const onChange = useCallback(() => {
    setColorScheme((colorScheme === 'dark' ? 'light' : 'dark') as ThemeModeValue);
  }, [colorScheme, setColorScheme]);

  const items = useMemo<TabGroupButtonItem[]>(() => [
    {
      value: ThemeModeOptions.Dark,
      icon: <MoonIcon />,
      label: 'Dark',
      tooltip: 'Dark theme',
    },
    {
      value: ThemeModeOptions.Light,
      icon: <SunIcon />,
      label: 'Light',
      tooltip: 'Light theme',
    },
  ], []);

  return (
    <TabGroupButton
      items={items}
      value={colorScheme ?? ThemeModeOptions.Light}
      onChange={onChange}
      size="small"
    />
  );
});

ThemeModeToggle.displayName = 'ThemeModeToggle';

export default ThemeModeToggle;
