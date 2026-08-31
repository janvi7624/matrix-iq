import { ReactNode } from 'react';
import styles from '../quotationHistory.module.css';

export type PriorityTone = 'hot' | 'warm' | 'info' | 'cool';

const TONE_CLASS: Record<PriorityTone, string> = {
  hot: styles.priorityBadgeHot,
  warm: styles.priorityBadgeWarm,
  info: styles.priorityBadgeInfo,
  cool: styles.priorityBadgeCool
};

// Thin wrapper around the existing .priorityBadge CSS. `tone` is a visual
// escalation step (cool -> info -> warm -> hot), deliberately separate from
// any one module's priority value type so both Leads' 3-level and
// Marketing's 4-level (low/medium/high/urgent) priority can reuse the same
// 4 existing color tokens without inventing new colors.
export default function PriorityBadge({ tone, icon, label }: { tone: PriorityTone; icon?: ReactNode; label: string }) {
  return (
    <span className={`${styles.priorityBadge} ${TONE_CLASS[tone]}`}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </span>
  );
}
