'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { NotificationRecord } from '@/lib/types';
import CommonButton from './ui/CommonButton';
import { onFetchCacheClear } from '@/lib/fetchCached';
import styles from './quotationHistory.module.css';
import bellStyles from './notificationBell.module.css';
import { SkeletonList } from './ui/Skeleton';

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

const POLL_MS = 60000;

// The header remounts on every page change (each page renders its own
// AppShell). Kept at module level so a page change shows the last known
// notifications instantly and does NOT trigger a fresh request — the next
// request happens when the 60s poll is actually due. Cleared on sign-out.
const bellCache: { notifications: NotificationRecord[]; unreadCount: number; fetchedAt: number } = {
  notifications: [],
  unreadCount: 0,
  fetchedAt: 0
};
onFetchCacheClear(() => {
  bellCache.notifications = [];
  bellCache.unreadCount = 0;
  bellCache.fetchedAt = 0;
});

// Self-contained — polls its own unread count so it can sit in the shared
// header without every page needing to know about notifications. In-app
// only, backed by lib/notificationStore.ts; there is no email/SMS delivery
// anywhere in this app.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotificationsState] = useState<NotificationRecord[]>(() => bellCache.notifications);
  const [unreadCount, setUnreadCountState] = useState(() => bellCache.unreadCount);
  // False until the first fetch settles, so opening the panel straight away
  // shows a skeleton rather than a false "all caught up".
  const [loaded, setLoaded] = useState(() => bellCache.fetchedAt > 0);

  // State setters that keep the module cache in step.
  function setNotifications(next: NotificationRecord[] | ((prev: NotificationRecord[]) => NotificationRecord[])) {
    setNotificationsState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      bellCache.notifications = value;
      return value;
    });
  }
  function setUnreadCount(next: number | ((prev: number) => number)) {
    setUnreadCountState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      bellCache.unreadCount = value;
      return value;
    });
  }
  const rootRef = useRef<HTMLDivElement>(null);

  // Stable (only React's own setters + the module cache), so the polling
  // effect below can list it as a dependency without re-subscribing.
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) return;
      const data = await response.json();
      bellCache.fetchedAt = Date.now();
      bellCache.notifications = data.notifications || [];
      bellCache.unreadCount = data.unreadCount || 0;
      setNotificationsState(bellCache.notifications);
      setUnreadCountState(bellCache.unreadCount);
    } catch {
      // notifications are a convenience layer — a failed fetch shouldn't be noisy
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Only when the poll is due — not on every page change.
    if (Date.now() - bellCache.fetchedAt >= POLL_MS) load();
    // Skipped while the tab is hidden: this polled regardless before, so
    // every backgrounded tab kept querying for as long as it stayed open.
    // The database role is capped at 20 connections (see
    // lib/useAutoRefresh.ts), so idle tabs not polling is the point.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null);
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markAll: true }) }).catch(() => null);
  }

  return (
    <div ref={rootRef} className={bellStyles.bellRoot}>
      <CommonButton
        variant="secondary"
        size="sm"
        iconOnly
        className={bellStyles.bellButton}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className={bellStyles.unreadBadge}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </CommonButton>
      {open && (
        <div
          className={`${styles.notifPanel} ${bellStyles.notifPanelPosition}`}
        >
          <div className={styles.notifHeader}>
            <strong className={bellStyles.notifTitleText}>Notifications</strong>
            {unreadCount > 0 && (
              <CommonButton variant="link" size="sm" onClick={markAllRead}>
                Mark all read
              </CommonButton>
            )}
          </div>
          {!loaded && notifications.length === 0 ? (
            <SkeletonList rows={4} avatar={false} boxed={false} />
          ) : notifications.length === 0 ? (
            <div className={styles.notifEmpty}>
              <div className={bellStyles.emptyTitle}>You&apos;re all caught up</div>
              <div className={bellStyles.emptyBody}>New task assignments and important updates will appear here.</div>
            </div>
          ) : (
            notifications.map((n) => (
              <a
                key={n.id}
                href={n.href}
                onClick={() => markRead(n.id)}
                className={`${styles.notifItem} ${n.is_read ? '' : styles.notifItemUnread}`}
              >
                <div className={`${styles.notifItemTitle} ${n.is_read ? bellStyles.itemTitleRead : bellStyles.itemTitleUnread}`}>{n.title}</div>
                <div className={styles.notifItemBody}>{n.body}</div>
                <div className={styles.notifItemTime}>{formatDateTime(n.created_at)}</div>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
