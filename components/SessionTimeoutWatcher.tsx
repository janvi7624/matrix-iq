'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import {
  SESSION_ACTIVITY_STORAGE_KEY,
  SESSION_HEARTBEAT_MIN_GAP_MS,
  SESSION_IDLE_MS,
  SESSION_WARN_BEFORE_MS
} from '@/lib/sessionTimeout';

// Signs the person out after SESSION_IDLE_MS without interaction, warning them
// SESSION_WARN_BEFORE_MS first so nothing half-finished disappears without
// notice.
//
// This is the courteous half of the feature, not the enforcement: the session
// token itself only lives SESSION_IDLE_MS and is rejected server-side once it
// expires, whatever this component does or fails to do. What it adds is the
// warning, and the renewal that stops an actively-working person from being
// logged out mid-sentence.
//
// Renewal is driven by real interaction rather than by requests on purpose —
// the notification bell polls every 60s, so a request-driven session would keep
// an abandoned screen signed in forever, which is the whole thing this is
// meant to prevent.

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];

// How often the countdown is re-checked. Short enough that the warning is
// punctual, long enough to be free.
const TICK_MS = 5_000;

// Interaction is continuous while someone works, so the shared timestamp is
// only written this often.
const ACTIVITY_WRITE_GAP_MS = 5_000;

function readSharedActivity(): number {
  try {
    const raw = window.localStorage.getItem(SESSION_ACTIVITY_STORAGE_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    // Private window, blocked storage — this tab simply keeps its own clock.
    return 0;
  }
}

function writeSharedActivity(at: number): void {
  try {
    window.localStorage.setItem(SESSION_ACTIVITY_STORAGE_KEY, String(at));
  } catch {
    // Non-fatal: cross-tab sharing is a courtesy, the timeout still works.
  }
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function SessionTimeoutWatcher() {
  const [msLeft, setMsLeft] = useState<number | null>(null);
  // Seeded on mount, not here: reading the clock while rendering is impure and
  // would differ between the server pass and the browser's.
  const lastActivityRef = useRef(0);
  const lastWriteRef = useRef(0);
  const lastHeartbeatRef = useRef(0);
  const signingOutRef = useRef(false);

  useEffect(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    lastHeartbeatRef.current = now;
  }, []);

  const markActivity = useCallback((at: number) => {
    lastActivityRef.current = at;
    if (at - lastWriteRef.current >= ACTIVITY_WRITE_GAP_MS) {
      lastWriteRef.current = at;
      writeSharedActivity(at);
    }
  }, []);

  // Ends the session for real: clears the cookie server-side, then leaves for
  // the login page with a note explaining why. A full navigation rather than a
  // router push, so no stale authenticated page state survives it.
  const signOut = useCallback(async (reason: 'timeout' | 'manual') => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if that call fails the token is expiring anyway; still leave.
    }
    window.location.href = reason === 'timeout' ? '/login?timeout=1' : '/login';
  }, []);

  const renew = useCallback(async () => {
    const now = Date.now();
    lastHeartbeatRef.current = now;
    try {
      const response = await fetch('/api/auth/heartbeat', { method: 'POST' });
      // 401 means the session is already gone — from another tab signing out,
      // or a server restart. Leave rather than sit on a page that cannot load.
      if (response.status === 401) await signOut('timeout');
    } catch {
      // Offline or a blip: the next interaction tries again, and the warning
      // still appears on schedule if it never succeeds.
    }
  }, [signOut]);

  useEffect(() => {
    const onActivity = () => {
      const now = Date.now();
      // While the warning is up, only the explicit button dismisses it.
      // Otherwise a stray mouse move would silently extend a session the
      // person never came back to.
      if (msLeft !== null) return;
      markActivity(now);
      if (now - lastHeartbeatRef.current >= SESSION_HEARTBEAT_MIN_GAP_MS) void renew();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
    };
  }, [markActivity, renew, msLeft]);

  useEffect(() => {
    const tick = () => {
      // Before the seeding effect has run there is no activity clock yet, so
      // there is nothing to count down from.
      if (!lastActivityRef.current) return;
      // Whichever tab was used most recently decides, so reading in one tab
      // does not time out the form open in another.
      const lastActivity = Math.max(lastActivityRef.current, readSharedActivity());
      lastActivityRef.current = lastActivity;
      const remaining = SESSION_IDLE_MS - (Date.now() - lastActivity);
      if (remaining <= 0) {
        setMsLeft(0);
        void signOut('timeout');
      } else if (remaining <= SESSION_WARN_BEFORE_MS) {
        setMsLeft(remaining);
      } else {
        setMsLeft(null);
      }
    };
    tick();
    const interval = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(interval);
  }, [signOut]);

  // A laptop that was asleep comes back with the clock far ahead; check at once
  // rather than waiting out the next tick.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const lastActivity = Math.max(lastActivityRef.current, readSharedActivity());
      if (Date.now() - lastActivity >= SESSION_IDLE_MS) void signOut('timeout');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [signOut]);

  const staySignedIn = useCallback(() => {
    const now = Date.now();
    markActivity(now);
    lastWriteRef.current = now;
    writeSharedActivity(now);
    setMsLeft(null);
    void renew();
  }, [markActivity, renew]);

  if (msLeft === null) return null;

  return (
    <Modal
      title="Still there?"
      ariaLabel="Session about to expire"
      dismissible={false}
      onClose={staySignedIn}
      footer={
        <>
          <ModalCancelButton onClick={() => void signOut('manual')}>Log out now</ModalCancelButton>
          <ModalOkButton onClick={staySignedIn}>Stay signed in</ModalOkButton>
        </>
      }
    >
      <p>
        You have not used MatrixIQ for a while, so you will be signed out in{' '}
        <strong aria-live="polite">{formatCountdown(msLeft)}</strong>.
      </p>
      <p>Choose &ldquo;Stay signed in&rdquo; to carry on. Anything you have typed but not saved is still here.</p>
    </Modal>
  );
}
