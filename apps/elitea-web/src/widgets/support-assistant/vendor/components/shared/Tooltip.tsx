import React, { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

type TTooltipProps = {
  content: string;
  children: React.ReactNode;
  placement?: 'top' | 'bottom';
};

const Tooltip: React.FC<TTooltipProps> = memo(props => {
  const { content, children, placement = 'top' } = props;
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [visible, setVisible] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const rect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let top: number;
    if (placement === 'top') {
      top = rect.top - tooltipRect.height - 8;
    } else {
      top = rect.bottom + 8;
    }

    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

    const pad = 8;
    if (left < pad) left = pad;
    if (left + tooltipRect.width > window.innerWidth - pad) {
      left = window.innerWidth - pad - tooltipRect.width;
    }
    if (top < pad) {
      top = rect.bottom + 8;
    }

    setCoords({ top, left });
    setPositioned(true);
  }, [placement]);

  useLayoutEffect(() => {
    if (visible && tooltipRef.current) updatePosition();
    if (!visible) setPositioned(false);
  }, [visible, updatePosition]);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="elitea-assistant-tooltip-trigger"
      >
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            className="elitea-assistant-tooltip"
            style={{
              top: coords.top,
              left: coords.left,
              opacity: positioned ? 1 : 0,
            }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
});

Tooltip.displayName = 'Tooltip';

export default Tooltip;
