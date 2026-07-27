import { useEffect } from 'react';

export function ManyEffects({ id }: { id: string }) {
  useEffect(() => {}, [id]);
  useEffect(() => {}, [id]);
  useEffect(() => {}, [id]);
  useEffect(() => {}, [id]);
  return null;
}
