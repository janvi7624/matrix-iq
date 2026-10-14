'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, Settings2, ShieldAlert } from 'lucide-react';
import { DailyReportConfigRecord, DailyReportConfigResponse, DailyReportTemplateAssignment } from '@/lib/dailyReportTypes';
import { DailyReportTemplateKey } from '@/lib/dailyReportTemplates';
import AppShell from './AppShell';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './dailyReport.module.css';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import StatTile from './ui/StatTile';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';

// Daily Report Configuration.
//
// Four things an administrator controls here, in the order they matter:
//   1. Which format each department files (and which have none yet).
//   2. The working-day and deadline policy.
//   3. The warning threshold and the leave-rejection policy.
//   4. The scheduler: whether it is armed, and whether it is a rehearsal.
//
// The scheduler's two switches are deliberately separate and both start in
// the safe position. Arming the scheduler with dry-run ON gives a full
// rehearsal — every reminder, warning and escalation is computed and logged,
// nothing is sent and no warning is recorded. Turning dry-run OFF is the
// single, explicit act that starts mailing real staff.

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  } catch {
    return iso;
  }
}

interface SweepPreview {
  reportDates: string[];
  eligibleEmployees: number;
  byKind: Record<string, number>;
  dueNowTotal: number;
}

export default function DailyReportConfigView() {
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<DailyReportConfigResponse | null>(null);
  const [config, setConfig] = useState<DailyReportConfigRecord | null>(null);
  const [holidaysText, setHolidaysText] = useState('');
  const [preview, setPreview] = useState<SweepPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState('');
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState('');
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed('');
    try {
      const [configResponse, previewResponse] = await Promise.all([
        fetch('/api/admin/daily-report-config'),
        fetch('/api/admin/daily-report-config/sweep')
      ]);
      const body = await configResponse.json().catch(() => null);
      if (!configResponse.ok) throw new Error(body?.error || `Request failed (${configResponse.status})`);
      const next = body as DailyReportConfigResponse;
      setData(next);
      setConfig(next.config);
      setHolidaysText(next.config.holidays.join('\n'));
      if (previewResponse.ok) setPreview(await previewResponse.json().catch(() => null));
    } catch (error) {
      setLoadFailed(error instanceof Error ? error.message : 'Could not load the daily report configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof DailyReportConfigRecord>(key: K, value: DailyReportConfigRecord[K]) {
    setConfig((previous) => (previous ? { ...previous, [key]: value } : previous));
  }

  function toggleDay(day: number) {
    setConfig((previous) => {
      if (!previous) return previous;
      const days = previous.working_days.includes(day)
        ? previous.working_days.filter((d) => d !== day)
        : [...previous.working_days, day].sort();
      return { ...previous, working_days: days };
    });
  }

  async function savePolicy() {
    if (!config) return;
    // Turning dry-run off is the moment real people start receiving mail, so
    // it is confirmed explicitly rather than being one checkbox among ten.
    if (data && data.config.dry_run && !config.dry_run) {
      const ok = await confirm({
        title: 'Send live notifications?',
        message:
          'Turning dry-run off means the next sweep will email employees reminders, record missed-report warnings, and escalate to HR for real. Make sure a dry run has produced the numbers you expect first.',
        confirmLabel: 'Yes, go live',
        danger: true
      });
      if (!ok) return;
    }

    setSavingPolicy(true);
    try {
      const response = await fetch('/api/admin/daily-report-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            working_days: config.working_days,
            holidays: holidaysText.split('\n').map((line) => line.trim()).filter(Boolean),
            observe_holidays: config.observe_holidays,
            deadline_time: config.deadline_time,
            evening_reminder_time: config.evening_reminder_time,
            final_reminder_time: config.final_reminder_time,
            warning_threshold: config.warning_threshold,
            reconcile_window_days: config.reconcile_window_days,
            scheduler_enabled: config.scheduler_enabled,
            dry_run: config.dry_run,
            leave_rejection_policy: config.leave_rejection_policy
          }
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not save (${response.status})`);
      await load();
      toast.success('Daily report policy saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the policy.');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function saveTemplate(assignment: DailyReportTemplateAssignment, patch: Partial<DailyReportTemplateAssignment>) {
    setSavingTemplate(assignment.department_id);
    try {
      const response = await fetch('/api/admin/daily-report-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: {
            department_id: assignment.department_id,
            template_key: patch.template_key ?? assignment.template_key,
            status: patch.status ?? assignment.status,
            notes: patch.notes ?? assignment.notes
          }
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not save (${response.status})`);
      setData((previous) => (previous ? { ...previous, templates: body.templates } : previous));
      toast.success(`${assignment.department_name} updated.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update this department.');
    } finally {
      setSavingTemplate('');
    }
  }

  async function runSweep(dryRun: boolean) {
    if (!dryRun) {
      const ok = await confirm({
        title: 'Run the sweep now?',
        message:
          'This will send any reminders that are due, record missed-report warnings, and escalate to HR — for real. It is safe to run repeatedly: anything already sent is skipped.',
        confirmLabel: 'Run now',
        danger: true
      });
      if (!ok) return;
    }
    setRunning(true);
    try {
      const response = await fetch('/api/admin/daily-report-config/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not run the sweep (${response.status})`);
      await load();
      if (body.status === 'skipped') toast.info(body.reason || 'The scheduler is disabled, so nothing ran.');
      else
        toast.success(
          `${dryRun || body.stats?.dryRun ? 'Dry run' : 'Sweep'} finished: ${JSON.stringify(body.stats?.sent ?? {})}, ${body.stats?.warningsRecorded ?? 0} warnings, ${body.stats?.escalationsSent ?? 0} escalations.`
        );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not run the sweep.');
    } finally {
      setRunning(false);
    }
  }

  const title = 'Daily Report Configuration';
  const subtitle = 'Administration › report formats, working days, deadlines, warnings, and the reminder scheduler.';

  if (loading && !data) {
    return (
      <AppShell title={title} subtitle={subtitle}>
        <div className={calcStyles.sectionPanel}><SkeletonRows rows={6} columns={3} /></div>
      </AppShell>
    );
  }
  if (loadFailed || !data || !config) {
    return (
      <AppShell title={title} subtitle={subtitle}>
        <ErrorState message={loadFailed || 'Could not load the daily report configuration.'} onRetry={load} />
      </AppShell>
    );
  }

  const configuredCount = data.templates.filter((template) => template.status === 'active').length;
  const affectedEmployees = data.templates.filter((t) => t.status === 'active').reduce((sum, t) => sum + t.employee_count, 0);

  return (
    <AppShell title={title} subtitle={subtitle}>
      {/* Status first. An administrator opening this page needs to know
          whether the thing is live before they know anything else. */}
      <div
        className={`${styles.banner} ${
          !config.scheduler_enabled ? styles.bannerNotice : config.dry_run ? styles.bannerWarning : styles.bannerClear
        }`}
      >
        <span className={styles.bannerIcon}>
          {!config.scheduler_enabled ? <Settings2 size={17} /> : config.dry_run ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
        </span>
        <div className={styles.bannerBody}>
          <div className={styles.bannerHeadline}>
            {!config.scheduler_enabled
              ? 'Scheduler disabled — no reminders, warnings or escalations are being issued'
              : config.dry_run
                ? 'Scheduler armed, dry-run ON — everything is computed and logged, nothing is sent'
                : 'Scheduler live — reminders, warnings and escalations are being sent'}
          </div>
          <div className={styles.bannerDetail}>
            {data.cron_hint.configured
              ? 'The scheduler endpoint is configured. '
              : `DAILY_REPORT_CRON_SECRET is not set on this deployment, so the scheduler endpoint refuses every request and nothing will run on a schedule. `}
            {data.hr_recipients.length
              ? `HR escalations go to ${data.hr_recipients.join(', ')}.`
              : 'No HR manager is mapped in Department Master, so HR escalations have nowhere to go — set one before going live.'}
          </div>
        </div>
      </div>

      <div className={styles.kpiRow}>
        <StatTile value={configuredCount} label="Departments configured" />
        <StatTile value={data.templates.length - configuredCount} label="Not configured" tone={data.templates.length - configuredCount ? 'warning' : 'default'} />
        <StatTile value={affectedEmployees} label="Employees filing" />
        <StatTile value={preview?.dueNowTotal ?? 0} label="Events due now" tone={preview?.dueNowTotal ? 'info' : 'default'} />
      </div>

      {/* ----------------------------------------------------- templates */}
      <div className={`${styles.sectionHead} ${styles.sectionHeadFlush}`}>
        <h2 className={styles.sectionTitle}>Department report formats</h2>
      </div>
      <p className={styles.sectionHint}>
        A department set to <strong>Not configured</strong> expects no report: its employees receive no reminders and no missed-report warnings are
        recorded for them. That is the correct state for a department whose format has not been approved yet — Accounts ships this way.
      </p>
      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Department</th>
              <th>Report format</th>
              <th>Status</th>
              <th>Employees</th>
              <th>Managers notified</th>
              <th>Notes</th>
              <th>Last changed</th>
            </tr>
          </thead>
          <tbody>
            {data.templates.map((assignment) => (
              <tr key={assignment.id}>
                <td>{assignment.department_name}</td>
                <td>
                  <Select
                    auto
                    value={assignment.template_key}
                    disabled={savingTemplate === assignment.department_id}
                    aria-label={`Report format for ${assignment.department_name}`}
                    onChange={(e) => saveTemplate(assignment, { template_key: e.target.value as DailyReportTemplateKey })}
                  >
                    {data.available_templates.map((template) => (
                      <option key={template.key} value={template.key}>{template.label}</option>
                    ))}
                  </Select>
                </td>
                <td>
                  {assignment.template_key === 'not_configured' ? (
                    <span className={`${styles.badge} ${styles.badgeNotConfigured}`}>Not configured</span>
                  ) : (
                    <Select
                      auto
                      value={assignment.status}
                      disabled={savingTemplate === assignment.department_id}
                      aria-label={`Status for ${assignment.department_name}`}
                      onChange={(e) => saveTemplate(assignment, { status: e.target.value as 'active' | 'not_configured' })}
                    >
                      <option value="active">Active</option>
                      <option value="not_configured">Not configured</option>
                    </Select>
                  )}
                </td>
                <td>{assignment.employee_count}</td>
                <td>{assignment.manager_names.length ? assignment.manager_names.join(', ') : <span className={calcStyles.small}>None mapped</span>}</td>
                <td>{assignment.notes || '—'}</td>
                <td>
                  {assignment.updated_at ? formatDateTime(assignment.updated_at) : '—'}
                  {assignment.updated_by_name && <div className={calcStyles.small}>{assignment.updated_by_name}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* -------------------------------------------------------- policy */}
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Working days &amp; deadlines</h2>
      </div>
      <div className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Working days</label>
          <div className={styles.dayToggleRow}>
            {DAY_LABELS.map((label, day) => (
              <button
                key={label}
                type="button"
                className={`${styles.dayToggle} ${config.working_days.includes(day) ? styles.dayToggleOn : ''}`}
                aria-pressed={config.working_days.includes(day)}
                onClick={() => toggleDay(day)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={calcStyles.small}>
            A report is due at the deadline time on the next WORKING day after its reporting date — which is why a Saturday report is due on Monday
            with Sunday switched off, without needing a special rule.
          </div>
        </div>

        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="deadline-time">Deadline (IST)</label>
            <Input id="deadline-time" type="time" value={config.deadline_time} onChange={(e) => set('deadline_time', e.target.value)} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="evening-reminder">First reminder, on the reporting date (IST)</label>
            <Input id="evening-reminder" type="time" value={config.evening_reminder_time} onChange={(e) => set('evening_reminder_time', e.target.value)} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="final-reminder">Final reminder, on the deadline day (IST)</label>
            <Input id="final-reminder" type="time" value={config.final_reminder_time} onChange={(e) => set('final_reminder_time', e.target.value)} />
          </div>
        </div>

        <div className={styles.switchRow}>
          <input
            type="checkbox"
            id="observe-holidays"
            checked={config.observe_holidays}
            onChange={(e) => set('observe_holidays', e.target.checked)}
          />
          <div className={styles.switchBody}>
            <label className={styles.switchLabel} htmlFor="observe-holidays">Treat the holiday list below as non-working days</label>
            <div className={styles.switchHint}>
              Off by default: the agreed interim policy is that public holidays count as working days until a holiday calendar has actually been
              curated. The list stays editable while this is off, it is simply not applied — so a half-filled list cannot silently excuse the wrong
              days.
            </div>
          </div>
        </div>

        <div className={calcStyles.field}>
          <label className={calcStyles.label} htmlFor="holidays">Public holidays — one YYYY-MM-DD per line</label>
          <Textarea id="holidays" rows={4} value={holidaysText} onChange={(e) => setHolidaysText(e.target.value)} placeholder="2026-01-26&#10;2026-08-15" />
        </div>
      </div>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Warnings &amp; leave policy</h2>
      </div>
      <div className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`}>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="threshold">Active warnings in a month that inform HR</label>
            <Input
              id="threshold"
              type="number"
              min={1}
              max={31}
              value={config.warning_threshold}
              onChange={(e) => set('warning_threshold', Number(e.target.value))}
            />
            <div className={calcStyles.small}>
              Warnings keep being recorded past this number; only ONE escalation is ever sent per employee per calendar month.
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="rejection-policy">When HR rejects a leave claim</label>
            <Select id="rejection-policy" value={config.leave_rejection_policy} onChange={(e) => set('leave_rejection_policy', e.target.value as 'reinstate' | 'waive')}>
              <option value="reinstate">Reinstate the reporting obligation</option>
              <option value="waive">Waive the obligation for that date</option>
            </Select>
            <div className={calcStyles.small}>
              Reinstating puts the date back in scope, so the normal sweep records a warning only if it is still unfiled and still inside the
              reconcile window — no backdated warning is created for an older date.
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="reconcile-window">Reconcile window (days)</label>
            <Input
              id="reconcile-window"
              type="number"
              min={0}
              max={60}
              value={config.reconcile_window_days}
              onChange={(e) => set('reconcile_window_days', Number(e.target.value))}
            />
            <div className={calcStyles.small}>
              How far back a sweep catches up after downtime. Bounded on purpose: a large value turns &ldquo;the scheduler was off for a while&rdquo;
              into a retroactive warning spree.
            </div>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------- scheduler */}
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Reminder scheduler</h2>
      </div>
      <div className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`}>
        <div className={styles.switchRow}>
          <input
            type="checkbox"
            id="scheduler-enabled"
            checked={config.scheduler_enabled}
            onChange={(e) => set('scheduler_enabled', e.target.checked)}
          />
          <div className={styles.switchBody}>
            <label className={styles.switchLabel} htmlFor="scheduler-enabled">Scheduler enabled</label>
            <div className={styles.switchHint}>
              The master switch. With this off nothing is issued by any path — including a manual run from this page.
            </div>
          </div>
        </div>
        <div className={styles.switchRow}>
          <input type="checkbox" id="dry-run" checked={config.dry_run} onChange={(e) => set('dry_run', e.target.checked)} />
          <div className={styles.switchBody}>
            <label className={styles.switchLabel} htmlFor="dry-run">Dry run — compute and log, send nothing</label>
            <div className={styles.switchHint}>
              A faithful rehearsal: every reminder, warning and escalation is worked out and recorded in the log below, but no email or in-app
              notification is sent and no warning is recorded. Note that a rehearsed event is marked as processed, so it will not be re-sent for real
              afterwards — switch dry-run off on the day you want live sends to begin.
            </div>
          </div>
        </div>

        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Scheduling this job</label>
          <div className={calcStyles.small}>
            The sweep is an idempotent endpoint called by an external scheduler, so it does not need to fire at an exact minute — only sometime after
            an event is due. Hourly is recommended; a missed hour is reconciled by the next call.
          </div>
          <code className={styles.codeLine}>
            {`0 * * * * curl -fsS -X POST -H "Authorization: Bearer $DAILY_REPORT_CRON_SECRET" \\\n  https://your-host${data.cron_hint.path}`}
          </code>
          {!data.cron_hint.configured && (
            <div className={styles.errorText}>
              {data.cron_hint.secret_env} is not set in this deployment&apos;s environment, so that endpoint currently refuses every request.
            </div>
          )}
        </div>

        <div className={styles.footerActions}>
          <Button variant="primary" onClick={savePolicy} loading={savingPolicy} loadingLabel="Saving…">Save Policy</Button>
          <Button variant="secondary" icon={<Play size={15} />} onClick={() => runSweep(true)} disabled={running}>
            Run Dry Sweep
          </Button>
          <Button variant="danger" icon={<ShieldAlert size={15} />} onClick={() => runSweep(false)} disabled={running || config.dry_run || !config.scheduler_enabled}>
            Run Live Sweep
          </Button>
          <span className={styles.footerSpacer} />
          {preview && (
            <span className={styles.savedHint}>
              {preview.eligibleEmployees} employees · window {preview.reportDates[0] ?? '—'} to {preview.reportDates[preview.reportDates.length - 1] ?? '—'} ·{' '}
              {Object.entries(preview.byKind).map(([kind, count]) => `${kind.replace('REMINDER_', '').toLowerCase()} ${count}`).join(', ') || 'nothing due'}
            </span>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------- logs */}
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Scheduler runs</h2>
      </div>
      {data.runs.length === 0 ? (
        <EmptyState icon={Settings2} title="The sweep has not run yet" message="Run a dry sweep above, or wait for the scheduled call." />
      ) : (
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr><th>Started</th><th>Trigger</th><th>Mode</th><th>Status</th><th>Result</th><th>Error</th></tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.started_at)}</td>
                  <td>{run.trigger}</td>
                  <td>{run.dry_run ? <span className={`${styles.badge} ${styles.badgeDraft}`}>dry run</span> : <span className={`${styles.badge} ${styles.badgeSubmitted}`}>live</span>}</td>
                  <td>
                    <span
                      className={`${styles.badge} ${
                        run.status === 'ok' ? styles.badgeSubmitted : run.status === 'failed' ? styles.badgeMissing : styles.badgeLate
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className={calcStyles.small}>
                    {(() => {
                      const stats = run.stats as { subjects?: number; sent?: Record<string, number>; warningsRecorded?: number; escalationsSent?: number; catchUp?: number };
                      if (!stats || typeof stats !== 'object') return '—';
                      const parts = [
                        typeof stats.subjects === 'number' ? `${stats.subjects} subjects` : '',
                        stats.sent && Object.keys(stats.sent).length ? Object.entries(stats.sent).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ') : 'nothing sent',
                        stats.warningsRecorded ? `${stats.warningsRecorded} warnings` : '',
                        stats.escalationsSent ? `${stats.escalationsSent} escalations` : '',
                        stats.catchUp ? `${stats.catchUp} caught up late` : ''
                      ].filter(Boolean);
                      return parts.join(' · ') || '—';
                    })()}
                  </td>
                  <td className={calcStyles.small}>{run.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Notification delivery log</h2>
      </div>
      <p className={styles.sectionHint}>
        Every reminder, warning and submission notice the module has processed, newest first. A row exists because the event was claimed — which is
        also what stops it being sent twice.
      </p>
      {data.recent_events.length === 0 ? (
        <EmptyState icon={Settings2} title="No notifications processed yet" message="Reminders and warnings appear here once the sweep has run." />
      ) : (
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr><th>Processed</th><th>Employee</th><th>Reporting date</th><th>Event</th><th>Status</th><th>Due at</th><th>Error</th></tr>
            </thead>
            <tbody>
              {data.recent_events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.processed_at)}</td>
                  <td>{event.employee_name || '—'}</td>
                  <td>{event.report_date}</td>
                  <td>{event.event_key.replace(/_/g, ' ').toLowerCase()}</td>
                  <td>
                    <span
                      className={`${styles.badge} ${
                        event.status === 'sent' ? styles.badgeSubmitted : event.status === 'failed' ? styles.badgeMissing : styles.badgeDraft
                      }`}
                    >
                      {event.status}
                    </span>
                  </td>
                  <td>{formatDateTime(event.due_at)}</td>
                  <td className={calcStyles.small}>{event.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
