'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PublicUser } from '@/lib/types';
import AppShell from '@/components/AppShell';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import pageStyles from './performanceReviewPage.module.css';
import { reviewScopeNote, reviewSectionsFor } from '@/lib/performanceReviewScope';

interface PerformanceReview {
  user: { username: string; name: string; department: string; designation: string; employeeId: string; joiningDate: string; role: string };
  crm: { totalLeads: number; qualifiedLeads: number; lostLeads: number; wonLeads: number; unattendedLeads: number };
  sales: { quotationsCreated: number; quotationsRevised: number; quotationsConverted: number };
  projects: { activeProjects: number; completedProjects: number };
  siteVisits: { total: number };
  demo: { scheduled: number; completed: number; cancelled: number };
  followUps: { pending: number; completed: number; overdue: number };
  dc: { pending: number; closed: number };
  customerResponse: { positive: number; negative: number; pending: number };
  tasks: { total: number; completed: number; pending: number };
  generalTasks: { total: number; completed: number; pending: number; declined: number; reworkRequired: number };
  marketing: { raised: number; assigned: number; completed: number; open: number; overdue: number };
  timeline: { at: string; action: string; remarks: string }[];
  charts: { weekly: { bucket: string; count: number }[]; monthly: { bucket: string; count: number }[]; yearly: { bucket: string; count: number }[] };
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function MetricGroup({ title, items }: { title: string; items: { label: string; value: number }[] }) {
  return (
    <>
      <div className={historyStyles.navGroupLabel}>{title}</div>
      <div className={historyStyles.summaryCardGrid}>
        {items.map((item) => (
          <div key={item.label} className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>{item.label}</div>
            <div className={`${historyStyles.summaryCardValue} ${pageStyles.metricValueLg}`}>{item.value}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function TrendChart({ title, data }: { title: string; data: { bucket: string; count: number }[] }) {
  return (
    <div className={`${calcStyles.sectionPanel} ${pageStyles.chartPanel}`}>
      <div className={pageStyles.chartTitle}>{title}</div>
      {data.length === 0 ? (
        <div className={calcStyles.small}>No activity recorded yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#dc2626" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

async function exportReviewPdf(review: PerformanceReview) {
  // Scoped identically to the page. A PDF listing a sales block the screen
  // never showed would be the version that gets forwarded to the employee.
  const shown = new Set(reviewSectionsFor(review.user));
  const [{ default: jsPDF }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF();
  let y = 16;

  doc.setFontSize(16);
  doc.text(`Performance Review — ${review.user.name}`, 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(`${review.user.designation || '-'} · ${review.user.department || '-'} · Generated ${new Date().toLocaleString('en-IN')}`, 14, y);
  y += 10;

  const section = (title: string, rows: [string, string | number][]) => {
    doc.setFontSize(12);
    doc.text(title, 14, y);
    y += 4;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).autoTable({ startY: y, head: [['Metric', 'Value']], body: rows, theme: 'striped', headStyles: { fillColor: [220, 38, 38] }, margin: { left: 14, right: 14 }, styles: { fontSize: 9 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 10;
  };

  if (shown.has('crm')) {
    section('CRM Metrics', [
      ['Total Leads', review.crm.totalLeads],
      ['Qualified Leads', review.crm.qualifiedLeads],
      ['Lost Leads', review.crm.lostLeads],
      ['Won Leads', review.crm.wonLeads],
      ['Unattended Leads', review.crm.unattendedLeads]
    ]);
  }
  if (shown.has('sales')) {
    section('Sales Metrics', [
      ['Quotations Created', review.sales.quotationsCreated],
      ['Quotations Revised', review.sales.quotationsRevised],
      ['Quotations Converted', review.sales.quotationsConverted]
    ]);
  }
  if (shown.has('projects') || shown.has('siteVisits') || shown.has('demo')) {
    section('Projects / Site Visits / Demo', [
      ...(shown.has('projects') ? [['Active Projects', review.projects.activeProjects], ['Completed Projects', review.projects.completedProjects]] as [string, number][] : []),
      ...(shown.has('siteVisits') ? [['Total Site Visits', review.siteVisits.total]] as [string, number][] : []),
      ...(shown.has('demo') ? [['Demos Scheduled', review.demo.scheduled], ['Demos Completed', review.demo.completed], ['Demos Cancelled', review.demo.cancelled]] as [string, number][] : [])
    ]);
  }
  if (shown.has('followUps') || shown.has('dc') || shown.has('customerResponse')) {
    section('Follow-ups / DC / Customer Response', [
      ...(shown.has('followUps') ? [['Follow-ups Pending', review.followUps.pending], ['Follow-ups Completed', review.followUps.completed], ['Follow-ups Overdue', review.followUps.overdue]] as [string, number][] : []),
      ...(shown.has('dc') ? [['DC Pending', review.dc.pending], ['DC Closed', review.dc.closed]] as [string, number][] : []),
      ...(shown.has('customerResponse') ? [['Customer Response Positive', review.customerResponse.positive], ['Customer Response Negative', review.customerResponse.negative], ['Customer Response Pending', review.customerResponse.pending]] as [string, number][] : [])
    ]);
  }
  if (shown.has('tms')) {
    section('TMS Tasks', [
      ['Total Assigned', review.tasks.total],
      ['Completed', review.tasks.completed],
      ['Open', review.tasks.pending]
    ]);
  }
  if (shown.has('marketing')) {
    section('Marketing Requests', [
      ['Raised', review.marketing.raised],
      ['Assigned', review.marketing.assigned],
      ['Completed', review.marketing.completed],
      ['Open', review.marketing.open],
      ['Overdue', review.marketing.overdue]
    ]);
  }
  if (shown.has('tasks')) {
    section('Planner Tasks', [
      ['Total Assigned', review.generalTasks.total],
      ['Completed', review.generalTasks.completed],
      ['Open', review.generalTasks.pending],
      ['Declined', review.generalTasks.declined],
      ['Rework Required', review.generalTasks.reworkRequired]
    ]);
  }

  doc.setFontSize(12);
  doc.text('Recent Activity Timeline', 14, y);
  y += 4;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    startY: y,
    head: [['Date', 'Action', 'Remarks']],
    body: review.timeline.slice(0, 25).map((t) => [formatDateTime(t.at), t.action, t.remarks || '-']),
    theme: 'striped',
    headStyles: { fillColor: [220, 38, 38] },
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8 }
  });

  doc.save(`performance-review-${review.user.username}.pdf`);
}

function PerformanceReviewPageContent() {
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<PublicUser[]>([]);
  // Lets a profile page (app/admin/users/[id]) deep-link straight into one
  // employee's review via ?user=<username> instead of the manual dropdown.
  const [selected, setSelected] = useState(() => searchParams.get('user') || '');
  const [review, setReview] = useState<PerformanceReview | null>(null);
  const [status, setStatus] = useState('');

  // Which measures apply to the employee currently selected. Derived on every
  // render rather than stored, so it can never lag behind the loaded review
  // the way a second piece of state would.
  const sections = review ? reviewSectionsFor(review.user) : [];
  const shows = (section: string) => sections.includes(section as (typeof sections)[number]);
  const scopeNote = review ? reviewScopeNote(review.user) : '';

  useEffect(() => {
    fetch('/api/admin/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PublicUser[]) => setUsers(data))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!selected) {
      setReview(null);
      return;
    }
    setStatus('Loading review…');
    setReview(null);
    fetch(`/api/admin/performance-review/${selected}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PerformanceReview | null) => {
        setReview(data);
        setStatus(data ? '' : 'Could not load this employee’s review.');
      })
      .catch(() => setStatus('Could not reach the server.'));
  }, [selected]);

  return (
    <AppShell title="Performance Review" subtitle="Administration › a full performance dashboard for one employee at a time.">
        <div className={historyStyles.toolbar}>
          <select className={`${calcStyles.formControl} ${pageStyles.employeeSelect}`} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">-- Select employee --</option>
            {users.map((u) => (
              <option key={u.id} value={u.username}>{u.name} ({u.username}) — {u.designation || u.role}</option>
            ))}
          </select>
          {review && (
            <>
              <button type="button" className={historyStyles.button} onClick={() => exportReviewPdf(review)}>Export Review (PDF)</button>
              <button type="button" className={historyStyles.button} onClick={() => window.print()}>Print Review</button>
            </>
          )}
        </div>
        {status && <div className={historyStyles.status}>{status}</div>}

        {review && (
          <>
            <div className={`${historyStyles.detailPanel} ${calcStyles.mt14}`}>
              <div className={`${historyStyles.navGroupLabel} ${calcStyles.h2Flush}`}>General Information</div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}><label className={calcStyles.label}>Employee Name</label><div className={calcStyles.small}>{review.user.name}</div></div>
                <div className={calcStyles.field}><label className={calcStyles.label}>Department</label><div className={calcStyles.small}>{review.user.department || '-'}</div></div>
                <div className={calcStyles.field}><label className={calcStyles.label}>Designation</label><div className={calcStyles.small}>{review.user.designation || '-'}</div></div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}><label className={calcStyles.label}>Reporting Manager</label><div className={calcStyles.small}>Not tracked yet</div></div>
                <div className={calcStyles.field}><label className={calcStyles.label}>Joining Date</label><div className={calcStyles.small}>{formatDate(review.user.joiningDate)}</div></div>
                <div className={calcStyles.field}><label className={calcStyles.label}>Employee ID</label><div className={calcStyles.small}>{review.user.employeeId || '-'}</div></div>
              </div>
            </div>

            {/* Which measures apply to this person — an engineer reviewed on
                "Quotations Created: 0" reads as underperformance rather than
                as a metric that was never theirs. See
                lib/performanceReviewScope.ts. */}
            {scopeNote && <div className={historyStyles.status}>{scopeNote}</div>}

            {shows('crm') && (
              <MetricGroup title="CRM Metrics" items={[
                { label: 'Total Leads', value: review.crm.totalLeads },
                { label: 'Qualified Leads', value: review.crm.qualifiedLeads },
                { label: 'Lost Leads', value: review.crm.lostLeads },
                { label: 'Won Leads', value: review.crm.wonLeads },
                { label: 'Unattended Leads', value: review.crm.unattendedLeads }
              ]} />
            )}
            {shows('sales') && (
              <MetricGroup title="Sales Metrics" items={[
                { label: 'Quotations Created', value: review.sales.quotationsCreated },
                { label: 'Quotations Revised', value: review.sales.quotationsRevised },
                { label: 'Quotations Converted', value: review.sales.quotationsConverted }
              ]} />
            )}
            {shows('projects') && (
              <MetricGroup title="Projects" items={[
                { label: 'Active Projects', value: review.projects.activeProjects },
                { label: 'Completed Projects', value: review.projects.completedProjects }
              ]} />
            )}

            {/* TMS tasks were assembled by the API but never rendered here,
                which left a technical person's review with nothing of their
                actual work on it. */}
            {shows('tms') && (
              <MetricGroup title="TMS Tasks" items={[
                { label: 'Total Assigned', value: review.tasks.total },
                { label: 'Completed', value: review.tasks.completed },
                { label: 'Open', value: review.tasks.pending }
              ]} />
            )}
            {shows('marketing') && (
              <MetricGroup title="Marketing Requests" items={[
                { label: 'Raised', value: review.marketing.raised },
                { label: 'Assigned', value: review.marketing.assigned },
                { label: 'Completed', value: review.marketing.completed },
                { label: 'Open', value: review.marketing.open },
                { label: 'Overdue', value: review.marketing.overdue }
              ]} />
            )}
            {shows('tasks') && (
              <MetricGroup title="Planner Tasks" items={[
                { label: 'Total Assigned', value: review.generalTasks.total },
                { label: 'Completed', value: review.generalTasks.completed },
                { label: 'Open', value: review.generalTasks.pending },
                { label: 'Declined', value: review.generalTasks.declined },
                { label: 'Rework Required', value: review.generalTasks.reworkRequired }
              ]} />
            )}
            {shows('siteVisits') && (
              <MetricGroup title="Site Visits" items={[{ label: 'Total Site Visits', value: review.siteVisits.total }]} />
            )}
            {shows('demo') && (
              <MetricGroup title="Demo" items={[
                { label: 'Scheduled', value: review.demo.scheduled },
                { label: 'Completed', value: review.demo.completed },
                { label: 'Cancelled', value: review.demo.cancelled }
              ]} />
            )}
            {shows('followUps') && (
              <MetricGroup title="Follow-ups" items={[
                { label: 'Pending', value: review.followUps.pending },
                { label: 'Completed', value: review.followUps.completed },
                { label: 'Overdue', value: review.followUps.overdue }
              ]} />
            )}
            {shows('dc') && (
              <MetricGroup title="DC Activities" items={[
                { label: 'Pending', value: review.dc.pending },
                { label: 'Closed', value: review.dc.closed }
              ]} />
            )}
            {shows('customerResponse') && (
              <MetricGroup title="Customer Response" items={[
                { label: 'Positive', value: review.customerResponse.positive },
                { label: 'Negative', value: review.customerResponse.negative },
                { label: 'Pending', value: review.customerResponse.pending }
              ]} />
            )}

            <div className={historyStyles.navGroupLabel}>Performance Charts</div>
            <div className={pageStyles.chartsRow}>
              <TrendChart title="Weekly Performance (activities logged)" data={review.charts.weekly} />
              <TrendChart title="Monthly Performance" data={review.charts.monthly} />
              <TrendChart title="Yearly Performance" data={review.charts.yearly} />
            </div>

            <div className={historyStyles.navGroupLabel}>Activity Timeline</div>
            <div className={historyStyles.timeline}>
              {review.timeline.length === 0 ? (
                <div className={calcStyles.small}>No activity recorded yet.</div>
              ) : (
                review.timeline.map((t, idx) => (
                  <div key={idx} className={historyStyles.timelineEntry}>
                    <div className={historyStyles.timelineMeta}>{formatDateTime(t.at)}</div>
                    <div>{t.action}</div>
                    {t.remarks && <div className={calcStyles.small}>{t.remarks}</div>}
                  </div>
                ))
              )}
            </div>
          </>
        )}
    </AppShell>
  );
}

export default function PerformanceReviewPage() {
  return (
    <Suspense fallback={<div className={historyStyles.body} />}>
      <PerformanceReviewPageContent />
    </Suspense>
  );
}
