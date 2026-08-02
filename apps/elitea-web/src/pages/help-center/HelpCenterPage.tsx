/**
 * HelpCenterPage — main page component.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/resources/index.jsx`.
 *
 * KEY DECISION #2 (issue #26): the Go endpoints
 * `GET /admin/system_info/prompt_lib` and
 * `GET /admin/plugin_config_values/prompt_lib/resources` exist but lack
 * OpenAPI specs in the new app. We use hardcoded fallback config values
 * from `lib/ResourceCardConfig.ts` (all enabled, default titles/descriptions,
 * no links). No fake network calls are made.
 *
 * API gap documented at `lib/ResourceCardConfig.ts` header.
 */
import { memo, useMemo, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import Typography from '@mui/material/Typography';

import { RESOURCES_TOUR_TARGET_IDS } from '@/features/interactive-tours';

import { RESOURCE_CARD_CONFIGS } from './lib/ResourceCardConfig';
import ResourceCard from './ui/ResourceCard';
import ResourceVersionInfo from './ui/ResourceVersionInfo';

/**
 * Per-card link shape used when the admin config API is available.
 * Mirrors the shape consumed by the old `resources/index.jsx`.
 */
interface ResourceLink {
  title: string;
  url?: string;
}

/**
 * All resource-cards are enabled by default (hardcoded fallback per
 * Key Decision #2). This mirrors the old app's `filter(config =>
 * configValues[config.enabledKey] !== false)` when the API is absent.
 */
const DEFAULT_CONFIG_VALUES: Record<string, unknown> = Object.fromEntries(
  RESOURCE_CARD_CONFIGS.map((c): [string, boolean] => [c.enabledKey, true]),
);

/**
 * Resolves a card's links from the (absent) API values.
 * With hardcoded fallback this always returns an empty array.
 */
function resolveLinks(
  config: (typeof RESOURCE_CARD_CONFIGS)[number],
  _configValues: Record<string, unknown>,
): ReadonlyArray<ResourceLink> {
  const raw = _configValues[config.linksKey];
  if (Array.isArray(raw)) return raw as ReadonlyArray<ResourceLink>;
  return [];
}

/** Theme-aware sx values — MUI calls these functions with the theme. */
const pageSx: SxProps<Theme> = (t: Theme): SystemStyleObject<Theme> => ({
  width: '100%',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: t.vars.palette.background?.tabPanel ?? t.palette.background.default,
});

const contentSx: SxProps<Theme> = (t: Theme): SystemStyleObject<Theme> => ({
  flex: 1,
  overflowY: 'auto',
  px: t.spacing(3),
  py: t.spacing(2),
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: t.spacing(2),
});

const introSx: SxProps<Theme> = (t: Theme): SystemStyleObject<Theme> => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.5rem',
  textAlign: 'center',
  py: '1rem',
  color: t.palette.text.secondary,
  width: '100%',
});

const gridSx: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(23.75rem, 31.25rem))',
  gap: '1rem',
  justifyContent: 'center',
};

const linkSx: SxProps<Theme> = (t: Theme): SystemStyleObject<Theme> => ({
  color: t.palette.text?.metrics ?? t.palette.text.secondary,
  cursor: 'pointer',
  alignSelf: 'flex-start',
  textDecorationColor: 'currentColor',
  '&:hover': {
    color: t.palette.primary.main,
  },
});

const linkUndefinedSx: SxProps<Theme> = (t: Theme): SystemStyleObject<Theme> => ({
  color: t.palette.text.disabled,
  display: 'block',
  fontStyle: 'italic',
});

/**
 * Main HelpCenter page — renders the version header, intro, and
 * a responsive grid of ResourceCard components.
 */
const HelpCenterPage = memo((): ReactNode => {
  // In a fully-featured implementation these would come from RTK Query
  // hooks. Per Key Decision #2 we use empty/fallback values here.
  const configValues = DEFAULT_CONFIG_VALUES;

  const visibleCards = useMemo(
    () =>
      RESOURCE_CARD_CONFIGS.filter(
        (config): config is (typeof RESOURCE_CARD_CONFIGS)[number] => configValues[config.enabledKey] !== false,
      ),
    [configValues],
  );

  return (
    <Box
      data-tour={RESOURCES_TOUR_TARGET_IDS.page}
      sx={pageSx}
    >
      <ResourceVersionInfo />

      <Box sx={contentSx}>
        <Box sx={introSx}>
          <Typography variant="headingLarge">Explore Help Center</Typography>
          <Typography variant="bodyMedium">
            Guides, documentation, and release notes to support your work.
          </Typography>
        </Box>
        <Box sx={gridSx}>
          {visibleCards.map(config => {
            const links = resolveLinks(config, configValues);
            const hasLinks = links.length > 0;

            return (
              <ResourceCard
                key={config.enabledKey}
                title={config.defaultTitle}
                description={config.defaultDescription}
                colorScheme={config.colorScheme}
                tourTargetId={config.tourTargetId}
                icon={
                  <config.Icon
                    width="1.5rem"
                    height="1.5rem"
                  />
                }
              >
                {hasLinks &&
                  links.map((link, idx) =>
                    link.url ? (
                      <Link
                        key={idx}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        underline="always"
                        sx={linkSx}
                        variant="bodyMedium"
                      >
                        {link.title}
                      </Link>
                    ) : (
                      <Typography
                        key={idx}
                        variant="bodyMedium"
                        sx={linkUndefinedSx}
                      >
                        {link.title} (undefined)
                      </Typography>
                    ),
                  )}
                {!hasLinks && (
                  <Typography
                    variant="bodySmall"
                    color="text.disabled"
                  >
                    No links configured
                  </Typography>
                )}
              </ResourceCard>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
});

HelpCenterPage.displayName = 'HelpCenterPage';

export default HelpCenterPage;
