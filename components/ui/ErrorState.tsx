import styles from './states.module.css';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

// Replaces "load failed, here's some plain text" with a real recoverable
// state — used alongside EmptyState on the highest-traffic list views.
// Action failures already go through useToast(); this is specifically for
// initial-load failures, which previously just set page text with no way
// to recover short of a full refresh.
export default function ErrorState({ title = 'Unable to load this page', message, onRetry }: ErrorStateProps) {
  return (
    <div className={styles.errorWrap}>
      <div className={styles.errorIcon}>⚠️</div>
      <div className={styles.stateTitle}>{title}</div>
      <div className={styles.stateMessage}>{message}</div>
      {onRetry && (
        <button type="button" className={styles.retryBtn} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
