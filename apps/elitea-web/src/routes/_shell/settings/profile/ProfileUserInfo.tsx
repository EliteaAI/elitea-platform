/**
 * ProfileUserInfo — displays the current user's name, avatar, and email.
 */
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = hash % 360;
  return `hsl(${h}, 50%, 40%)`;
}

function ProfileUserInfoSkeleton() {
  return (
    <Box sx={styles.container}>
      <Box sx={styles.textContainer}>
        <Skeleton variant="circular" width={36} height={36} />
        <Skeleton variant="rectangular" width={160} height={24} sx={styles.nameSkeleton} />
        <Skeleton variant="rectangular" width={200} height={18} sx={styles.emailSkeleton} />
      </Box>
    </Box>
  );
}

export interface ProfileUserInfoProps {
  name: string;
  avatar: string;
  email: string;
  isFetching: boolean;
}

export function ProfileUserInfo({ name, avatar, email, isFetching }: ProfileUserInfoProps) {
  if (isFetching) {
    return <ProfileUserInfoSkeleton />;
  }

  return (
    <Box sx={styles.container}>
      <Box sx={styles.textContainer}>
        {avatar ? (
          <img
            src={avatar}
            alt={name}
            style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: stringToColor(name || ''),
              color: 'text.secondary',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            {getInitials(name)}
          </Box>
        )}
        <Typography variant="headingSmall" color="text.secondary" sx={styles.nameText}>
          {name}
        </Typography>
        {email && (
          <Typography variant="bodySmall" color="text.primary" sx={styles.emailText}>
            {email}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '1.5rem',
  },
  textContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  nameText: {
    marginTop: '0.5rem',
  },
  nameSkeleton: {
    marginTop: '0.5rem',
  },
  emailText: {
    marginTop: '0.25rem',
  },
  emailSkeleton: {
    marginTop: '0.625rem',
  },
};
