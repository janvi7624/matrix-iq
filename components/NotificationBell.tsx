'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { NotificationRecord } from '@/lib/types';
import styles from './quotationHistory.module.css';

const ENTITY_LINK: Record<string, string> = {
  marketing_request: '/marketing-requests'
};

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
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute', top: -4, right: -4, background: '#dc2626', color: '#fff',
              borderRadius: 999, fontSize: 10, lineHeight: '16px', minWidth: 16, height: 16,
              textAlign: 'center', padding: '0 3px', fontWeight: 700
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className={styles.notifPanel}
          style={{
            position: 'absolute', right: 0, top: '110%', width: 340, maxHeight: 420, overflowY: 'auto',
            zIndex: 50
          }}
        >
          <div className={styles.notifHeader}>
            <strong style={{ fontSize: 13.5 }}>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className={styles.notifMarkAllBtn}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className={styles.notifEmpty}>No notifications yet.</div>
          ) : (
            notifications.map((n) => (
              <a
                key={n.id}
                href={ENTITY_LINK[n.entity_type] || '#'}
                onClick={() => markRead(n.id)}
                className={`${styles.notifItem} ${n.is_read ? '' : styles.notifItemUnread}`}
              >
                <div className={styles.notifItemTitle} style={{ fontWeight: n.is_read ? 400 : 700 }}>{n.title}</div>
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
