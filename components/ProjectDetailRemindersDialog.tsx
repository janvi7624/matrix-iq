'use client';

import { useEffect, useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

// The admin's own view of "who still has blank mandatory project details",
// and the button that emails them. This exists so the reminder is not a thing
// only a developer can run from a script: the preview is the same report the
// send uses, so what is on screen is exactly what goes out.

interface ReminderItem {
  kind: 'Sales' | 'TMS';
  label: string;
  missing: string[];
}

interface ReminderPerson {
  username: string;
  name: string;
  email: string;
  active: boolean;
  items: ReminderItem[];
}

interface ReminderReport {
  mailable: ReminderPerson[];
  unreachable: ReminderPerson[];
  salesScanned: number;
  tmsScanned: number;
  projectsWithGaps: number;
}

export default function ProjectDetailRemindersDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [report, setReport] = useState<ReminderReport | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/admin/project-detail-reminders');
        if (!response.ok) {
          const body = await response.json().catch(() => ({} as { error?: string }));
          throw new Error(body.error || `HTTP ${response.status}`);
        }
        const data: ReminderReport = await response.json();
        if (cancelled) return;
        setReport(data);
        // Everyone reachable is pre-selected: the common case is "remind them
        // all", and unticking two people is less work than ticking twelve.
        setSelected(new Set(data.mailable.map((p) => p.username)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the report.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(set: Set<string>, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  async function handleSend() {
    if (!selected.size) return;
    setSending(true);
    try {
      const response = await fetch('/api/admin/project-detail-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [...selected] })
      });
      const body = await response.json().catch(() => ({} as { error?: string; sent?: string[]; failed?: { name: string }[] }));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      const sent = body.sent?.length ?? 0;
      const failed = body.failed?.length ?? 0;
      if (failed) toast.error(`${sent} reminder${sent === 1 ? '' : 's'} sent, ${failed} could not be delivered.`);
      else toast.success(`${sent} reminder${sent === 1 ? '' : 's'} sent.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the reminders.');
    } finally {
      setSending(false);
    }
  }

  const selectedProjects = report
    ? report.mailable.filter((p) => selected.has(p.username)).reduce((sum, p) => sum + p.items.length, 0)
    : 0;

  return (
    <Modal
      title="Project Detail Reminders"
      ariaLabel="Send reminders for projects with missing details"
      size="wide"
      onClose={onClose}
      dismissible={!sending}
      footer={
        <>
          <ModalCancelButton onClick={onClose} disabled={sending}>
            Close
          </ModalCancelButton>
          <ModalOkButton onClick={handleSend} disabled={sending || !selected.size}>
            {sending
              ? 'Sending…'
              : `Send ${selected.size} reminder${selected.size === 1 ? '' : 's'}`}
          </ModalOkButton>
        </>
      }
    >
      {error && <p className={calcStyles.small} style={{ color: 'var(--mx-danger)' }}>{error}</p>}
      {!report && !error && <p className={calcStyles.small}>Checking every project…</p>}

      {report && (
        <>
          <p className={calcStyles.small} style={{ marginTop: 0 }}>
            {report.projectsWithGaps} project{report.projectsWithGaps === 1 ? '' : 's'} still missing required details,
            across {report.mailable.length} {report.mailable.length === 1 ? 'person' : 'people'}.
            Checked {report.salesScanned} sales and {report.tmsScanned} TMS projects.
            Each person is emailed only their own list.
          </p>

          {report.mailable.length === 0 && (
            <p className={calcStyles.small}>Nothing to chase — every project with an owner has its required details.</p>
          )}

          {report.mailable.map((person) => {
            const isOpen = expanded.has(person.username);
            return (
              <div key={person.username} className={historyStyles.detailPanel} style={{ marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(person.username)}
                    onChange={() => setSelected((s) => toggle(s, person.username))}
                  />
                  <span style={{ flex: 1 }}>
                    <strong>{person.name}</strong>{' '}
                    <span className={calcStyles.small}>&lt;{person.email}&gt;</span>
                  </span>
                  <span className={calcStyles.small}>
                    {person.items.length} project{person.items.length === 1 ? '' : 's'}
                  </span>
                </label>
                <button
                  type="button"
                  className={calcStyles.small}
                  style={{ marginTop: 6, background: 'none', border: 0, padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'inherit' }}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded((s) => toggle(s, person.username))}
                >
                  {isOpen ? 'Hide what they will be told' : 'Show what they will be told'}
                </button>
                {isOpen && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                    {person.items.map((item, i) => (
                      <li key={`${item.kind}-${item.label}-${i}`} className={calcStyles.small}>
                        {item.kind === 'TMS' ? '[TMS] ' : ''}
                        {item.label} — missing: {item.missing.join(', ')}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {report.unreachable.length > 0 && (
            <div className={historyStyles.detailPanel} style={{ marginTop: 12 }}>
              <strong>Nobody to email ({report.unreachable.length})</strong>
              <p className={calcStyles.small} style={{ margin: '4px 0 0' }}>
                These have gaps but no reachable owner — assign an owner and they will appear above.
              </p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {report.unreachable.map((person) => (
                  <li key={person.username} className={calcStyles.small}>
                    {person.name} — {person.items.length} project{person.items.length === 1 ? '' : 's'}
                    {!person.email && ' (no email on file)'}
                    {person.email && !person.active && ' (account not active)'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selected.size > 0 && (
            <p className={calcStyles.small} style={{ marginBottom: 0 }}>
              Sending will email {selected.size} {selected.size === 1 ? 'person' : 'people'} about {selectedProjects}{' '}
              project{selectedProjects === 1 ? '' : 's'}.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
