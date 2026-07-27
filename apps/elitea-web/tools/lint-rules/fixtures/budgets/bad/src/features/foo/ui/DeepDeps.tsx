import { useMemo } from 'react';

export function DeepDeps({ a, b, c, d, e, f, g, h, i }: Record<string, unknown>) {
  const v = useMemo(() => 0, [a, b, c, d, e, f, g, h, i]);
  return v;
}
