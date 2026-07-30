import { memo, useCallback, useMemo } from 'react';

import { useLocation } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import SvgIcon from '@mui/material/SvgIcon';
import type { SxProps, Theme } from '@mui/material/styles';

import { AnalyticsIcon } from '../icons/analytics-icon';
import { BriefcaseIcon } from '../icons/briefcase-icon';
import { ConfigurationIcon } from '../icons/configuration-icon';
import { EnvironmentIcon } from '../icons/environment-icon';
import { HumanIcon } from '../icons/human-icon';
import { InfoIcon } from '../icons/info-icon';
import { KeyIcon } from '../icons/key-icon';
import { LockIcon } from '../icons/lock-icon';
import { LogoutIcon } from '../icons/logout-icon';
import { PersonalizationIcon } from '../icons/personalization-icon';
import { PromptIcon } from '../icons/prompt-icon';

import { SETTINGS_LAYOUT } from './settings.constants';
import { t } from '../lib/t';

/** Tab definition used by `SettingsDrawer`. */
export interface SettingsTab {
  /** Unique identifier — matches the URL path segment. */
  id: string;
  /** Display label for the tab. */
  label: string;
  /** Optional icon reference — SettingsDrawer resolves icons internally via ICON_COMPONENTS. */
  icon?: React.ComponentType;
}

/** A group of tabs under a section header. */
export interface SettingsSection {
  /** Section label shown above its tabs. */
  section: string;
  /** Tabs in this section. */
  tabs: SettingsTab[];
}

export interface SettingsDrawerProps {
  /** Sections with their tabs. */
  sections: SettingsSection[];
  /** Called when a tab item is clicked. */
  onItemClick?: (tabId: string) => void;
}

const ICON_COMPONENTS: Record<string, React.ComponentType> = {
  'model-configuration': ConfigurationIcon,
  prompts: PromptIcon,
  environment: EnvironmentIcon,
  tokens: KeyIcon,
  'project-params': BriefcaseIcon,
  secrets: LockIcon,
  users: HumanIcon,
  analytics: AnalyticsIcon,
  personalization: PersonalizationIcon,
  notifications: InfoIcon,
  logout: LogoutIcon,
};

const getIconComponent = (tabId: string): React.ComponentType => {
  return ICON_COMPONENTS[tabId] ?? ConfigurationIcon;
};

const menuItemSx =
  (isActive: boolean): SxProps<Theme> =>
  ({ palette }) => ({
    padding: '0.5rem 1rem',
    margin: '0 1rem',
    gap: '0.5rem',
    display: 'flex',
    alignItems: 'center',
    maxWidth: 'calc(100% - 2rem)',
    height: '2rem',
    background: isActive
      ? palette.background.userInputBackgroundActive
      : palette.background.conversation.normal,
    // oxlint-disable-next-line elitea/ad-hoc-radius — ported from baseline
    borderRadius: '0.375rem',
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out',
    boxSizing: 'border-box',
    '&:hover': {
      backgroundColor: palette.background.conversation.hover,
    },
  });

const iconWrapperSx =
  (isActive: boolean): SxProps<Theme> =>
  ({ palette }) => ({
    display: 'flex',
    alignItems: 'center',
    minWidth: '0.875rem',
    color: isActive ? palette.text.secondary : palette.icon.fill.stateButtonHover,
    '& svg': {
      fill: isActive ? palette.text.secondary : palette.icon.fill.stateButtonHover,
      width: '0.875rem',
      height: '0.875rem',
    },
  });

const menuItemTextSx =
  (isActive: boolean): SxProps<Theme> =>
  ({ palette }) => ({
    fontFamily: 'Montserrat, sans-serif',
    fontWeight: 500,
    // oxlint-disable-next-line elitea/ad-hoc-font-size — ported from baseline
    fontSize: '0.75rem',
    lineHeight: '1rem',
    letterSpacing: 0,
    color: isActive ? palette.text.secondary : palette.text.metrics,
  });

/**
 * Left sidebar navigation for the Settings page. Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/ui/settings-drawer/SettingsDrawer.jsx`.
 */
export const SettingsDrawer = memo(function SettingsDrawer({ sections, onItemClick }: SettingsDrawerProps) {
  const location = useLocation();

  const isActiveTab = useCallback(
    (tabId: string) => {
      if (!tabId) return false;

      const pathSegments = location.pathname.split('/');
      const lastSegment = pathSegments[pathSegments.length - 1];

      if (
        tabId === 'model-configuration' &&
        (lastSegment === 'create-configuration' || pathSegments[pathSegments.length - 2] === 'create-configuration')
      ) {
        return true;
      }
      if (tabId === 'tokens' && lastSegment === 'create-personal-token') {
        return true;
      }
      return lastSegment === tabId;
    },
    [location.pathname],
  );

  const handleItemClick = useCallback(
    (tabId: string) => {
      onItemClick?.(tabId);
    },
    [onItemClick],
  );

  const renderedSections = useMemo(
    () =>
      sections.map((section, sectionIndex) => (
        <Box
          key={section.section}
          sx={sectionGroupSx}
        >
          {sectionIndex > 0 && <Divider sx={sectionDividerSx} />}
          <Box
            component="span"
            sx={sectionHeaderSx}
          >
            {section.section}
          </Box>
          {section.tabs.map((tab) => {
            const IconComponent = getIconComponent(tab.id);
            const isActive = isActiveTab(tab.id);
            return (
              <Box
                key={tab.id}
                onClick={() => handleItemClick(tab.id)}
                sx={menuItemSx(isActive)}
              >
                <Box sx={iconWrapperSx(isActive)}>
                  <SvgIcon
                    component={IconComponent}
                    inheritViewBox
                    sx={{ width: '0.875rem', height: '0.875rem' }}
                  />
                </Box>
                <Box
                  component="span"
                  sx={menuItemTextSx(isActive)}
                >
                  {tab.label}
                </Box>
              </Box>
            );
          })}
        </Box>
      )),
    [sections, isActiveTab, handleItemClick],
  );

  return (
    <Box sx={drawerSx}>
      <Box sx={headerSx}>
        <Box
          component="span"
          sx={headerTextSx}
        >
          {t('shared.ui.settings.drawer.title', 'Settings')}
        </Box>
      </Box>

      <Box sx={menuContainerSx}>{renderedSections}</Box>
    </Box>
  );
});

/** @type {MuiSx} */
const drawerSx: SxProps<Theme> = ({ palette }) => ({
  width: SETTINGS_LAYOUT.DRAWER_WIDTH,
  minWidth: SETTINGS_LAYOUT.DRAWER_WIDTH,
  maxWidth: SETTINGS_LAYOUT.DRAWER_WIDTH,
  borderRight: `0.0625rem solid ${palette.border.table}`,
  backgroundColor: palette.background.tabPanel,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  boxSizing: 'border-box',
});

const headerSx: SxProps<Theme> = ({ palette }) => ({
  padding: '1rem 1rem 1.1875rem 1.5rem',
  borderBottom: `0.0625rem solid ${palette.border.table}`,
});

const headerTextSx: SxProps<Theme> = ({ palette }) => ({
  color: palette.text.secondary,
  // oxlint-disable-next-line elitea/ad-hoc-font-size — ported from baseline
  fontSize: '1rem',
  fontWeight: 500,
});

const menuContainerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  maxWidth: '100%',
  overflow: 'auto',
};

const sectionGroupSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

const sectionHeaderSx: SxProps<Theme> = ({ palette }) => ({
  display: 'block',
  color: palette.text.metrics,
  fontFamily: 'Montserrat, sans-serif',
  fontWeight: 500,
  // oxlint-disable-next-line elitea/ad-hoc-font-size — ported from baseline
  fontSize: '0.75rem',
  lineHeight: '1rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '1rem',
});

const sectionDividerSx: SxProps<Theme> = ({ palette }) => ({
  borderColor: palette.border.table,
  margin: 0,
});
