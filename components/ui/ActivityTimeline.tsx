import styles from '../quotationHistory.module.css';

export interface ActivityTimelineEntry {
  id: string;
  label: string;
  by: string;
  at: string;
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

// Extracts the .timeline/.timelineEntry markup already hand-duplicated
// across ProjectDetailView/MarketingRequestsView/SiteVisitsView/the
// performance-review admin page (quotationHistory.module.css) into one
// component — used here for the new TmsProject Activity tab; not a retrofit
// of those existing call sites.
export default function ActivityTimeline({ entries, empty = 'No activity yet.' }: { entries: ActivityTimelineEntry[]; empty?: string }) {
  if (!entries.length) return <div className={styles.status}>{empty}</div>;
  return (
    <div className={styles.timeline}>
      {entries.map((e) => (
        <div key={e.id} className={styles.timelineEntry}>
          <div>{e.label}</div>
          <div className={styles.timelineMeta}>{e.by} · {formatDateTime(e.at)}</div>
        </div>
      ))}
    </div>
  );
}
