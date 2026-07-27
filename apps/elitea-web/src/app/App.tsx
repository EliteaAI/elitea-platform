import { useState } from 'react';

import { getConfig, MissingEnvPage } from '@/shared/config';

/**
 * Minimal shell for the Wave-0 scaffold (spec §9.3 unit F1).
 * Providers, router, query client and theme arrive with units R1/R2/T1.
 * The counter makes this a stateful, memoizable component so the build
 * verifiably exercises the React Compiler transform (§2.1).
 *
 * Unit F3 wired the runtime-config gate: when any of the three required
 * config vars is missing or invalid, the shell renders MissingEnvPage
 * instead of the app — parity with old App.jsx:11 (MISSING_ENVS.length > 0
 * ? <EnvMissingPage/> : <RouterProvider/>).
 */
export function App() {
  const [count, setCount] = useState(0);
  const config = getConfig();

  if (config.status === 'missing') {
    return <MissingEnvPage missing={config.missing} />;
  }

  return (
    <main>
      <h1>Elitea</h1>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Clicked {count} times
      </button>
    </main>
  );
}
