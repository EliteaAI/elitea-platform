import { useState } from 'react';

export function Gate({ open }: { open: boolean }) {
  const [value] = useState('');
  if (open) {
    return <output>{value}</output>;
  }
  return null;
}
