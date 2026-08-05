import { Box } from '@mui/material';
import { memo } from 'react';

interface MaintenanceTipsContainerProps {
  children: React.ReactNode;
}

const MaintenanceTipsContainer = memo(({ children }: MaintenanceTipsContainerProps) => {
  return (
    <Box
      sx={(theme) => ({
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: theme.vars.shape.radiusLg,
        padding: '0.0625rem',
        background: theme.vars.palette.background.welcome.outside,
      })}
    >
      <Box
        sx={(theme) => ({
          width: '100%',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: theme.vars.shape.radiusLg,
          background: theme.vars.palette.background.onboardingBody,
        })}
      >
        <Box
          sx={(theme) => ({
            width: '100%',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            borderRadius: theme.vars.shape.radiusLg,
            padding: '1.25rem',
            background: theme.vars.palette.background.welcome.inner,
          })}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
});

MaintenanceTipsContainer.displayName = 'MaintenanceTipsContainer';

export default MaintenanceTipsContainer;
