import { Box, Typography } from '@mui/material';
import { memo } from 'react';

import MaintenanceTips from './MaintenanceTips';

import MaintenanceLogo from '@/entries/maintenance/assets/maintenance-logo.svg?react';
import ChatWelcomeImage from '@/entries/maintenance/assets/chat-welcome.png';

import { VITE_MAINTENANCE_START, VITE_MAINTENANCE_END, VITE_MAINTENANCE_MESSAGE } from '../constants';

const MaintenancePage = memo(() => {
  return (
    <Box
      sx={{
        width: '100%',
        minWidth: '100%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        background: '#F8FCFF',
        position: 'relative',
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: '46.25rem',
          boxSizing: 'border-box',
          height: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: '2rem',
          '@media (max-width: 900px)': {
            width: '34.5rem',
            height: 'auto',
          },
        }}
      >
        <Box
          sx={{
            width: '6.1875rem',
            height: '1.25rem',
          }}
        >
          <MaintenanceLogo />
        </Box>
        <Box
          sx={{
            height: 'auto',
            width: '100%',
            padding: '0.0625rem',
            borderRadius: '1.5rem',
            background:
              'linear-gradient(247.51deg, rgba(161, 197, 255, 0.6) 0.02%, rgba(161, 197, 255, 0.12) 50.21%, rgba(161, 214, 255, 0.6) 99.64%)',
            boxShadow: '0rem 3.975rem 4.2625rem -3.8125rem rgba(80, 161, 255, 0.2)',
            '@media (max-width: 900px)': {
              minHeight: '23.6875rem',
              height: 'auto',
            },
          }}
        >
          <Box
            sx={{
              width: '100%',
              minHeight: '100%',
              height: 'auto',
              background: 'rgba(250, 250, 250, 1)',
              borderRadius: 'calc(1.5rem - 0.0625rem)',
              padding: '2rem',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2rem',
            }}
          >
            <Box
              component="img"
              sx={{ height: '3.75rem', width: '3.75rem' }}
              src={ChatWelcomeImage}
              alt="EliteA"
            />
            <Box
              sx={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <Typography
                component="div"
                sx={{
                  color: 'rgba(14, 19, 29, 1)',
                  fontStyle: 'semibold',
                  fontWeight: 600,
                  fontSize: '1.25rem',
                  lineHeight: '2rem',
                }}
              >
                Elitea is under maintenance!
              </Typography>
              {VITE_MAINTENANCE_START && VITE_MAINTENANCE_END && (
                <>
                  <Typography
                    component="div"
                    sx={{
                      width: '100%',
                      color: 'rgba(244, 124, 255, 1)',
                      textAlign: 'center',
                    }}
                  >
                    {`From ${VITE_MAINTENANCE_START} to ${VITE_MAINTENANCE_END}`}
                  </Typography>
                  {VITE_MAINTENANCE_MESSAGE && (
                    <Typography
                      component="div"
                      sx={{
                        width: '100%',
                        color: 'rgba(244, 124, 255, 1)',
                        textAlign: 'center',
                      }}
                    >
                      {VITE_MAINTENANCE_MESSAGE}
                    </Typography>
                  )}
                </>
              )}
            </Box>
            <MaintenanceTips />
          </Box>
        </Box>
      </Box>
    </Box>
  );
});

MaintenancePage.displayName = 'MaintenancePage';

export default MaintenancePage;
