'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PublicUser } from '@/lib/types';
import AppShell from '@/components/AppShell';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import pageStyles from './performanceReviewPage.module.css';

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

  section('CRM Metrics', [
    ['Total Leads', review.crm.totalLeads],
    ['Qualified Leads', review.crm.qualifiedLeads],
    ['Lost Leads', review.crm.lostLeads],
    ['Won Leads', review.crm.wonLeads],
    ['Unattended Leads', review.crm.unattendedLeads]
  ]);
  section('Sales Metrics', [
    ['Quotations Created', review.sales.quotationsCreated],
    ['Quotations Revised', review.sales.quotationsRevised],
    ['Quotations Converted', review.sales.quotationsConverted]
  ]);
  section('Projects / Site Visits / Demo', [
    ['Active Projects', review.projects.activeProjects],
    ['Completed Projects', review.projects.completedProjects],
    ['Total Site Visits', review.siteVisits.total],
    ['Demos Scheduled', review.demo.scheduled],
    ['Demos Completed', review.demo.completed],
    ['Demos Cancelled', review.demo.cancelled]
  ]);
  section('Follow-ups / DC / Customer Response', [
    ['Follow-ups Pending', review.followUps.pending],
    ['Follow-ups Completed', review.followUps.completed],
    ['Follow-ups Overdue', review.followUps.overdue],
    ['DC Pending', review.dc.pending],
    ['DC Closed', review.dc.closed],
    ['Customer Response Positive', review.customerResponse.positive],
    ['Customer Response Negative', review.customerResponse.negative],
    ['Customer Response Pending', review.customerResponse.pending]
  ]);

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

            <MetricGroup title="CRM Metrics" items={[
              { label: 'Total Leads', value: review.crm.totalLeads },
              { label: 'Qualified Leads', value: review.crm.qualifiedLeads },
              { label: 'Lost Leads', value: review.crm.lostLeads },
              { label: 'Won Leads', value: review.crm.wonLeads },
              { label: 'Unattended Leads', value: review.crm.unattendedLeads }
            ]} />
            <MetricGroup title="Sales Metrics" items={[
              { label: 'Quotations Created', value: review.sales.quotationsCreated },
              { label: 'Quotations Revised', value: review.sales.quotationsRevised },
              { label: 'Quotations Converted', value: review.sales.quotationsConverted }
            ]} />
            <MetricGroup title="Projects" items={[
              { label: 'Active Projects', value: review.projects.activeProjects },
              { label: 'Completed Projects', value: review.projects.completedProjects }
            ]} />
            <MetricGroup title="Site Visits" items={[{ label: 'Total Site Visits', value: review.siteVisits.total }]} />
            <MetricGroup title="Demo" items={[
              { label: 'Scheduled', value: review.demo.scheduled },
              { label: 'Completed', value: review.demo.completed },
              { label: 'Cancelled', value: review.demo.cancelled }
            ]} />
            <MetricGroup title="Follow-ups" items={[
              { label: 'Pending', value: review.followUps.pending },
              { label: 'Completed', value: review.followUps.completed },
              { label: 'Overdue', value: review.followUps.overdue }
            ]} />
            <MetricGroup title="DC Activities" items={[
              { label: 'Pending', value: review.dc.pending },
              { label: 'Closed', value: review.dc.closed }
            ]} />
            <MetricGroup title="Customer Response" items={[
              { label: 'Positive', value: review.customerResponse.positive },
              { label: 'Negative', value: review.customerResponse.negative },
              { label: 'Pending', value: review.customerResponse.pending }
            ]} />

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
