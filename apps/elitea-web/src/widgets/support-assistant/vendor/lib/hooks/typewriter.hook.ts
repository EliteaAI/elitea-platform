import { useCallback, useEffect, useRef, useState } from 'react';

const CHARS_PER_TICK = 3;
const TICK_INTERVAL_MS = 16;

export const useTypewriter = (fullText: string, isAnimating: boolean, onComplete: () => void) => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);

  const [displayedLength, setDisplayedLength] = useState(0);

  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!isAnimating || !fullText) {
      setDisplayedLength(fullText.length);
      return;
    }

    setDisplayedLength(0);

    intervalRef.current = setInterval(() => {
      setDisplayedLength(prev => {
        const next = prev + CHARS_PER_TICK;

        if (next >= fullText.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);

          onCompleteRef.current();
          return fullText.length;
        }

        return next;
      });
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fullText, isAnimating]);

  const skipAnimation = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    setDisplayedLength(fullText.length);
    onCompleteRef.current();
  }, [fullText]);

  return { displayedText: fullText.slice(0, displayedLength), skipAnimation };
};
