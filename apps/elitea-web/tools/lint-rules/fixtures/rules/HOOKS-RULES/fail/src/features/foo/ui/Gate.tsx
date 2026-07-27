import { useState } from 'react';

export function Gate({ open }: { open: boolean }) {
  if (open) {
    const [value] = useState('');
    return <output>{value}</output>;
  }
  return null;
}
