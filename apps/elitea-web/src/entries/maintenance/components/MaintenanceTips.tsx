import { Box, Link, Typography, useTheme } from '@mui/material';
import { memo } from 'react';

import MaintenanceTipsContainer from './MaintenanceTipsContainer';

const TIPS_LINK = 'https://elitea.ai/docs/home/onboarding-tips/';
const DOCS_LINK = 'https://elitea.ai/docs/';

const MaintenanceTips = memo(() => {
  const theme = useTheme();

  return (
    <MaintenanceTipsContainer>
      <Typography
        component="div"
        sx={{
          fontStyle: 'normal',
          fontWeight: 400,
          fontSize: '14px',
          lineHeight: '24px',
          color: 'rgba(14, 19, 29, 1)',
        }}
      >
        While we get things ready behind the scenes, why not explore some helpful resources?
      </Typography>
      <Box
        component="ul"
        sx={{
          margin: 0,
          paddingLeft: '1.25rem',
          listStyleType: 'disc',
        }}
      >
        <Typography
          component="li"
          sx={{
            fontStyle: 'normal',
            fontWeight: 400,
            fontSize: '14px',
            lineHeight: '24px',
            color: 'rgba(14, 19, 29, 1)',
          }}
        >
          Discover our{' '}
          <Link
            href={TIPS_LINK}
            target="_blank"
            rel="noopener"
            sx={{
              color: (theme.palette.background?.text as any)?.link ?? 'rgba(41, 184, 245, 1)',
              textDecoration: 'underline',
              '&:visited': {
                color: (theme.palette.icon?.fill as any)?.magicAssistant ?? 'rgba(244, 124, 255, 1)',
              },
              '&:hover': {
                cursor: 'pointer',
                textDecoration: 'underline',
              },
            }}
          >
            Tips & Features
          </Link>{' '}
          to get the most out of Elitea
        </Typography>
        <Typography
          component="li"
          sx={{
            fontStyle: 'normal',
            fontWeight: 400,
            fontSize: '14px',
            lineHeight: '24px',
            color: 'rgba(14, 19, 29, 1)',
          }}
        >
          Browse our guides in{' '}
          <Link
            href={DOCS_LINK}
            target="_blank"
            rel="noopener"
            sx={{
              color: (theme.palette.background?.text as any)?.link ?? 'rgba(41, 184, 245, 1)',
              textDecoration: 'underline',
              '&:visited': {
                color: (theme.palette.icon?.fill as any)?.magicAssistant ?? 'rgba(244, 124, 255, 1)',
              },
              '&:hover': {
                cursor: 'pointer',
                textDecoration: 'underline',
              },
            }}
          >
            Documentation.
          </Link>
        </Typography>
      </Box>
    </MaintenanceTipsContainer>
  );
});

MaintenanceTips.displayName = 'MaintenanceTips';

export default MaintenanceTips;
