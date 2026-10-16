'use client';

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  History,
  Info,
  ShieldAlert
} from 'lucide-react';
import { DailyReportPayloadInput, EMPTY_PAYLOAD } from '@/lib/dailyReportTemplates';
import { DailyReportHistoryItem, MyDailyReportResponse } from '@/lib/dailyReportTypes';
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
// Draft and Submit stay two separate buttons and two separate requests —
// that is the whole point of the screen: a draft is private and does not
// satisfy the filing requirement, so "I saved it" and "I filed it" must
// never be the same gesture. The page states which it is at all times rather
// than leaving it to be inferred from a greyed-out button.
//
// Layout, in priority order rather than in the order the data happens to
// arrive: a command bar (what day, what status, how long left), the day
// strip immediately under it because it is navigation, ONE prioritised
// alert, then the form with an action bar that stays reachable.

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

const IST = 'Asia/Kolkata';

function formatDate(value: string): string {
  if (!value) return '—';
  try {
    return new Date(`${value}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST });
  } catch {
    return value;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    // Every timestamp this module shows is IST, matching the deadline it is
    // being compared against — a browser in another zone must not render a
    // different "submitted at" than the one the deadline was judged in.
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: IST });
  } catch {
    return iso;
  }
}

/** Today in IST — the picker's upper bound and the "Today" pill's test. */
function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function parts(value: string, opts: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  try {
    return new Date(`${value}T12:00:00+05:30`).toLocaleDateString('en-IN', { ...opts, timeZone: IST });
  } catch {
    return '';
  }
}

/** "Due in 3h 12m" / "Overdue by 2d 4h" — minute granularity is enough. */
function formatRemaining(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 60_000);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Server issue list -> { path: message } for the form renderer. */
function issuesToMap(issues: { path: string; message: string }[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues ?? []) map[issue.path] = issue.message;
  return map;
}

function payloadFromResponse(data: MyDailyReportResponse): DailyReportPayloadInput {
  // No draft saved yet today — still seed the matrix from auto_preview so
  // the Auto-badged cells show real numbers on the very first visit,
  // matching what a saved draft already gets from the server (see
  // buildMyDailyReport). Everything else starts blank, same as before.
  if (!data.report) return { header: {}, entries: data.gem_entries_preview ?? [], matrix: data.auto_preview ?? {} };
  return {
    header: data.report.payload ?? {},
    entries: data.report.entries.map((entry) => ({ ...entry.data })),
    matrix: (data.report.matrix ?? {}) as DailyReportPayloadInput['matrix']
  };
}

/** The dot colour and label one history day gets in the strip. */
function dayState(item: DailyReportHistoryItem): { dot: string; label: string } {
  if (item.leave_status === 'APPROVED') return { dot: styles.dotLeave, label: 'On leave' };
  switch (item.submission_status) {
    case 'SUBMITTED':
      return { dot: styles.dotSubmitted, label: 'Filed' };
    case 'SUBMITTED_LATE':
      return { dot: styles.dotLate, label: 'Late' };
    case 'DRAFT':
      return { dot: styles.dotDraft, label: 'Draft' };
    default:
      return { dot: styles.dotMissing, label: item.warning_status === 'ACTIVE' ? 'Warned' : 'Missing' };
  }
}

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
  // Drives the countdown only. 30s rather than 1s: the display is to the
  // minute, so a per-second tick would re-render the whole form sixty times
  // a minute to change nothing.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (forDate?: string) => {
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
  }, []);

  useEffect(() => {
    load(initialDate);
  }, [load, initialDate]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useAutoRefresh(() => load(date), { enabled: !dirty && !loading && !leaveOpen });

  const submitted = data?.report?.submission_status === 'SUBMITTED' || data?.report?.submission_status === 'SUBMITTED_LATE';
  const leavePending = data?.leave_claim?.status === 'PENDING';
  const leaveApproved = data?.leave_claim?.status === 'APPROVED';
  const leaveRejected = data?.leave_claim?.status === 'REJECTED';

  // Server-supplied, so "today" means the same thing here as it does to the
  // deadline engine. istToday() stays as the fallback for the brief window
  // before the first response lands.
  const today = data?.today || istToday();

  // Derived from the history the response already carries — no extra request.
  // Labelled "last 14 working days" rather than "this month" because that is
  // honestly what the window is; the month-scoped warning count stays in the
  // banner, where it is already accurate.
  const tally = useMemo(() => {
    const history = data?.history ?? [];
    return {
      onTime: history.filter((h) => h.submission_status === 'SUBMITTED').length,
      late: history.filter((h) => h.submission_status === 'SUBMITTED_LATE').length,
      missing: history.filter((h) => h.submission_status === 'MISSING' && h.leave_status !== 'APPROVED').length,
      leave: history.filter((h) => h.leave_status === 'APPROVED').length,
      total: history.length
    };
  }, [data?.history]);

  // Both come straight from the server, which resolves them with the same
  // working-day policy the deadline and warning engine uses — so the arrows
  // skip Sundays and holidays exactly as those do, and cannot drift from
  // them when an admin changes the working week.
  //
  // This replaced deriving them from the history array, which was broken:
  // the strip used to END at the selected date, so the selection was always
  // its newest entry, there was never a later day to step to, and the
  // forward arrow could never be enabled — you could walk into the past and
  // never come back.
  const prevDate = data?.prev_working_day || undefined;
  // '' when the next working day has not happened yet. This is what stops
  // the arrow walking into the future.
  const nextDate = data?.next_working_day || undefined;

  const deadlineMs = data ? new Date(data.deadline_at).getTime() : 0;
  const remainingMs = deadlineMs - now;

  function goToDate(next: string | undefined) {
    if (!next) return;
    if (dirty) {
      toast.info('Save or discard your changes before changing the date.');
      return;
    }
    load(next);
    onDateChange?.(next);
  }

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
          ? `The deadline (${formatDateTime(data.deadline_at)}) has passed, so this will be recorded as submitted late. Your manager will be notified.`
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
  const wrap = (node: ReactNode) =>
    embedded ? <>{node}</> : <AppShell title={title} subtitle={subtitle}>{node}</AppShell>;

  if (loading && !data) {
    return wrap(<div className={calcStyles.sectionPanel}><SkeletonRows rows={6} columns={3} /></div>);
  }

  if (loadFailed || !data) {
    return wrap(<ErrorState message={loadFailed || 'Could not load your daily report.'} onRetry={() => load(date)} />);
  }

  const banner = data.warnings.banner;
  const BannerIcon = BANNER_ICON[banner.tone];

  // ONE primary alert, chosen by severity, instead of the four-banner stack
  // the first cut could produce. Everything demoted still appears, as a chip.
  type Primary = { tone: keyof typeof BANNER_CLASS; icon: typeof Info; headline: string; detail: string } | null;
  const primary: Primary = leaveRejected
    ? {
        tone: 'warning',
        icon: AlertTriangle,
        headline: 'Leave claim rejected',
        detail: `${data.leave_claim?.decision_reason || 'No reason was recorded.'} The report for this date is still expected.`
      }
    : data.past_deadline && data.is_working_day && !leavePending && !leaveApproved
      ? {
          tone: 'warning',
          icon: Clock,
          headline: 'Past the deadline',
          detail: `This report was due by ${formatDateTime(data.deadline_at)}. You can still submit it — it will be recorded as submitted late. If you were on leave, raise a leave claim instead.`
        }
      : banner.tone === 'escalated' || banner.tone === 'warning'
        ? { tone: banner.tone, icon: BannerIcon, headline: banner.headline, detail: banner.detail }
        : null;

  const chips: { tone: string; icon: typeof Info; text: string }[] = [];
  if (leavePending) chips.push({ tone: styles.alertChipInfo, icon: Clock, text: 'Leave claim pending with HR — this date is excluded from reminders' });
  if (leaveApproved) chips.push({ tone: styles.alertChipSuccess, icon: CalendarOff, text: `Leave approved${data.leave_claim?.reviewed_by_name ? ` by ${data.leave_claim.reviewed_by_name}` : ''} — no report expected` });
  if (!data.is_working_day) chips.push({ tone: styles.alertChipInfo, icon: Info, text: 'Not a working day — no report expected, but you can still file one' });
  // The warning count only becomes a chip when it was NOT promoted to the
  // primary banner, so it is never stated twice.
  if (primary?.headline !== banner.headline && data.warnings.active_count > 0) {
    chips.push({
      tone: banner.tone === 'escalated' ? styles.alertChipDanger : styles.alertChipWarning,
      icon: ShieldAlert,
      text: banner.headline
    });
  }
  if (primary && data.past_deadline && leaveRejected) {
    chips.push({ tone: styles.alertChipWarning, icon: Clock, text: 'Past the deadline — submitting now records it as late' });
  }

  const statusBadge = submitted ? (
    <span className={`${styles.badge} ${data.report?.is_late ? styles.badgeLate : styles.badgeSubmitted}`}>
      {data.report?.is_late ? 'Submitted late' : 'Submitted'}
    </span>
  ) : data.report ? (
    <span className={`${styles.badge} ${styles.badgeDraft}`}>Draft — not filed</span>
  ) : leaveApproved ? (
    <span className={`${styles.badge} ${styles.badgeLeave}`}>On leave</span>
  ) : (
    <span className={`${styles.badge} ${styles.badgeMissing}`}>Not started</span>
  );

  const countdown = submitted
    ? { className: styles.countdownDone, text: data.report?.is_late ? 'Filed late' : 'Filed on time' }
    : !data.is_working_day
      ? { className: '', text: 'Not required' }
      : remainingMs <= 0
        ? { className: styles.countdownOver, text: `Overdue by ${formatRemaining(remainingMs)}` }
        : // Under two hours is when this stops being informational.
          { className: remainingMs < 2 * 60 * 60 * 1000 ? styles.countdownUrgent : '', text: `Due in ${formatRemaining(remainingMs)}` };

  return wrap(
    <>
      {/* ------------------------------------------------- command bar */}
      <div className={styles.commandBar}>
        <div className={styles.dateNav}>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => goToDate(prevDate)}
            disabled={!prevDate}
            aria-label="Previous working day"
            title={prevDate ? `Go to ${formatDate(prevDate)}` : 'No earlier day in your history'}
          >
            <ChevronLeft size={18} />
          </button>
          <div className={styles.dateBlock}>
            <div className={styles.dateHeadline}>
              {parts(data.report_date, { weekday: 'short' })}, {parts(data.report_date, { day: 'numeric', month: 'short' })}
              {/* The strip is anchored to today, so after a long jump with
                  the picker the selected date can sit outside it entirely.
                  One click back beats stepping forward a day at a time. */}
              {data.report_date === today ? (
                <span className={styles.dateToday}>Today</span>
              ) : (
                <button type="button" className={styles.todayBtn} onClick={() => goToDate(today)}>
                  Jump to today
                </button>
              )}
            </div>
            {/* Name and department both stay on the page even though this is
                the viewer's own report — a manager filing on someone's
                behalf and an employee checking they are looking at the right
                account both need it, and it is a stated requirement. */}
            <div className={styles.dateSub}>
              {data.employee.name}
              {data.employee.department_name ? ` · ${data.employee.department_name}` : ' · No department'}
              {data.template_configured ? ` · ${data.template.label}` : ''}
            </div>
          </div>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => goToDate(nextDate)}
            disabled={!nextDate}
            aria-label="Next working day"
            title={nextDate ? `Go to ${formatDate(nextDate)}` : 'This is your most recent working day'}
          >
            <ChevronRight size={18} />
          </button>
          <Input
            className={styles.datePicker}
            type="date"
            auto
            value={date}
            max={today}
            aria-label="Jump to a reporting date"
            onChange={(e) => goToDate(e.target.value)}
          />
        </div>

        <div className={styles.commandRight}>
          <div className={styles.commandStat}>
            <span className={styles.metaLabel}>Status</span>
            {statusBadge}
          </div>
          <div className={styles.commandStat}>
            <span className={styles.metaLabel}>{submitted ? 'Submitted' : 'Deadline'}</span>
            <span className={`${styles.countdown} ${countdown.className}`}>{countdown.text}</span>
            <span className={styles.dateSub}>
              {submitted ? formatDateTime(data.report?.submitted_at ?? '') : formatDateTime(data.deadline_at)}
            </span>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------- day strip */}
      {data.history.length > 0 && (
        <div className={styles.dayStrip} role="group" aria-label="Recent reporting days">
          {/* Oldest on the left, so it reads like a calendar rather than
              backwards — the response is newest-first. */}
          {[...data.history].reverse().map((item) => {
            const state = dayState(item);
            const active = item.report_date === data.report_date;
            return (
              <button
                key={item.report_date}
                type="button"
                className={`${styles.dayCell} ${active ? styles.dayCellActive : ''}`}
                onClick={() => goToDate(item.report_date)}
                aria-pressed={active}
                aria-label={`${formatDate(item.report_date)} — ${state.label}`}
                title={`${formatDate(item.report_date)} — ${state.label}`}
              >
                <span className={styles.dayCellDow}>{parts(item.report_date, { weekday: 'short' })}</span>
                <span className={styles.dayCellNum}>{parts(item.report_date, { day: 'numeric' })}</span>
                <span className={`${styles.dayCellDot} ${state.dot}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}

      {/* ---------------------------------------------- primary alert */}
      {primary && (
        <div className={`${styles.banner} ${BANNER_CLASS[primary.tone]}`} role={primary.tone === 'escalated' ? 'alert' : undefined}>
          <span className={styles.bannerIcon}><primary.icon size={17} /></span>
          <div className={styles.bannerBody}>
            <div className={styles.bannerHeadline}>{primary.headline}</div>
            <div className={styles.bannerDetail}>{primary.detail}</div>
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className={styles.alertChips}>
          {chips.map((chip, i) => (
            <span key={i} className={`${styles.alertChip} ${chip.tone}`}>
              <chip.icon size={13} aria-hidden="true" />
              {chip.text}
            </span>
          ))}
        </div>
      )}

      {/* --------------------------------------------------- the form */}
      {data.exempt ? (
        // Distinct from the "no format yet" panel below on purpose: one says
        // the department has nothing to file, the other says this person
        // specifically has been excused. Telling someone the wrong one sends
        // them to chase the wrong fix.
        <div className={styles.noticePanel}>
          <div className={styles.noticeTitle}>You are not required to file a daily report</div>
          <p className={styles.noticeBody}>
            Your account has been excused from daily reporting, so nothing is expected from you — you will not receive reminders and no
            missed-report warnings will be recorded. An administrator can change this under Daily Report Configuration.
          </p>
        </div>
      ) : !data.template_configured ? (
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
          {tally.total > 0 && (
            <div className={styles.miniStats}>
              <div className={`${styles.miniStat} ${styles.miniStatSuccess}`}>
                <span className={styles.miniStatValue}>{tally.onTime}</span>
                <span className={styles.miniStatLabel}>On time</span>
              </div>
              <div className={`${styles.miniStat} ${styles.miniStatWarning}`}>
                <span className={styles.miniStatValue}>{tally.late}</span>
                <span className={styles.miniStatLabel}>Late</span>
              </div>
              <div className={`${styles.miniStat} ${styles.miniStatDanger}`}>
                <span className={styles.miniStatValue}>{tally.missing}</span>
                <span className={styles.miniStatLabel}>Missing</span>
              </div>
              <div className={`${styles.miniStat} ${styles.miniStatInfo}`}>
                <span className={styles.miniStatValue}>{tally.leave}</span>
                <span className={styles.miniStatLabel}>On leave</span>
              </div>
              <div className={styles.miniStat}>
                <span className={styles.miniStatValue}>{data.warnings.active_count}/{data.warnings.threshold}</span>
                <span className={styles.miniStatLabel}>Warnings · {data.warnings.month_key}</span>
              </div>
            </div>
          )}

          <div className={`${styles.sectionHead} ${styles.sectionHeadFlush}`}>
            <h2 className={styles.sectionTitle}>{data.template.label}</h2>
            <Button variant="ghost" icon={<CalendarOff size={15} />} onClick={() => setLeaveOpen(true)} disabled={leavePending || leaveApproved}>
              {leavePending ? 'Leave claim pending' : leaveApproved ? 'Leave approved' : 'I Was on Leave'}
            </Button>
          </div>
          <p className={styles.sectionHint}>
            {data.template.description} The last {tally.total} working days are shown above — {tally.onTime} on time, {tally.late} late,{' '}
            {tally.missing} missing.
          </p>

          <div className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`}>
            <DailyReportForm
              template={data.template}
              value={payload}
              onChange={updatePayload}
              issues={issues}
              reportDate={data.report_date}
            />
          </div>

          {/* Sticky, because a ten-entry report put Submit a long scroll
              away from wherever you were typing. */}
          <div className={`${styles.stickyActions} ${dirty ? styles.stickyActionsDirty : ''}`}>
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

          {/* Collapsed: useful when something looks wrong, noise otherwise. */}
          {data.report && data.revisions.length > 0 && (
            <details className={styles.detailsBlock}>
              <summary className={styles.detailsSummary}>
                <History size={15} />
                Change history
                <span className={styles.detailsCount}>({data.revisions.length})</span>
              </summary>
              <div className={styles.detailsBody}>
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
              </div>
            </details>
          )}

          {data.warnings.warnings.length > 0 && (
            <details className={styles.detailsBlock}>
              <summary className={styles.detailsSummary}>
                <ShieldAlert size={15} />
                Missed-report warnings this month
                <span className={styles.detailsCount}>
                  ({data.warnings.active_count} active{data.warnings.waived_count > 0 ? `, ${data.warnings.waived_count} waived` : ''})
                </span>
              </summary>
              <div className={styles.detailsBody}>
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
              </div>
            </details>
          )}
        </>
      )}

      {data.history.length === 0 && (
        <EmptyState icon={ClipboardList} title="No reporting history yet" message="Days you file will appear here." />
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
