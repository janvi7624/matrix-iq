'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarOff, CheckCircle2, Paperclip, ShieldAlert, XCircle } from 'lucide-react';
import { DailyReportLeaveClaimRecord, DailyReportWarningGroup } from '@/lib/dailyReportTypes';
import { earlierActiveWarnings, finalActiveWarning, finalWarningHeadline } from '@/lib/dailyReportWarningView';
import AppShell from './AppShell';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './dailyReport.module.css';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import FilterBar from './ui/FilterBar';
import StatTile from './ui/StatTile';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { SegmentedButton } from './ui/SegmentedToggle';
import { useToast } from './ui/ToastProvider';
import { useAutoRefresh } from '@/lib/useAutoRefresh';

// HR Daily Report Review — two tabs, because HR does two distinct jobs here:
// decide leave exemptions, and review or waive missed-report warnings.
//
// Both decisions require a written reason, and nothing is ever deleted: a
// waived warning stays on screen, struck through and attributed, and is only
// excluded from the active count that drives escalation. That is both the
// stated requirement and what makes the record defensible months later.

type Tab = 'leave' | 'warnings';

function formatDate(value: string): string {
  if (!value) return '—';
  try {
    return new Date(`${value}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  } catch {
    return value;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  } catch {
    return iso;
  }
}

function istMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}

const PATTERN_LABEL: Record<string, string> = {
  none: '—',
  single: 'One day',
  consecutive: 'Consecutive days',
  scattered: 'Scattered days'
};

interface ClaimDialog {
  claim: DailyReportLeaveClaimRecord;
  decision: 'APPROVED' | 'REJECTED';
}

interface WaiveDialog {
  warningId: string;
  employeeName: string;
  reportDate: string;
}

export default function HrDailyReportReviewView({ initialTab }: { initialTab?: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialTab === 'warnings' ? 'warnings' : 'leave');

  const [claimStatus, setClaimStatus] = useState('PENDING');
  const [claimSearch, setClaimSearch] = useState('');
  const [claims, setClaims] = useState<DailyReportLeaveClaimRecord[]>([]);
  const [claimTotal, setClaimTotal] = useState(0);

  const [month, setMonth] = useState(istMonth());
  // Defaults to the people who have reached the threshold, because that is
  // the only group this tab can act on. Showing everyone with a single
  // missed report put a person on warning 1 of 4 next to a person who had
  // run out of them, which buried the ones needing a decision.
  const [warningView, setWarningView] = useState('escalated');
  const [actionDialog, setActionDialog] = useState<{ escalationId: string; employeeName: string; monthKey: string } | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [warningSearch, setWarningSearch] = useState('');
  const [groups, setGroups] = useState<DailyReportWarningGroup[]>([]);
  const [threshold, setThreshold] = useState(3);

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState('');
  const [claimDialog, setClaimDialog] = useState<ClaimDialog | null>(null);
  const [waiveDialog, setWaiveDialog] = useState<WaiveDialog | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed('');
    try {
      if (tab === 'leave') {
        const params = new URLSearchParams();
        if (claimStatus) params.set('status', claimStatus);
        if (claimSearch.trim()) params.set('search', claimSearch.trim());
        const response = await fetch(`/api/daily-reports/hr/leave-claims?${params.toString()}`);
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
        setClaims(body.claims ?? []);
        setClaimTotal(body.total ?? 0);
      } else {
        const params = new URLSearchParams({ month, view: warningView });
        if (warningSearch.trim()) params.set('search', warningSearch.trim());
        const response = await fetch(`/api/daily-reports/hr/warnings?${params.toString()}`);
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
        setGroups(body.groups ?? []);
        setThreshold(body.threshold ?? 3);
      }
    } catch (error) {
      setLoadFailed(error instanceof Error ? error.message : 'Could not load this page.');
    } finally {
      setLoading(false);
    }
  }, [tab, claimStatus, claimSearch, month, warningView, warningSearch]);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(load, { enabled: !claimDialog && !waiveDialog && !loading });

  async function decideClaim() {
    if (!claimDialog) return;
    if (!reason.trim()) return toast.error('Record a reason for this decision.');
    setSaving(true);
    try {
      const response = await fetch(`/api/daily-reports/hr/leave-claims/${claimDialog.claim.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: claimDialog.decision, reason: reason.trim() })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not record this decision (${response.status})`);
      setClaimDialog(null);
      setReason('');
      await load();
      toast.success(
        claimDialog.decision === 'APPROVED'
          ? body?.waivedWarningId
            ? 'Leave approved, and the warning already recorded for that date has been waived.'
            : 'Leave approved. That date is exempt.'
          : body?.rejectionOutcome === 'waived'
            ? 'Leave rejected, and the reporting obligation for that date has been waived per policy.'
            : 'Leave rejected. The report for that date is still expected.'
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record this decision.');
    } finally {
      setSaving(false);
    }
  }

  async function waive() {
    if (!waiveDialog) return;
    if (!reason.trim()) return toast.error('A reason is required to waive a warning.');
    setSaving(true);
    try {
      const response = await fetch(`/api/daily-reports/hr/warnings/${waiveDialog.warningId}/waive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not waive this warning (${response.status})`);
      setWaiveDialog(null);
      setReason('');
      await load();
      toast.success('Warning waived. It stays in the history but no longer counts towards escalation.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not waive this warning.');
    } finally {
      setSaving(false);
    }
  }

  // Clearing an escalation is NOT waiving a warning — HR may well decide the
  // warnings stand. This records that they dealt with it, and is what stops
  // the two-day reminders going to the HR manager.
  async function recordAction() {
    if (!actionDialog) return;
    if (!actionNote.trim()) return toast.error('Record what action was taken.');
    setSaving(true);
    try {
      const response = await fetch(`/api/daily-reports/hr/escalations/${actionDialog.escalationId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: actionNote.trim() })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not record this action (${response.status})`);
      setActionDialog(null);
      setActionNote('');
      await load();
      toast.success('Action recorded. The HR manager will no longer be reminded about this one.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record this action.');
    } finally {
      setSaving(false);
    }
  }

  const title = 'Daily Report Review';
  const subtitle = 'HR › leave claims and missed-report warnings.';

  const pendingCount = claims.filter((claim) => claim.status === 'PENDING').length;
  const escalatedGroups = groups.filter((group) => group.hr_escalated).length;
  const totalActive = groups.reduce((sum, group) => sum + group.active_warnings, 0);

  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className={styles.tabRow} role="tablist" aria-label="Daily report review sections">
        <SegmentedButton active={tab === 'leave'} onClick={() => setTab('leave')} role="tab" aria-selected={tab === 'leave'}>
          Leave Claims
        </SegmentedButton>
        <SegmentedButton active={tab === 'warnings'} onClick={() => setTab('warnings')} role="tab" aria-selected={tab === 'warnings'}>
          Warnings
        </SegmentedButton>
      </div>

      {loadFailed ? (
        <ErrorState message={loadFailed} onRetry={load} />
      ) : tab === 'leave' ? (
        <>
          <FilterBar>
            <Select auto value={claimStatus} onChange={(e) => setClaimStatus(e.target.value)} aria-label="Claim status">
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="">All</option>
            </Select>
            <input type="text" value={claimSearch} placeholder="Search employee…" onChange={(e) => setClaimSearch(e.target.value)} aria-label="Search employee" />
          </FilterBar>

          <div className={styles.kpiRow}>
            <StatTile value={claimTotal} label="Claims in this view" />
            <StatTile value={pendingCount} label="Awaiting your decision" tone={pendingCount ? 'warning' : 'default'} />
          </div>

          {loading && !claims.length ? (
            <div className={historyStyles.tableWrap}><SkeletonRows rows={5} columns={6} /></div>
          ) : claims.length === 0 ? (
            <EmptyState
              icon={CalendarOff}
              title={claimStatus === 'PENDING' ? 'No leave claims awaiting a decision' : 'No leave claims match this filter'}
              message="When an employee marks a reporting date as leave, the claim appears here for approval."
            />
          ) : (
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Reporting date</th>
                    <th>Reason</th>
                    <th>Submitted at</th>
                    <th>Status</th>
                    <th>Reviewed by</th>
                    <th>Decision reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr key={claim.id}>
                      <td>{claim.employee_name}</td>
                      <td>{claim.department_name || '—'}</td>
                      <td>{formatDate(claim.report_date)}</td>
                      <td>
                        {claim.reason}
                        {claim.attachments.length > 0 && (
                          <div className={calcStyles.small}>
                            {claim.attachments.map((attachment) => (
                              <a
                                key={attachment.path}
                                href={`/api/uploads/file/${attachment.path}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={historyStyles.linkButtonSmall}
                              >
                                <Paperclip size={12} /> {attachment.name}
                              </a>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{formatDateTime(claim.created_at)}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            claim.status === 'APPROVED' ? styles.badgeSubmitted : claim.status === 'REJECTED' ? styles.badgeMissing : styles.badgeLeave
                          }`}
                        >
                          {claim.status.toLowerCase()}
                        </span>
                      </td>
                      <td>{claim.reviewed_by_name || '—'}</td>
                      <td>{claim.decision_reason || '—'}</td>
                      <td>
                        {claim.status === 'PENDING' ? (
                          <div className={historyStyles.rowActionsInline}>
                            <button
                              type="button"
                              className={`${historyStyles.rowAction} ${historyStyles.rowActionPrimary}`}
                              onClick={() => {
                                setReason('');
                                setClaimDialog({ claim, decision: 'APPROVED' });
                              }}
                            >
                              <CheckCircle2 size={14} /> Approve
                            </button>
                            <button
                              type="button"
                              className={`${historyStyles.rowAction} ${historyStyles.rowActionDanger}`}
                              onClick={() => {
                                setReason('');
                                setClaimDialog({ claim, decision: 'REJECTED' });
                              }}
                            >
                              <XCircle size={14} /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className={calcStyles.small}>Decided {formatDateTime(claim.reviewed_at)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <FilterBar>
            <Input type="month" auto value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Reporting month" />
            <Select auto value={warningView} onChange={(e) => setWarningView(e.target.value)} aria-label="Warning view">
              <option value="escalated">Needs action — final warning reached</option>
              <option value="active">Everyone with any active warning</option>
              <option value="all">All, including fully waived</option>
            </Select>
            <input type="text" value={warningSearch} placeholder="Search employee…" onChange={(e) => setWarningSearch(e.target.value)} aria-label="Search employee" />
          </FilterBar>

          <div className={styles.kpiRow}>
            <StatTile
              value={groups.length}
              label={warningView === 'escalated' ? 'Needing your action' : 'Employees in this view'}
              tone={warningView === 'escalated' && groups.length ? 'danger' : 'default'}
            />
            <StatTile value={totalActive} label="Active warnings" tone={totalActive ? 'danger' : 'default'} />
            <StatTile value={escalatedGroups} label="Escalated to HR" tone={escalatedGroups ? 'warning' : 'default'} />
            <StatTile value={threshold} label="Escalation threshold" />
          </div>

          {loading && !groups.length ? (
            <div className={calcStyles.sectionPanel}><SkeletonRows rows={4} columns={3} /></div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title={warningView === 'escalated' ? 'Nobody has reached the warning limit this month' : 'No missed-report warnings for this month'}
              message={
                warningView === 'escalated'
                  ? `Nothing needs your decision. Employees below ${threshold} warnings are not shown here — switch the filter above to see them.`
                  : 'Warnings are recorded when a reporting deadline passes with no report and no leave claim.'
              }
            />
          ) : (
            groups.map((group) => (
              <div className={styles.groupCard} key={`${group.employee_id}-${group.month_key}`}>
                <div className={styles.groupHead}>
                  <div>
                    <div className={styles.groupTitle}>
                      {group.employee_name}
                      {group.hr_escalated && (
                        <>
                          {' '}
                          <span className={`${styles.badge} ${styles.badgeMissing}`}>
                            {group.hr_action_taken_at ? 'Actioned' : 'Action pending'}
                          </span>
                        </>
                      )}
                    </div>
                    {/* The counts moved to the final-warning headline and the
                        collapsed waived summary — stating "4 of 4" three
                        times on one card is the noise this tab had. */}
                    <div className={styles.groupMeta}>
                      {group.department_name || '—'} · {group.month_key} · {PATTERN_LABEL[group.pattern] ?? group.pattern}
                      {group.hr_escalated_at && ` · escalated ${formatDateTime(group.hr_escalated_at)}`}
                    </div>
                  </div>
                </div>
                {/* The one warning HR is being asked about, on its own. The
                    run-up to it is still reachable below, because waiving an
                    EARLIER date is how an employee is brought back under the
                    threshold — but it is context, not the headline. */}
                {(() => {
                  const final = finalActiveWarning(group.warnings);
                  const earlier = earlierActiveWarnings(group.warnings);
                  if (!final) {
                    return (
                      <div className={styles.groupMeta}>
                        Every warning this month has been waived — nothing to action.
                      </div>
                    );
                  }
                  return (
                    <>
                      <div className={styles.dateChips}>
                        <span className={styles.groupMeta}>{finalWarningHeadline(group, threshold)}</span>
                        <button
                          type="button"
                          className={styles.dateChip}
                          onClick={() => {
                            setReason('');
                            setWaiveDialog({ warningId: final.id, employeeName: group.employee_name, reportDate: final.report_date });
                          }}
                        >
                          {formatDate(final.report_date)} · waive
                        </button>
                      </div>
                      {earlier.length > 0 && (
                        <details className={styles.detailsBlock}>
                          <summary className={styles.detailsSummary}>
                            {earlier.length} earlier {earlier.length === 1 ? 'warning' : 'warnings'} this month
                          </summary>
                          <div className={styles.dateChips}>
                            {earlier.map((warning) => (
                              <button
                                key={warning.id}
                                type="button"
                                className={styles.dateChip}
                                onClick={() => {
                                  setReason('');
                                  setWaiveDialog({ warningId: warning.id, employeeName: group.employee_name, reportDate: warning.report_date });
                                }}
                              >
                                {formatDate(warning.report_date)} · waive
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                    </>
                  );
                })()}
                {/* The escalation's own state, which is separate from the
                    warnings: HR can decide the warnings STAND and still have
                    acted. Recording that is what stops the manager chases. */}
                {group.hr_escalated && group.escalation_id && (
                  group.hr_action_taken_at ? (
                    <div className={styles.groupMeta}>
                      Actioned{group.hr_action_by_name ? ` by ${group.hr_action_by_name}` : ''} on {formatDateTime(group.hr_action_taken_at)}
                      {group.hr_action_note ? ` — ${group.hr_action_note}` : ''}
                    </div>
                  ) : (
                    <div className={styles.dateChips}>
                      <span className={styles.groupMeta}>
                        HR action pending{group.hr_escalated_at ? ` since ${formatDateTime(group.hr_escalated_at)}` : ''}
                        {group.hr_reminders_sent > 0 &&
                          ` · manager reminded ${group.hr_reminders_sent}×`}
                      </span>
                      <button
                        type="button"
                        className={styles.dateChip}
                        onClick={() => {
                          setActionNote('');
                          setActionDialog({ escalationId: group.escalation_id, employeeName: group.employee_name, monthKey: group.month_key });
                        }}
                      >
                        Record action
                      </button>
                    </div>
                  )
                )}

                {/* Already dealt with, so also collapsed — kept because
                    "who waived this and why" is the first question asked
                    when a waiver is queried later. */}
                {group.waived_warnings > 0 && (
                  <details className={styles.detailsBlock}>
                    <summary className={styles.detailsSummary}>
                      {group.waived_warnings} waived this month
                    </summary>
                    <ul className={styles.inlineList}>
                      {group.warnings
                        .filter((warning) => warning.status === 'WAIVED')
                        .map((warning) => (
                          <li key={warning.id}>
                            {formatDate(warning.report_date)} waived{warning.waived_by_name ? ` by ${warning.waived_by_name}` : ''}
                            {warning.waived_at ? ` on ${formatDateTime(warning.waived_at)}` : ''}
                            {warning.waiver_reason ? ` — ${warning.waiver_reason}` : ''}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </div>
            ))
          )}
        </>
      )}

      {claimDialog && (
        <Modal
          title={`${claimDialog.decision === 'APPROVED' ? 'Approve' : 'Reject'} leave claim — ${claimDialog.claim.employee_name}`}
          ariaLabel="Record a decision on this leave claim"
          onClose={() => setClaimDialog(null)}
          dismissible={!saving}
          footer={
            <>
              <ModalCancelButton onClick={() => setClaimDialog(null)} disabled={saving}>Cancel</ModalCancelButton>
              <ModalOkButton onClick={decideClaim} disabled={saving}>
                {saving ? 'Recording…' : claimDialog.decision === 'APPROVED' ? 'Approve' : 'Reject'}
              </ModalOkButton>
            </>
          }
        >
          <p className={styles.sectionHint}>
            {formatDate(claimDialog.claim.report_date)} · {claimDialog.claim.reason}
          </p>
          <p className={styles.sectionHint}>
            {claimDialog.decision === 'APPROVED'
              ? 'Approving exempts this reporting date and waives any missed-report warning already recorded for it.'
              : 'Rejecting means the report for this date is expected again. Whether a warning is then recorded follows the rejection policy set in Daily Report Configuration — no backdated warning is created here.'}
          </p>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="decision-reason">Reason *</label>
            <Textarea
              id="decision-reason"
              rows={3}
              maxLength={2000}
              value={reason}
              placeholder={claimDialog.decision === 'APPROVED' ? 'e.g. Approved sick leave on record for this date.' : 'e.g. No leave was approved for this date.'}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </Modal>
      )}

      {actionDialog && (
        <Modal
          title={`Record HR action — ${actionDialog.employeeName}, ${actionDialog.monthKey}`}
          ariaLabel="Record the action HR took on this escalation"
          onClose={() => setActionDialog(null)}
          dismissible={!saving}
          footer={
            <>
              <ModalCancelButton onClick={() => setActionDialog(null)} disabled={saving}>Cancel</ModalCancelButton>
              <ModalOkButton onClick={recordAction} disabled={saving || !actionNote.trim()}>
                {saving ? 'Saving…' : 'Record Action'}
              </ModalOkButton>
            </>
          }
        >
          <div className={`${styles.banner} ${styles.bannerNotice}`}>
            <span className={styles.bannerIcon}><ShieldAlert size={17} /></span>
            <div className={styles.bannerBody}>
              <div className={styles.bannerHeadline}>This closes the escalation, not the warnings</div>
              <div className={styles.bannerDetail}>
                The warnings stay exactly as they are — waive them separately if that is the right call. Recording an action here says HR
                has dealt with it, and stops the reminders to the HR manager.
              </div>
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="hr-action-note">
              What was done <span className={calcStyles.small}>(required)</span>
            </label>
            <Textarea
              id="hr-action-note"
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Spoken to him and his manager on 31 Oct; reports to be filed daily from Monday"
              disabled={saving}
            />
          </div>
        </Modal>
      )}

      {waiveDialog && (
        <Modal
          title={`Waive warning — ${waiveDialog.employeeName}, ${formatDate(waiveDialog.reportDate)}`}
          ariaLabel="Waive a missed-report warning"
          onClose={() => setWaiveDialog(null)}
          dismissible={!saving}
          footer={
            <>
              <ModalCancelButton onClick={() => setWaiveDialog(null)} disabled={saving}>Cancel</ModalCancelButton>
              <ModalOkButton onClick={waive} disabled={saving}>{saving ? 'Waiving…' : 'Waive Warning'}</ModalOkButton>
            </>
          }
        >
          <p className={styles.sectionHint}>
            The warning stays visible in this employee&apos;s history, marked as waived and attributed to you, and stops counting towards the HR
            escalation threshold. Warnings are never deleted.
          </p>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="waive-reason">Reason *</label>
            <Textarea
              id="waive-reason"
              rows={3}
              maxLength={2000}
              value={reason}
              placeholder="e.g. Employee was on approved leave; claim raised late."
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </Modal>
      )}

      <div className={styles.footerActions}>
        <Button variant="ghost" onClick={load} disabled={loading}>Refresh</Button>
      </div>
    </AppShell>
  );
}
