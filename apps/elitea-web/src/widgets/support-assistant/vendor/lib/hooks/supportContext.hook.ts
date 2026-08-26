import { createContext, useContext } from 'react';

import type { TSupportAssistantContext } from '../types';

export const SupportAssistantContextValue = createContext<TSupportAssistantContext | null>(null);

export const useSupportAssistantContext = (): TSupportAssistantContext | null =>
  useContext(SupportAssistantContextValue);
