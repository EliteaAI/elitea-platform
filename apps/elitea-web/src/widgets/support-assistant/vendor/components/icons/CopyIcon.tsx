import React, { memo } from 'react';

const CopyIcon: React.FC = memo(() => (
  <svg
    viewBox="0 0 14 14"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4.66667 4.66667V2.33333C4.66667 1.97971 4.80714 1.64057 5.05719 1.39052C5.30724 1.14048 5.64638 1 6 1H11.6667C12.0203 1 12.3594 1.14048 12.6095 1.39052C12.8595 1.64057 13 1.97971 13 2.33333V8C13 8.35362 12.8595 8.69276 12.6095 8.94281C12.3594 9.19286 12.0203 9.33333 11.6667 9.33333H9.33333M2.33333 4.66667H8C8.73638 4.66667 9.33333 5.26362 9.33333 6V11.6667C9.33333 12.403 8.73638 13 8 13H2.33333C1.59695 13 1 12.403 1 11.6667V6C1 5.26362 1.59695 4.66667 2.33333 4.66667Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
));

CopyIcon.displayName = 'CopyIcon';

export default CopyIcon;
