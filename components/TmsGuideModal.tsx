'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, ListChecks, Bell, RefreshCw } from 'lucide-react';
import notifyStyles from './ui/notify.module.css';
import calcStyles from './calculator.module.css';

const SEEN_KEY = 'tms_guide_seen';

const WELCOME_STEPS = [
  { icon: FolderKanban, title: 'Projects', body: 'See projects assigned to you under "My Projects" on the TMS Dashboard.' },
  { icon: ListChecks, title: 'Tasks', body: 'See the work you need to complete under "My Tasks", sorted by what’s overdue, due today, and coming up.' },
  { icon: Bell, title: 'Notifications', body: 'We’ll tell you exactly what task was assigned, by whom, and when it’s due — click it to open the task directly.' },
  { icon: RefreshCw, title: 'Update', body: 'Keep your manager informed by updating a task’s status as you work — Start, Complete, or Put On Hold.' }
];

const HOW_IT_WORKS = [
  'Manager assigns a project',
  'Engineer sees it in My Projects',
  'Manager creates tasks',
  'Engineer receives a notification',
  'Engineer completes the task',
  'Engineer updates the status',
  'Manager tracks progress'
];

// Only known guided-intro/onboarding pattern in this app — built specifically
// for TMS, kept intentionally small (static content, no step-through/
// spotlight overlay engine). "Seen" state is per-browser (localStorage), not
// per-account — an accepted simplification, consistent with how this app
// already treats per-viewer convenience state elsewhere.
export function useTmsGuideAutoShow(): [boolean, () => void] {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setShow(true);
    } catch {
      // localStorage can throw in some contexts (private browsing, blocked
      // storage) — fail safe by simply not auto-showing rather than crashing.
    }
  }, []);

  function dismiss() {
    setShow(false);
  }

  return [show, dismiss];
}

export default function TmsGuideModal({ onClose, dontShowAgainDefault = true }: { onClose: () => void; dontShowAgainDefault?: boolean }) {
  const [dontShowAgain, setDontShowAgain] = useState(dontShowAgainDefault);

  function close() {
    try {
      if (dontShowAgain) localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // best-effort only
    }
    onClose();
  }

  return (
    <div className={notifyStyles.overlay} role="presentation" onClick={close}>
      <div className={notifyStyles.wideCard} role="dialog" aria-modal="true" aria-label="Welcome to TMS" onClick={(e) => e.stopPropagation()}>
        <div className={notifyStyles.confirmTitle}>Welcome to TMS</div>
        <p style={{ fontSize: 13.5, color: 'var(--mx-ink-muted)', marginTop: 6 }}>
          TMS helps you manage your technical projects and daily engineering tasks.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, margin: '16px 0' }}>
          {WELCOME_STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} style={{ display: 'flex', gap: 10, padding: 12, borderRadius: 'var(--mx-radius-md)', background: 'var(--mx-surface-sunken)' }}>
              <Icon size={18} color="var(--mx-brand)" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--mx-ink-muted)' }}>{body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className={calcStyles.h2} style={{ fontSize: 13, marginBottom: 8 }}>How TMS Works</div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--mx-ink-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {HOW_IT_WORKS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--mx-ink-muted)', marginTop: 16 }}>
          <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
          Don&apos;t show again
        </label>

        <div className={notifyStyles.confirmActions} style={{ marginTop: 14 }}>
          <button type="button" className={notifyStyles.confirmOk} onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}
