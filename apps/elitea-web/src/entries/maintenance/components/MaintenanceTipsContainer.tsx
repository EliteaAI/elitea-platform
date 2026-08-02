import { Box } from '@mui/material';
import { memo } from 'react';

interface MaintenanceTipsContainerProps {
  children: React.ReactNode;
}

const MaintenanceTipsContainer = memo(({ children }: MaintenanceTipsContainerProps) => {
  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '1.5rem',
        padding: '0.0625rem',
        background:
          'linear-gradient(42.04deg, rgba(97, 237, 233, 0.4) 8.85%, rgba(251, 66, 255, 0.4) 89.62%)',
      }}
    >
      <Box
        sx={{
          width: '100%',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '1.5rem',
          background: 'rgba(250, 250, 250, 1)',
        }}
      >
        <Box
          sx={{
            width: '100%',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            borderRadius: '1.5rem',
            padding: '1.25rem',
            background:
              'linear-gradient(63.16deg, rgba(41, 169, 165, 0.14) 16.12%, rgba(231, 47, 235, 0.14) 85.3%)',
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
});

MaintenanceTipsContainer.displayName = 'MaintenanceTipsContainer';

export default MaintenanceTipsContainer;
