'use client';

import Link from '@/components/ui/AppLink';
import { ChangeEvent, MouseEvent, ReactNode, Ref } from 'react';
import { ChevronLeft, MoreVertical } from 'lucide-react';
import CommonButton, { commonButtonClassName, CommonButtonVariant } from './CommonButton';
import Popover from './Popover';
import { useBackNavigation } from './useBackNavigation';
import styles from './commonHeader.module.css';

export interface CommonHeaderAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: CommonButtonVariant;
  /** Show only the icon (label becomes the aria-label/tooltip). */
  iconOnly?: boolean;
  disabled?: boolean;
  loading?: boolean;
  selected?: boolean;
}

export interface CommonHeaderMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  href?: string;
  destructive?: boolean;
}

export interface CommonHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small uppercase trail above the title, e.g. "Sales › Leads". */
  breadcrumb?: ReactNode[];
  /** `dark` = the application bar; `light` = an in-page section/detail header. */
  tone?: 'dark' | 'light';
  /** Defaults to false on the dark app bar (it never shows one) and true on light in-page headers. */
  showBackButton?: boolean;
  /** Where Back goes when this tab has no in-app screen behind the current one. Defaults to the nearest parent page. */
  fallbackRoute?: string;
  /** Root used when no parent page exists (defaults to '/'). */
  rootRoute?: string;
  /** Replace the default history/fallback behaviour entirely (e.g. close an in-page detail view). */
  onBack?: () => void;
  backLabel?: string;
  /** Optional brand mark (logo link) shown after the back button. */
  brand?: ReactNode;
  /** Page-specific action buttons, rendered as CommonButtons on the right. */
  rightActions?: CommonHeaderAction[];
  /** Any other right-side nodes (notification bell, account controls…), rendered before rightActions. */
  customActions?: ReactNode;
  showSearch?: boolean;
  /** Custom search control; when omitted a plain search input is rendered. */
  search?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Items for the more-options (⋮) menu. Hidden when empty. */
  menuItems?: CommonHeaderMenuItem[];
  menuLabel?: string;
  /** Set false on surfaces without the Sidebar's mobile hamburger (it otherwise needs room top-left). */
  reserveNavToggleSpace?: boolean;
  className?: string;
  ref?: Ref<HTMLElement>;
}

/**
 * The one header for every page:  [← back] [brand] [title / subtitle] ……… [actions] [⋮]
 *
 * The back control is always the first interactive element on the far left.
 * It is a link to the fallback route (so new-tab/middle-click work and it
 * works before hydration) that becomes router.back() when there is an
 * in-app screen behind the current one.
 */
export default function CommonHeader(props: CommonHeaderProps) {
  const back = useBackNavigation({ fallbackRoute: props.fallbackRoute, rootRoute: props.rootRoute });
  return <CommonHeaderView {...props} backHref={back.fallbackRoute} onBackLinkClick={back.handleBackClick} />;
}

export interface CommonHeaderViewProps extends CommonHeaderProps {
  /** Resolved fallback target for the back link. */
  backHref: string;
  onBackLinkClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

/** Router-free rendering of CommonHeader (used by it, and directly by unit tests). */
export function CommonHeaderView({
  backHref,
  onBackLinkClick,
  title,
  subtitle,
  breadcrumb,
  tone = 'dark',
  showBackButton = tone === 'light',
  onBack,
  backLabel = 'Go back',
  brand,
  rightActions,
  customActions,
  showSearch = false,
  search,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  menuItems,
  menuLabel = 'More options',
  reserveNavToggleSpace = true,
  className,
  ref
}: CommonHeaderViewProps) {
  const inverse = tone === 'dark';

  const backButton = !showBackButton ? null : onBack ? (
    <CommonButton
      variant="outlined"
      tone={inverse ? 'inverse' : 'default'}
      iconOnly
      leadingIcon={<ChevronLeft />}
      aria-label={backLabel}
      title={backLabel}
      className={styles.back}
      onClick={onBack}
    />
  ) : (
    <CommonButton
      href={backHref}
      variant="outlined"
      tone={inverse ? 'inverse' : 'default'}
      iconOnly
      leadingIcon={<ChevronLeft />}
      aria-label={backLabel}
      title={backLabel}
      className={styles.back}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => onBackLinkClick?.(e)}
    />
  );

  const hasMenu = Boolean(menuItems && menuItems.length);
  const hasActions = showSearch || customActions || (rightActions && rightActions.length) || hasMenu;

  return (
    <header
      ref={ref}
      className={[
        styles.root,
        inverse ? styles.dark : styles.light,
        inverse && !reserveNavToggleSpace ? styles.noNavToggle : '',
        className || ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.lead}>
        {backButton}
        {brand}
        <div className={styles.titles}>
          {breadcrumb && breadcrumb.length > 0 && (
            <div className={styles.breadcrumb}>
              {breadcrumb.map((crumb, i) => (
                <span key={i}>
                  {i > 0 && <span className={styles.breadcrumbSep}> › </span>}
                  {crumb}
                </span>
              ))}
            </div>
          )}
          {inverse ? <h1 className={styles.title}>{title}</h1> : <h2 className={styles.title}>{title}</h2>}
          {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
        </div>
      </div>

      {hasActions && (
        <div className={styles.actions}>
          {showSearch &&
            (search ?? (
              <input
                type="search"
                className={styles.search}
                value={searchValue}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder.replace(/…$/, '')}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onSearchChange?.(e.target.value)}
              />
            ))}
          {customActions}
          {rightActions?.map((a) =>
            a.href ? (
              <CommonButton
                key={a.key}
                href={a.href}
                size="sm"
                variant={a.variant ?? 'secondary'}
                leadingIcon={a.icon}
                iconOnly={a.iconOnly}
                aria-label={a.iconOnly ? a.label : undefined}
                title={a.iconOnly ? a.label : undefined}
                disabled={a.disabled}
              >
                {a.iconOnly ? undefined : a.label}
              </CommonButton>
            ) : (
              <CommonButton
                key={a.key}
                size="sm"
                variant={a.variant ?? 'secondary'}
                leadingIcon={a.icon}
                iconOnly={a.iconOnly}
                aria-label={a.iconOnly ? a.label : undefined}
                title={a.iconOnly ? a.label : undefined}
                disabled={a.disabled}
                loading={a.loading}
                selected={a.selected}
                onClick={a.onClick}
              >
                {a.iconOnly ? undefined : a.label}
              </CommonButton>
            )
          )}
          {hasMenu && (
            <Popover
              ariaLabel={menuLabel}
              triggerClassName={commonButtonClassName({
                variant: inverse ? 'ghost' : 'secondary',
                tone: inverse ? 'inverse' : 'default',
                size: 'sm',
                iconOnly: true
              })}
              trigger={<MoreVertical aria-hidden="true" size={18} />}
            >
              {(close) => (
                <div className={styles.menu} role="menu" aria-label={menuLabel}>
                  {menuItems!.map((item) => {
                    const cls = [styles.menuItem, item.destructive ? styles.menuItemDanger : ''].filter(Boolean).join(' ');
                    const inner = (
                      <>
                        {item.icon}
                        <span>{item.label}</span>
                      </>
                    );
                    return item.href ? (
                      <Link key={item.key} role="menuitem" href={item.href} className={cls} onClick={close}>
                        {inner}
                      </Link>
                    ) : (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        className={cls}
                        onClick={() => {
                          close();
                          item.onSelect?.();
                        }}
                      >
                        {inner}
                      </button>
                    );
                  })}
                </div>
              )}
            </Popover>
          )}
        </div>
      )}
    </header>
  );
}
