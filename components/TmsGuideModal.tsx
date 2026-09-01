'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, ListChecks, Bell, RefreshCw } from 'lucide-react';
import notifyStyles from './ui/notify.module.css';
import calcStyles from './calculator.module.css';
import styles from './tmsGuideModal.module.css';

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
        <p className={styles.intro}>
          TMS helps you manage your technical projects and daily engineering tasks.
        </p>

        <div className={styles.stepsGrid}>
          {WELCOME_STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} className={styles.stepCard}>
              <Icon size={18} color="var(--mx-brand)" className={styles.stepIcon} />
              <div>
                <div className={styles.stepTitle}>{title}</div>
                <div className={styles.stepBody}>{body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className={`${calcStyles.h2} ${styles.sectionHeadingCompact}`}>How TMS Works</div>
        <ol className={styles.stepsList}>
          {HOW_IT_WORKS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <label className={styles.dontShowLabel}>
          <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
          Don&apos;t show again
        </label>

        <div className={`${notifyStyles.confirmActions} ${styles.actionsSpaced}`}>
          <button type="button" className={notifyStyles.confirmOk} onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}
