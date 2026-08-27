import React, { memo } from 'react';

const CheckIcon: React.FC = memo(() => (
  <svg
    viewBox="0 0 14 14"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M11.6667 3.5L5.25 9.91667L2.33333 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
));

CheckIcon.displayName = 'CheckIcon';

export default CheckIcon;
