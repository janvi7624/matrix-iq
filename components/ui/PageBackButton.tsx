'use client';

import { MouseEvent } from 'react';
import { ChevronLeft } from 'lucide-react';
import CommonButton from './CommonButton';
import { useBackNavigation } from './useBackNavigation';
import styles from './commonHeader.module.css';

export interface PageBackButtonProps {
  /** Where Back goes when this tab has no in-app screen behind the current one. Defaults to the nearest parent page. */
  fallbackRoute?: string;
  /** Root used when no parent page exists (e.g. '/partner' in the partner portal). */
  rootRoute?: string;
  /** Replace history/fallback behaviour entirely (e.g. close an in-page detail view). */
  onBack?: () => void;
  label?: string;
  className?: string;
}

/**
 * The in-page back control — a 44×44 chevron icon button placed as the FIRST
 * item of a sub-page's top row (detail, new/edit, import pages and in-page
 * detail views). The main app header deliberately has no back button.
 *
 * Rendered as a link to the fallback route (new-tab/middle-click work), and
 * upgraded to router.back() when there is an in-app screen behind this one.
 */
export default function PageBackButton({ fallbackRoute, rootRoute, onBack, label = 'Go back', className }: PageBackButtonProps) {
  const back = useBackNavigation({ fallbackRoute, rootRoute });
  const cls = [styles.back, styles.pageBack, className || ''].filter(Boolean).join(' ');

  if (onBack) {
    return <CommonButton variant="outlined" iconOnly leadingIcon={<ChevronLeft />} aria-label={label} title={label} className={cls} onClick={onBack} />;
  }
  return (
    <CommonButton
      href={back.fallbackRoute}
      variant="outlined"
      iconOnly
      leadingIcon={<ChevronLeft />}
      aria-label={label}
      title={label}
      className={cls}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => back.handleBackClick(e)}
    />
  );
}
