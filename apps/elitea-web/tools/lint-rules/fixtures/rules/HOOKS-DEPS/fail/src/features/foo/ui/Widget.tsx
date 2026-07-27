import { useEffect, useState } from 'react';

export function Widget({ id }: { id: string }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(id);
  }, []);
  return <output>{value}</output>;
}
