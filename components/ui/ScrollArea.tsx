import { CSSProperties, ElementType, ReactNode } from 'react';

export interface ScrollAreaProps {
  children: ReactNode;
  /** Which way it scrolls. Default 'y'. */
  axis?: 'y' | 'x' | 'both';
  /** Cap before it starts scrolling, e.g. 320 or '60vh'. */
  maxHeight?: number | string;
  maxWidth?: number | string;
  /**
   * Accessible name. When given, the area becomes a focusable labelled region
   * (role="region", tabIndex=0) so keyboard users can scroll it — required for
   * a scrollable region with no focusable content inside.
   */
  label?: string;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

const OVERFLOW: Record<NonNullable<ScrollAreaProps['axis']>, CSSProperties> = {
  y: { overflowY: 'auto', overflowX: 'hidden' },
  x: { overflowX: 'auto', overflowY: 'hidden' },
  both: { overflow: 'auto' }
};

/**
 * The one scrollable container for the app. Its scrollbar is the app-wide
 * design (app/globals.css → "Scrollbars"); this component only sets the
 * overflow direction, the size cap, scroll containment (so reaching the end
 * doesn't scroll the page behind a panel) and accessibility.
 */
export default function ScrollArea({ children, axis = 'y', maxHeight, maxWidth, label, as: Tag = 'div', className, style }: ScrollAreaProps) {
  return (
    <Tag
      className={['mx-nice-scroll', className || ''].filter(Boolean).join(' ')}
      style={{ ...OVERFLOW[axis], overscrollBehavior: 'contain', maxHeight, maxWidth, ...style }}
      {...(label ? { role: 'region', 'aria-label': label, tabIndex: 0 } : null)}
    >
      {children}
    </Tag>
  );
}
