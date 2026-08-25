import { createContext, useContext } from 'react';

import type { TSupportApi } from '../../api';

export const ApiContext = createContext<TSupportApi | null>(null);

export const useApi = (): TSupportApi => {
  const api = useContext(ApiContext);

  if (!api) throw new Error('useApi must be used within EliteaAssistant');

  return api;
};
