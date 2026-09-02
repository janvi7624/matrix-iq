import styles from '../quotationHistory.module.css';

export type StatusTone = 'pending' | 'confirmed' | 'rejected' | 'done' | 'cancelled' | 'won' | 'lost';

const TONE_CLASS: Record<StatusTone, string> = {
  pending: styles.statusPending,
  confirmed: styles.statusConfirmed,
  rejected: styles.statusRejected,
  done: styles.statusDone,
  cancelled: styles.statusCancelled,
  won: styles.statusWon,
  lost: styles.statusLost
};

// Thin wrapper around the existing .statusBadge CSS (already used
// throughout the app) — takes a tone rather than a raw status string so
// every view's own STATUS_CLASS map collapses to a single { status: tone }
// lookup instead of duplicating the badge markup per file.
export default function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return <span className={`${styles.statusBadge} ${TONE_CLASS[tone]}`}>{label}</span>;
}
