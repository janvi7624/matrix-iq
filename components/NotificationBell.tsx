'use client';

import { useEffect, useRef, useState } from 'react';
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
        style={{ position: 'relative' }}
      >
        🔔
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
          style={{
            position: 'absolute', right: 0, top: '110%', width: 340, maxHeight: 420, overflowY: 'auto',
            background: 'var(--card-bg, #fff)', border: '1px solid #e5e7eb', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #f0f0f0' }}>
            <strong style={{ fontSize: 13.5 }}>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, opacity: 0.65, textAlign: 'center' }}>No notifications yet.</div>
          ) : (
            notifications.map((n) => (
              <a
                key={n.id}
                href={ENTITY_LINK[n.entity_type] || '#'}
                onClick={() => markRead(n.id)}
                style={{
                  display: 'block', padding: '10px 12px', borderBottom: '1px solid #f5f5f5',
                  textDecoration: 'none', color: 'inherit', background: n.is_read ? 'transparent' : 'rgba(220,38,38,0.05)'
                }}
              >
                <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 700 }}>{n.title}</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{n.body}</div>
                <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 4 }}>{formatDateTime(n.created_at)}</div>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
