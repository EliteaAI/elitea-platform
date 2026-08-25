import { useCallback, useState } from 'react';

export const useAssistantState = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);
  const expandFullscreen = useCallback(() => setIsExpanded(true), []);
  const collapseFullscreen = useCallback(() => setIsExpanded(false), []);
  const toggleFullscreen = useCallback(() => setIsExpanded(prev => !prev), []);

  return {
    isOpen,
    isExpanded,
    open,
    close,
    toggle,
    expandFullscreen,
    collapseFullscreen,
    toggleFullscreen,
  };
};
