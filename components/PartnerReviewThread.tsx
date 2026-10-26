'use client';

import type { ReviewSide, ReviewThreadEntry } from '@/lib/partnerReviewThread';
import styles from './partnerReviewThread.module.css';

// One component, both audiences.
//
// The internal reviewer and the partner read the SAME conversation in the
// same order with the same wording — that is the point. Two renderings of
// one exchange is how the two sides end up describing it differently, and
// the disagreement only surfaces during an argument about who said what.
//
// The one thing that differs is naming: each side calls the other side by
// name and itself "You". Nothing is hidden from either — every entry here
// was already visible to both (partner_visible rows only).

function formatWhen(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function PartnerReviewThread({
  entries,
  partnerLabel,
  waitingOn,
  /** Which side is reading. Decides which entries read as "You". */
  viewerSide = 'internal'
}: {
  entries: ReviewThreadEntry[];
  /** The partner company's name, for the internal reader. */
  partnerLabel: string;
  /** Whose move it is, or null once the submission is settled. */
  waitingOn: ReviewSide | null;
  viewerSide?: ReviewSide;
}) {
  if (!entries.length) return null;

  const internalLabel = viewerSide === 'internal' ? 'You' : 'Our sales team';
  const partnerName = viewerSide === 'partner' ? 'You' : partnerLabel;

  return (
    <section className={styles.thread} aria-label="Submission conversation">
      <header className={styles.header}>
        <span className={styles.headerTitle}>Submission conversation</span>
        <span className={styles.headerCount}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </header>

      <ol className={styles.list}>
        {entries.map((entry, index) => (
          <li
            key={`${entry.at}-${index}`}
            className={`${styles.entry} ${entry.side === 'internal' ? styles.entryInternal : styles.entryPartner}`}
          >
            <div className={styles.entryHead}>
              <span className={styles.entryWho}>{entry.side === 'internal' ? internalLabel : partnerName}</span>
              <span className={styles.entryTitle}>{entry.title}</span>
              <span className={styles.entryWhen}>{formatWhen(entry.at)}</span>
            </div>
            {/* A decision can legitimately carry no remark — an acceptance
                needs no explanation. Saying so beats an empty box. */}
            {entry.body ? (
              <p className={styles.entryBody}>{entry.body}</p>
            ) : (
              <p className={styles.entryBodyEmpty}>No message was added.</p>
            )}
          </li>
        ))}
      </ol>

      {waitingOn && (
        <div className={styles.waiting}>
          {waitingOn === 'partner'
            ? `Waiting on ${viewerSide === 'partner' ? 'your reply' : `${partnerLabel}`}.`
            : `Waiting on ${viewerSide === 'internal' ? 'your decision' : 'our sales team'}.`}
        </div>
      )}
    </section>
  );
}
