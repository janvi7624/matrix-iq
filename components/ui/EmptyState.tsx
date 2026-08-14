import { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import styles from './states.module.css';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  message?: string;
  action?: ReactNode;
}

// Replaces bare ".empty" text ("No leads match.") with a real explanation of
// what the user can do next, per the design brief — used on the highest-
// traffic list views (others can adopt it trivially since it's a shared
// primitive).
export default function EmptyState({ icon: Icon = Inbox, title, message, action }: EmptyStateProps) {
  return (
    <div className={styles.stateWrap}>
      <div className={styles.stateIcon}><Icon size={22} /></div>
      <div className={styles.stateTitle}>{title}</div>
      {message && <div className={styles.stateMessage}>{message}</div>}
      {action && <div className={styles.stateAction}>{action}</div>}
    </div>
  );
}
