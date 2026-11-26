import { CSSProperties, ReactNode } from 'react';
import styles from './states.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
  style?: CSSProperties;
}

// A shimmering placeholder block — the building piece for every skeleton
// below. Use the shaped layouts (SkeletonTable, SkeletonStatCards,
// SkeletonDetail, …) for whole loading states so they match the real
// content and the page doesn't jump when data arrives.
export function Skeleton({ width = '100%', height = 14, radius, inline = false, className, style }: SkeletonProps & { inline?: boolean }) {
  const merged: CSSProperties = { width, height, ...(radius !== undefined ? { borderRadius: radius } : null), ...style };
  // `inline` renders a <span> (inline-block) so it can sit inside text,
  // a <span> or a <p> without invalid <div>-in-<span> nesting.
  if (inline) {
    return <span className={`${styles.skeleton} ${className || ''}`} style={{ display: 'inline-block', verticalAlign: 'middle', ...merged }} aria-hidden="true" />;
  }
  return <div className={`${styles.skeleton} ${className || ''}`} style={merged} aria-hidden="true" />;
}

/** Announces "Loading…" to assistive tech once for the whole placeholder. */
function SkeletonRegion({ label = 'Loading…', className, style, children }: { label?: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className} style={style}>
      <span className="mx-sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Deterministic "random-looking" widths so lines don't all end in the same place (no Math.random — SSR-safe). */
const WIDTHS = ['92%', '78%', '64%', '86%', '70%', '58%', '82%', '74%'];
const w = (i: number, offset = 0) => WIDTHS[(i + offset) % WIDTHS.length];

/** Legacy: N placeholder rows of `columns` blocks. Kept for existing callers. */
export function SkeletonRows({ rows = 5, columns = 3 }: { rows?: number; columns?: number }) {
  return (
    <SkeletonRegion>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.skeletonRow}>
          {Array.from({ length: columns }).map((__, j) => (
            <Skeleton key={j} className={styles.skeletonBlock} width={j === 0 ? '30%' : `${Math.max(10, 70 / columns)}%`} />
          ))}
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A few lines of text. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <SkeletonRegion className={[styles.skLines, className || ''].filter(Boolean).join(' ')}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '55%' : w(i)} height={12} />
      ))}
    </SkeletonRegion>
  );
}

/** A table: header bar + rows, same chrome as the shared `.table`. Turns into cards on phones, like real tables. */
export function SkeletonTable({ rows = 6, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  const cols = Math.max(1, columns);
  const style = { '--sk-cols': `1.6fr repeat(${cols - 1}, 1fr)` } as CSSProperties;
  return (
    <SkeletonRegion label="Loading table…" className={[styles.skTable, className || ''].filter(Boolean).join(' ')} style={style}>
      <div className={styles.skTableHead}>
        {Array.from({ length: cols }).map((_, j) => (
          <Skeleton key={j} width={j === 0 ? '50%' : '60%'} height={10} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.skTableRow}>
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} width={j === 0 ? w(i) : w(i, j + 2)} height={j === 0 ? 14 : 12} />
          ))}
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A row of KPI cards — the StatCard shape (icon tile, big value, label). */
export function SkeletonStatCards({ count = 4, minWidth = 180, withIcon = true }: { count?: number; minWidth?: number; withIcon?: boolean }) {
  return (
    <SkeletonRegion label="Loading summary…" className={styles.skGrid} style={{ '--sk-min': `${minWidth}px` } as CSSProperties}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${styles.skBox} ${styles.skStatCard}`}>
          {withIcon && <Skeleton width={40} height={40} radius={8} />}
          <Skeleton width="45%" height={26} />
          <Skeleton width={w(i, 3)} height={12} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A grid of content cards (title, two lines, footer chips). */
export function SkeletonCards({ count = 6, minWidth = 260 }: { count?: number; minWidth?: number }) {
  return (
    <SkeletonRegion className={styles.skGrid} style={{ '--sk-min': `${minWidth}px` } as CSSProperties}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${styles.skBox} ${styles.skCard}`}>
          <Skeleton width={w(i)} height={16} />
          <Skeleton width={w(i, 2)} height={12} />
          <Skeleton width={w(i, 5)} height={12} />
          <div className={styles.skCardFoot}>
            <Skeleton width={70} height={22} radius={999} />
            <Skeleton width={56} height={22} radius={999} />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A list (notifications, comments, timeline, picker results). */
export function SkeletonList({ rows = 5, avatar = true, boxed = true }: { rows?: number; avatar?: boolean; boxed?: boolean }) {
  return (
    <SkeletonRegion className={boxed ? `${styles.skBox} ${styles.skList}` : undefined}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.skListRow}>
          {avatar && <Skeleton width={36} height={36} radius={999} style={{ flexShrink: 0 }} />}
          <div className={styles.skLines} style={{ flex: 1 }}>
            <Skeleton width={w(i)} height={13} />
            <Skeleton width={w(i, 4)} height={11} />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A record detail page: top row (back + status chips + actions) and panels of label/value pairs. */
export function SkeletonDetail({ panels = 2, pairs = 6, withTopRow = true }: { panels?: number; pairs?: number; withTopRow?: boolean }) {
  return (
    <SkeletonRegion label="Loading details…" className={styles.skStack}>
      {withTopRow && (
        <div className={styles.skDetailTop}>
          <Skeleton width={44} height={44} radius={12} />
          <Skeleton width={84} height={24} radius={999} />
          <Skeleton width={64} height={24} radius={999} />
          <Skeleton width={120} height={40} radius={12} />
        </div>
      )}
      {Array.from({ length: panels }).map((_, p) => (
        <div key={p} className={`${styles.skBox} ${styles.skPanel}`}>
          <Skeleton width="32%" height={18} />
          <div className={styles.skPairs}>
            {Array.from({ length: pairs }).map((__, i) => (
              <div key={i} className={styles.skPair}>
                <Skeleton width="38%" height={10} />
                <Skeleton width={w(i, p)} height={14} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A form: labelled fields. */
export function SkeletonForm({ fields = 6 }: { fields?: number }) {
  return (
    <SkeletonRegion label="Loading form…" className={styles.skForm}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className={styles.skField}>
          <Skeleton width={w(i, 1)} height={11} style={{ maxWidth: 140 }} />
          <Skeleton height={44} radius={12} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A typical list page: KPI cards (optional), a toolbar, then a table. */
export function SkeletonPage({ stats = 0, columns = 5, rows = 6 }: { stats?: number; columns?: number; rows?: number }) {
  return (
    <SkeletonRegion label="Loading page…" className={styles.skStack}>
      {stats > 0 && <SkeletonStatCards count={stats} />}
      <div className={styles.skToolbar}>
        <Skeleton width={240} height={44} radius={12} style={{ maxWidth: '100%' }} />
        <Skeleton width={140} height={44} radius={12} />
        <Skeleton width={110} height={44} radius={12} />
      </div>
      <SkeletonTable columns={columns} rows={rows} />
    </SkeletonRegion>
  );
}
