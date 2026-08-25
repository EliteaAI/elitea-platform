import { useCallback, useEffect, useRef, useState } from 'react';

import { playPopupSound } from '../utils';

export const usePopup = (isOpen: boolean) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [popupVissible, setIsPopupVissible] = useState(false);

  const hidePopup = useCallback(() => {
    setIsPopupVissible(false);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showPopup = useCallback(() => {
    if (isOpen) return;

    setIsPopupVissible(true);
    playPopupSound();

    timerRef.current = setTimeout(hidePopup, 12000);
  }, [isOpen, hidePopup]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isOpen) hidePopup();
  }, [isOpen, hidePopup]);

  return { popupVissible, showPopup, hidePopup, popupText: 'Hi! Need help? Ask me!' };
};
