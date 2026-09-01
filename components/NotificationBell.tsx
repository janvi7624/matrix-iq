'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { NotificationRecord } from '@/lib/types';
import styles from './quotationHistory.module.css';
import bellStyles from './notificationBell.module.css';

// Static, entity-id-agnostic destinations (the list itself, not one record).
const ENTITY_LINK: Record<string, string> = {
  marketing_request: '/marketing-requests'
};

// Entity types whose notification should open the EXACT record, not a
// generic list — added as needed (tms_task first, since a vague "a task
// was assigned to you" notification that goes nowhere was a reported real
// complaint; see components/TmsTaskDetailView.tsx).
function entityHref(entityType: string, entityId: string): string {
  if (entityType === 'tms_task' && entityId) return `/tms/tasks/${entityId}`;
  return ENTITY_LINK[entityType] || '#';
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

// Self-contained — polls its own unread count so it can sit in the shared
// header without every page needing to know about notifications. In-app
// only, backed by lib/notificationStore.ts; there is no email/SMS delivery
// anywhere in this app.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) return;
      const data = await response.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // notifications are a convenience layer — a failed fetch shouldn't be noisy
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

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
      <button
        type="button"
        className={`${styles.button} ${bellStyles.bellButton}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className={bellStyles.unreadBadge}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className={`${styles.notifPanel} ${bellStyles.notifPanelPosition}`}
        >
          <div className={styles.notifHeader}>
            <strong className={bellStyles.notifTitleText}>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className={styles.notifMarkAllBtn}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className={styles.notifEmpty}>
              <div className={bellStyles.emptyTitle}>You&apos;re all caught up</div>
              <div className={bellStyles.emptyBody}>New task assignments and important updates will appear here.</div>
            </div>
          ) : (
            notifications.map((n) => (
              <a
                key={n.id}
                href={entityHref(n.entity_type, n.entity_id)}
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
