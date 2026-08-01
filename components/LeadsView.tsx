'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DomainKey, LeadPriority, LeadRecord, UserRole } from '@/lib/types';
import { LEAD_DOMAIN_TILES, LEAD_PRIORITY_META } from '@/lib/leadInterestOptions';
import { isLeadUnattended } from '@/lib/followUp';
import PortalHeader from './PortalHeader';
import LeadCaptureWizard from './LeadCaptureWizard';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface LeadsViewProps {
  currentUser: { username: string; role: UserRole };
}

const PAGE_SIZE = 20;

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function PriorityBadge({ priority }: { priority: LeadPriority }) {
  if (!priority) return <span style={{ color: '#9ca3af', fontSize: 12 }}>-</span>;
  const cls = priority === 'hot' ? historyStyles.priorityBadgeHot : priority === 'warm' ? historyStyles.priorityBadgeWarm : historyStyles.priorityBadgeCool;
  return <span className={`${historyStyles.priorityBadge} ${cls}`}>{LEAD_PRIORITY_META[priority].icon} {priority.toUpperCase()}</span>;
}

function LeadsViewContent({ currentUser }: LeadsViewProps) {
  const searchParams = useSearchParams();
  const startUnattended = searchParams.get('filter') === 'unattended';
  const [mode, setMode] = useState<'capture' | 'list'>(startUnattended ? 'list' : 'capture');
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | ''>('');
  const [interestFilter, setInterestFilter] = useState<DomainKey | ''>('');
  const [unattendedOnly, setUnattendedOnly] = useState(startUnattended);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<{ total: number; today: number; hot: number; unattended: number } | null>(null);

  async function loadLeads() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/leads');
      if (!response.ok) throw new Error(String(response.status));
      const data: LeadRecord[] = await response.json();
      setLeads(data);
      setStatus(data.length ? `${data.length} lead${data.length === 1 ? '' : 's'}.` : 'No leads captured yet.');
    } catch {
      setStatus('Could not load leads. Refresh to try again.');
    }
  }

  async function loadStats() {
    try {
      const response = await fetch('/api/leads/stats');
      if (response.ok) setStats(await response.json());
    } catch {
      setStats(null);
    }
  }

  useEffect(() => {
    loadLeads();
    loadStats();
  }, []);

  const visibleLeads = useMemo(() => {
    let rows = leads;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((l) => `${l.name} ${l.company} ${l.city} ${l.email} ${l.mobile}`.toLowerCase().includes(needle));
    }
    if (priorityFilter) rows = rows.filter((l) => l.priority === priorityFilter);
    if (interestFilter) rows = rows.filter((l) => l.interests.includes(interestFilter));
    if (unattendedOnly) rows = rows.filter(isLeadUnattended);
    const sorted = [...rows].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'oldest') return a.created_at < b.created_at ? -1 : 1;
      return a.created_at < b.created_at ? 1 : -1;
    });
    return sorted;
  }, [leads, q, priorityFilter, interestFilter, unattendedOnly, sortBy]);

  const totalPages = Math.max(1, Math.ceil(visibleLeads.length / PAGE_SIZE));
  const pageRows = visibleLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [q, priorityFilter, interestFilter, unattendedOnly, sortBy]);

  async function handleSubmitLead(form: {
    name: string; mobile: string; email: string; designation: string; company: string; city: string; cardImageUrl: string;
    interests: DomainKey[]; subInterests: string[]; priority: LeadPriority; followUpActions: string[]; budget: string; notes: string;
  }): Promise<(LeadRecord & { duplicate?: boolean; duplicateCapturedBy?: string }) | null> {
    setCreating(true);
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        alert('Could not save this lead. Please try again.');
        return null;
      }
      const result: LeadRecord & { duplicate?: boolean; duplicateCapturedBy?: string } = await response.json();
      // A merged duplicate updates an existing row in place instead of
      // prepending a second copy of the same contact.
      setLeads((prev) => {
        const index = prev.findIndex((l) => l.id === result.id);
        if (index === -1) return [result, ...prev];
        const next = [...prev];
        next[index] = result;
        return next;
      });
      loadStats();
      return result;
    } catch {
      alert('Could not reach the server.');
      return null;
    } finally {
      setCreating(false);
    }
  }

  function showAllLeads() {
    setMode('list');
    loadLeads();
  }

  async function handleConvertToProject(leadId: string): Promise<boolean> {
    const response = await fetch(`/api/leads/${leadId}/convert-to-project`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      alert(body?.error || 'Could not convert this lead.');
      return false;
    }
    await loadLeads();
    return true;
  }

  async function handleDelete(lead: LeadRecord) {
    if (!window.confirm(`Delete the lead for "${lead.name || lead.company}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
    if (!response.ok) {
      alert('Could not delete this lead.');
      return;
    }
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
    loadStats();
  }

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Lead Capture" subtitle="Scan a business card at an event, qualify the lead, and follow up — all in one flow." />
      <main className={historyStyles.main}>
        {stats && (
          <div className={calcStyles.row} style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{stats.total}</div>
              <div className={calcStyles.small}>Total Leads</div>
            </div>
            <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#15803d' }}>{stats.today}</div>
              <div className={calcStyles.small}>Captured Today</div>
            </div>
            <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#b91c1c' }}>{stats.hot} 🔥</div>
              <div className={calcStyles.small}>Hot Leads</div>
            </div>
            <button
              type="button"
              className={calcStyles.sectionPanel}
              style={{ flex: 1, minWidth: 120, textAlign: 'center', cursor: 'pointer', border: unattendedOnly ? '1px solid #dc2626' : undefined }}
              onClick={() => { setMode('list'); setUnattendedOnly(true); }}
            >
              <div style={{ fontSize: 24, fontWeight: 800, color: '#b91c1c' }}>🚨 {stats.unattended}</div>
              <div className={calcStyles.small}>Unattended</div>
            </button>
          </div>
        )}

        <div className={historyStyles.modeToggle}>
          <button type="button" className={`${historyStyles.modeToggleBtn} ${mode === 'capture' ? historyStyles.modeToggleBtnActive : ''}`} onClick={() => setMode('capture')}>
            📸 Capture Lead
          </button>
          <button
            type="button"
            className={`${historyStyles.modeToggleBtn} ${mode === 'list' ? historyStyles.modeToggleBtnActive : ''}`}
            onClick={showAllLeads}
          >
            📋 All Leads
          </button>
        </div>

        {mode === 'capture' && (
          <LeadCaptureWizard creating={creating} onSubmit={handleSubmitLead} onConvertToProject={handleConvertToProject} onViewAllLeads={showAllLeads} />
        )}

        {mode === 'list' && (
          <>
            <div className={historyStyles.toolbar}>
              <input type="text" placeholder="Search name, company, city, email, mobile..." value={q} onChange={(e) => setQ(e.target.value)} />
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as LeadPriority | '')}>
                <option value="">All priorities</option>
                <option value="hot">🔥 Hot</option>
                <option value="warm">♨️ Warm</option>
                <option value="cool">🧊 Cold</option>
              </select>
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={interestFilter} onChange={(e) => setInterestFilter(e.target.value as DomainKey | '')}>
                <option value="">All interests</option>
                {LEAD_DOMAIN_TILES.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
              </select>
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={sortBy} onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'name')}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name (A-Z)</option>
              </select>
              <button
                type="button"
                className={`${historyStyles.modeToggleBtn} ${unattendedOnly ? historyStyles.modeToggleBtnActive : ''}`}
                style={unattendedOnly ? { color: '#b91c1c', borderColor: '#dc2626' } : undefined}
                onClick={() => setUnattendedOnly((v) => !v)}
              >
                🚨 Unattended only
              </button>
              <button type="button" className={historyStyles.button} onClick={loadLeads}>Refresh</button>
              <a className={historyStyles.button} href="/api/leads/export.csv">Export CSV</a>
              <button type="button" className={historyStyles.button} onClick={() => window.print()}>Print</button>
            </div>
            <div className={historyStyles.status}>{status}</div>

            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Designation</th>
                    <th>Mobile</th>
                    <th>Email</th>
                    <th>Interests</th>
                    <th>Priority</th>
                    <th>Captured By</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name || '-'}</td>
                      <td>{l.company || '-'}</td>
                      <td>{l.designation || '-'}</td>
                      <td className={historyStyles.num}>{l.mobile || '-'}</td>
                      <td>{l.email || '-'}</td>
                      <td>{l.interests.map((d) => LEAD_DOMAIN_TILES.find((t) => t.key === d)?.icon || d).join(' ') || '-'}</td>
                      <td><PriorityBadge priority={l.priority} /></td>
                      <td>{l.created_by}</td>
                      <td>{formatDateTime(l.created_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {!l.project_id ? (
                            <button type="button" className={historyStyles.button} onClick={() => handleConvertToProject(l.id)}>To Project</button>
                          ) : (
                            <Link href={`/projects/${l.project_id}`} className={calcStyles.small}>View Project</Link>
                          )}
                          {isPrivileged && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(l)}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr><td colSpan={10} className={historyStyles.empty}>No leads match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', marginTop: 14 }}>
                <button type="button" className={historyStyles.button} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                <span className={calcStyles.small}>Page {page} of {totalPages}</span>
                <button type="button" className={historyStyles.button} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function LeadsView(props: LeadsViewProps) {
  return (
    <Suspense fallback={<div className={historyStyles.body} />}>
      <LeadsViewContent {...props} />
    </Suspense>
  );
}
