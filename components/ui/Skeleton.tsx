import { CSSProperties } from 'react';
import styles from './states.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: CSSProperties;
}

// A shimmering placeholder block — drop-in replacement for bare "Loading…"
// text. `<SkeletonRows>` below covers the common "N placeholder table/list
// rows" case in one call.
export function Skeleton({ width = '100%', height = 14, className, style }: SkeletonProps) {
  return <div className={`${styles.skeleton} ${className || ''}`} style={{ width, height, ...style }} />;
}

export function SkeletonRows({ rows = 5, columns = 3 }: { rows?: number; columns?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.skeletonRow}>
          {Array.from({ length: columns }).map((__, j) => (
            <Skeleton key={j} className={styles.skeletonBlock} width={j === 0 ? '30%' : `${Math.max(10, 70 / columns)}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}
