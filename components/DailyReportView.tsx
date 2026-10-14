'use client';

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarOff, CheckCircle2, ClipboardList, Clock, Info, ShieldAlert } from 'lucide-react';
import { DailyReportPayloadInput, EMPTY_PAYLOAD } from '@/lib/dailyReportTemplates';
import { MyDailyReportResponse } from '@/lib/dailyReportTypes';
import AppShell from './AppShell';
import DailyReportForm from './DailyReportForm';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './dailyReport.module.css';
import Button from './ui/Button';
import Input from './ui/Input';
import Textarea from './ui/Textarea';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { useAutoRefresh } from '@/lib/useAutoRefresh';

// The employee's own Daily Report page.
//
// Draft and Submit are two separate buttons and two separate requests, which
// is the whole point of the screen: a draft is private and does not satisfy
// the filing requirement, so "I saved it" and "I filed it" must never be the
// same gesture. The page says which state it is in at all times rather than
// leaving it to be inferred from whether a button is greyed out.

const BANNER_ICON = {
  clear: CheckCircle2,
  notice: Info,
  warning: AlertTriangle,
  escalated: ShieldAlert
} as const;

const BANNER_CLASS = {
  clear: styles.bannerClear,
  notice: styles.bannerNotice,
  warning: styles.bannerWarning,
  escalated: styles.bannerEscalated
} as const;

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      // Every timestamp this module shows a user is IST, matching the
      // deadline it is being compared against — a browser in another zone
      // must not render a different "submitted at" than the one the
      // deadline was judged in.
      timeZone: 'Asia/Kolkata'
    });
  } catch {
    return iso;
  }
}

// Today in IST, for the date picker's upper bound. Computed from the
// browser's clock but rendered in Asia/Kolkata, so somebody travelling (or
// a laptop left on another zone) still can't pick a date the server will
// reject as being in the future.
function istToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  // en-CA formats as YYYY-MM-DD, which is exactly the shape the input wants.
  return parts;
}

function weekday(date: string): string {
  try {
    return new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
  } catch {
    return '';
  }
}

/** Server issue list -> { path: message } for the form renderer. */
function issuesToMap(issues: { path: string; message: string }[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues ?? []) map[issue.path] = issue.message;
  return map;
}

function payloadFromResponse(data: MyDailyReportResponse): DailyReportPayloadInput {
  if (!data.report) return { header: {}, entries: [], matrix: {} };
  return {
    header: data.report.payload ?? {},
    entries: data.report.entries.map((entry) => ({ ...entry.data })),
    matrix: (data.report.matrix ?? {}) as DailyReportPayloadInput['matrix']
  };
}

const HISTORY_DOT = {
  SUBMITTED: styles.dotSubmitted,
  SUBMITTED_LATE: styles.dotLate,
  DRAFT: styles.dotDraft,
  MISSING: styles.dotMissing
} as const;

export default function DailyReportView({
  initialDate,
  embedded,
  onDateChange
}: {
  initialDate?: string;
  embedded?: boolean;
  /**
   * Reports a date the USER picked, so the merged page can keep it in the
   * URL and carry it across to the Team tab. Deliberately not called from
   * load(): firing on every fetch would push the date the view just
   * received back out again, and the round trip would re-enter load().
   */
  onDateChange?: (date: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [date, setDate] = useState(initialDate ?? '');
  const [data, setData] = useState<MyDailyReportResponse | null>(null);
  const [payload, setPayload] = useState<DailyReportPayloadInput>(EMPTY_PAYLOAD);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState('');
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  // Guards the auto-refresh: refetching while somebody is mid-sentence would
  // throw away what they have typed. See useAutoRefresh's own comment on why
  // it refetches data rather than reloading the page.
  const [dirty, setDirty] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveSaving, setLeaveSaving] = useState(false);

  const load = useCallback(
    async (forDate?: string) => {
      setLoading(true);
      setLoadFailed('');
      try {
        const query = forDate ? `?date=${encodeURIComponent(forDate)}` : '';
        const response = await fetch(`/api/daily-reports/me${query}`);
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
        const next = body as MyDailyReportResponse;
        setData(next);
        setPayload(payloadFromResponse(next));
        setDate(next.report_date);
        setIssues({});
        setDirty(false);
      } catch (error) {
        setLoadFailed(error instanceof Error ? error.message : 'Could not load your daily report.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(initialDate);
  }, [load, initialDate]);

  useAutoRefresh(() => load(date), { enabled: !dirty && !loading && !leaveOpen });

  const submitted = data?.report?.submission_status === 'SUBMITTED' || data?.report?.submission_status === 'SUBMITTED_LATE';
  const leavePending = data?.leave_claim?.status === 'PENDING';
  const leaveApproved = data?.leave_claim?.status === 'APPROVED';

  const banner = data?.warnings.banner;
  const BannerIcon = banner ? BANNER_ICON[banner.tone] : Info;

  const deadlineLabel = useMemo(() => (data ? formatDateTime(data.deadline_at) : '—'), [data]);

  function updatePayload(next: DailyReportPayloadInput) {
    setPayload(next);
    setDirty(true);
  }

  async function save(mode: 'draft' | 'submit') {
    if (!data) return;
    if (mode === 'submit') {
      const ok = await confirm({
        title: 'Submit this report?',
        message: data.past_deadline
          ? `The deadline (${deadlineLabel}) has passed, so this will be recorded as submitted late. Your manager will be notified.`
          : 'Your manager will be notified. You can still edit it afterwards — the original submission time is kept.',
        confirmLabel: 'Submit Report'
      });
      if (!ok) return;
    }

    setSaving(mode);
    setIssues({});
    try {
      const response = await fetch('/api/daily-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportDate: data.report_date, mode, ...payload })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // Field-level issues are marked on the form; the toast carries the
        // headline so a form with four problems doesn't produce four toasts.
        if (body?.issues) setIssues(issuesToMap(body.issues));
        throw new Error(body?.error || `Could not save (${response.status})`);
      }
      setDirty(false);
      await load(data.report_date);
      toast.success(mode === 'submit' ? 'Report submitted.' : 'Draft saved — only you can see it.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this report.');
    } finally {
      setSaving(null);
    }
  }

  async function raiseLeaveClaim() {
    if (!data) return;
    if (!leaveReason.trim()) return toast.error('Give a reason for the leave claim.');
    setLeaveSaving(true);
    try {
      const response = await fetch('/api/daily-reports/leave-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportDate: data.report_date, reason: leaveReason.trim() })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not raise the claim (${response.status})`);
      setLeaveOpen(false);
      setLeaveReason('');
      await load(data.report_date);
      toast.success('Leave claim sent to HR. This date is excluded from reminders while they review it.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not raise this leave claim.');
    } finally {
      setLeaveSaving(false);
    }
  }

  const title = 'Daily Report';
  const subtitle = 'Workspace › file your daily activity report and track your submission history.';

  // Same convention as MyQuotationsView: when this view is a tab inside the
  // merged Daily Report page, the parent already owns the AppShell chrome,
  // so rendering a second one would nest two sidebars and two headers.
  // Applied through a helper rather than one hoisted `content` variable
  // because this view has two early returns (loading, load-failed) that each
  // need the same treatment.
  const wrap = (node: ReactNode) =>
    embedded ? <>{node}</> : <AppShell title={title} subtitle={subtitle}>{node}</AppShell>;

  if (loading && !data) {
    return wrap(<div className={calcStyles.sectionPanel}><SkeletonRows rows={6} columns={3} /></div>);
  }

  if (loadFailed || !data) {
    return wrap(<ErrorState message={loadFailed || 'Could not load your daily report.'} onRetry={() => load(date)} />);
  }

  return wrap(
    <>
      {banner && (
        <div className={`${styles.banner} ${BANNER_CLASS[banner.tone]}`} role={banner.tone === 'escalated' ? 'alert' : undefined}>
          <span className={styles.bannerIcon}><BannerIcon size={17} /></span>
          <div className={styles.bannerBody}>
            <div className={styles.bannerHeadline}>{banner.headline}</div>
            <div className={styles.bannerDetail}>{banner.detail}</div>
            {data.warnings.warnings.length > 0 && (
              <ul className={styles.inlineList}>
                {data.warnings.warnings.map((warning) => (
                  <li key={warning.id}>
                    {formatDate(warning.report_date)} —{' '}
                    {warning.status === 'WAIVED' ? (
                      <>waived{warning.waived_by_name ? ` by ${warning.waived_by_name}` : ''}{warning.waiver_reason ? `: ${warning.waiver_reason}` : ''}</>
                    ) : (
                      'active'
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`}>
        <div className={styles.metaRow}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="report-date">Reporting date</label>
            <Input
              id="report-date"
              type="date"
              auto
              value={date}
              max={istToday()}
              onChange={(e) => {
                if (dirty) {
                  toast.info('Save or discard your changes before changing the date.');
                  return;
                }
                load(e.target.value);
                onDateChange?.(e.target.value);
              }}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Employee</span>
            <span className={styles.metaValue}>{data.employee.name}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Department</span>
            <span className={styles.metaValue}>{data.employee.department_name || '—'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Deadline</span>
            <span className={`${styles.metaValue} ${data.past_deadline ? styles.metaValueDanger : ''}`}>
              {deadlineLabel}
              {data.deadline_date !== data.report_date && ' (next working day)'}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Status</span>
            <span className={styles.metaValue}>
              {submitted ? (
                <span className={`${styles.badge} ${data.report?.is_late ? styles.badgeLate : styles.badgeSubmitted}`}>
                  {data.report?.is_late ? 'Submitted late' : 'Submitted'}
                </span>
              ) : data.report ? (
                <span className={`${styles.badge} ${styles.badgeDraft}`}>Draft — not filed</span>
              ) : (
                <span className={`${styles.badge} ${styles.badgeMissing}`}>Not started</span>
              )}
            </span>
          </div>
          {submitted && data.report && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Submitted at</span>
              <span className={styles.metaValue}>{formatDateTime(data.report.submitted_at)}</span>
            </div>
          )}
        </div>

        {/* Each of these is a different situation with a different thing to
            do next, so each says so explicitly rather than all three being
            folded into one generic "late" warning. */}
        {leavePending && (
          <div className={`${styles.banner} ${styles.bannerNotice}`}>
            <span className={styles.bannerIcon}><Clock size={17} /></span>
            <div className={styles.bannerBody}>
              <div className={styles.bannerHeadline}>Leave claim pending with HR</div>
              <div className={styles.bannerDetail}>
                You claimed leave for this date on {formatDate(data.leave_claim?.created_at ?? '')}. While it is pending, this date is excluded from
                reminders and warnings. You can still file a report if you want to.
              </div>
            </div>
          </div>
        )}
        {leaveApproved && (
          <div className={`${styles.banner} ${styles.bannerClear}`}>
            <span className={styles.bannerIcon}><CalendarOff size={17} /></span>
            <div className={styles.bannerBody}>
              <div className={styles.bannerHeadline}>Leave approved for this date</div>
              <div className={styles.bannerDetail}>
                No report is expected{data.leave_claim?.reviewed_by_name ? ` — approved by ${data.leave_claim.reviewed_by_name}` : ''}.
              </div>
            </div>
          </div>
        )}
        {data.leave_claim?.status === 'REJECTED' && (
          <div className={`${styles.banner} ${styles.bannerWarning}`}>
            <span className={styles.bannerIcon}><AlertTriangle size={17} /></span>
            <div className={styles.bannerBody}>
              <div className={styles.bannerHeadline}>Leave claim rejected</div>
              <div className={styles.bannerDetail}>
                {data.leave_claim.decision_reason || 'No reason was recorded.'} The report for this date is still expected.
              </div>
            </div>
          </div>
        )}
        {!data.is_working_day && (
          <div className={`${styles.banner} ${styles.bannerNotice}`}>
            <span className={styles.bannerIcon}><Info size={17} /></span>
            <div className={styles.bannerBody}>
              <div className={styles.bannerHeadline}>Not a working day</div>
              <div className={styles.bannerDetail}>No report is expected for {formatDate(data.report_date)}. You can still file one if you worked.</div>
            </div>
          </div>
        )}
        {data.past_deadline && data.is_working_day && !leavePending && !leaveApproved && (
          <div className={`${styles.banner} ${styles.bannerWarning}`}>
            <span className={styles.bannerIcon}><Clock size={17} /></span>
            <div className={styles.bannerBody}>
              <div className={styles.bannerHeadline}>Past the deadline</div>
              <div className={styles.bannerDetail}>
                This report was due by {deadlineLabel}. You can still submit it — it will be recorded as submitted late. If you were on leave, raise a
                leave claim instead.
              </div>
            </div>
          </div>
        )}
      </div>

      {!data.template_configured ? (
        <div className={styles.noticePanel}>
          <div className={styles.noticeTitle}>No report format for your department yet</div>
          <p className={styles.noticeBody}>
            {data.employee.department_name || 'Your department'} does not have an approved daily report format, so nothing is expected from you —
            you will not receive reminders and no missed-report warnings will be recorded. An administrator can set a format in Daily Report
            Configuration.
          </p>
        </div>
      ) : (
        <>
          <div className={`${styles.sectionHead} ${styles.sectionHeadFlush}`}>
            <h2 className={styles.sectionTitle}>{data.template.label}</h2>
            <Button variant="ghost" icon={<CalendarOff size={15} />} onClick={() => setLeaveOpen(true)} disabled={leavePending || leaveApproved}>
              {leavePending ? 'Leave claim pending' : leaveApproved ? 'Leave approved' : 'I Was on Leave'}
            </Button>
          </div>
          <p className={styles.sectionHint}>{data.template.description}</p>

          <div className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`}>
            <DailyReportForm
              template={data.template}
              value={payload}
              onChange={updatePayload}
              issues={issues}
              reportDate={data.report_date}
            />

            <div className={styles.footerActions}>
              <Button variant="secondary" onClick={() => save('draft')} loading={saving === 'draft'} loadingLabel="Saving…" disabled={!!saving}>
                Save Draft
              </Button>
              <Button variant="primary" onClick={() => save('submit')} loading={saving === 'submit'} loadingLabel="Submitting…" disabled={!!saving}>
                {submitted ? 'Save Changes' : 'Submit Report'}
              </Button>
              <span className={styles.footerSpacer} />
              <span className={styles.savedHint}>
                {dirty
                  ? 'Unsaved changes.'
                  : submitted
                    ? `Submitted ${formatDateTime(data.report?.submitted_at ?? '')}. Edits keep the original submission time.`
                    : data.report
                      ? 'Draft saved. Only you can see a draft — it does not count as filed.'
                      : 'A draft is private to you. Submitting notifies your manager.'}
              </span>
            </div>
          </div>

          {data.report && data.revisions.length > 0 && (
            <>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Change history</h2>
              </div>
              <div className={historyStyles.tableWrap}>
                <table className={historyStyles.table}>
                  <thead>
                    <tr><th>When</th><th>Who</th><th>Action</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {data.revisions.map((revision) => (
                      <tr key={revision.id}>
                        <td>{formatDateTime(revision.at)}</td>
                        <td>{revision.actor_name || '—'}</td>
                        <td>{revision.action.replace(/_/g, ' ')}</td>
                        <td>{revision.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Recent reporting days</h2>
      </div>
      {data.history.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No reporting history yet" message="Days you file will appear here." />
      ) : (
        <div className={styles.historyStrip}>
          {data.history.map((item) => (
            <button
              key={item.report_date}
              type="button"
              className={`${styles.historyChip} ${item.report_date === data.report_date ? styles.historyChipActive : ''}`}
              onClick={() => {
                if (dirty) return toast.info('Save or discard your changes before changing the date.');
                load(item.report_date);
                onDateChange?.(item.report_date);
              }}
              aria-pressed={item.report_date === data.report_date}
            >
              <span className={styles.historyChipDay}>{weekday(item.report_date)}</span>
              <span className={styles.historyChipDate}>{formatDate(item.report_date)}</span>
              <span
                className={`${styles.historyDot} ${item.leave_status === 'APPROVED' ? styles.dotLeave : HISTORY_DOT[item.submission_status]}`}
                aria-hidden="true"
              />
              <span className={styles.historyChipDay}>
                {item.leave_status === 'APPROVED'
                  ? 'On leave'
                  : item.submission_status === 'MISSING'
                    ? item.warning_status === 'ACTIVE'
                      ? 'Warned'
                      : 'Missing'
                    : item.submission_status === 'SUBMITTED_LATE'
                      ? 'Late'
                      : item.submission_status === 'DRAFT'
                        ? 'Draft'
                        : 'Filed'}
              </span>
            </button>
          ))}
        </div>
      )}

      {leaveOpen && (
        <Modal
          title={`I was on leave — ${formatDate(data.report_date)}`}
          ariaLabel="Raise a leave claim for this reporting date"
          onClose={() => setLeaveOpen(false)}
          dismissible={!leaveSaving}
          footer={
            <>
              <ModalCancelButton onClick={() => setLeaveOpen(false)} disabled={leaveSaving}>Cancel</ModalCancelButton>
              <ModalOkButton onClick={raiseLeaveClaim} disabled={leaveSaving}>
                {leaveSaving ? 'Sending…' : 'Send to HR'}
              </ModalOkButton>
            </>
          }
        >
          <p className={styles.sectionHint}>
            HR will be notified and will approve or reject this. While it is pending, {formatDate(data.report_date)} is excluded from reminders and
            warnings. If a warning has already been recorded for this date, approval waives it.
          </p>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="leave-reason">Reason *</label>
            <Textarea
              id="leave-reason"
              rows={3}
              maxLength={2000}
              value={leaveReason}
              placeholder="e.g. Approved casual leave — travelling for a family function."
              onChange={(e) => setLeaveReason(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
