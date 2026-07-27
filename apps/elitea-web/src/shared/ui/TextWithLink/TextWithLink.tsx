import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface TextWithLinkProps {
  text: ReactNode;
  linkUrl: string;
  linkText: ReactNode;
  suffix?: ReactNode;
}

/**
 * Inline text with an embedded external link. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/text/TextWithLink.jsx`.
 */
export function TextWithLink({ text, linkUrl, linkText, suffix }: TextWithLinkProps): ReactNode {
  return (
    <Box>
      {text}{' '}
      <Link
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        sx={{
          color: 'inherit',
          textDecoration: 'underline',
          '&:hover': { cursor: 'pointer', textDecoration: 'underline' },
        }}
      >
        {linkText}
      </Link>
      {suffix}
    </Box>
  );
}
