'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DomainKey, LeadPriority, LeadRecord, LeadSource, UserRole } from '@/lib/types';
import { LEAD_DOMAIN_TILES, LEAD_PRIORITY_META } from '@/lib/leadInterestOptions';
import { isLeadUnattended } from '@/lib/followUp';
import { AlertTriangle, Flame, Contact, Share2 } from 'lucide-react';
import AppShell from './AppShell';
import LeadCaptureWizard from './LeadCaptureWizard';
import LeadBulkImportWizard from './LeadBulkImportWizard';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import notifyStyles from './ui/notify.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';

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
  const Icon = LEAD_PRIORITY_META[priority].icon;
  return <span className={`${historyStyles.priorityBadge} ${cls}`}><Icon size={12} /> {priority.toUpperCase()}</span>;
}

const SOURCE_LABEL: Record<LeadSource, string> = {
  manual: 'Manual',
  business_card: 'Business Card',
  csv_import: 'CSV Import',
  meta_lead_ads: 'Meta Lead Ads'
};

function metaPlatformLabel(platform: string): string {
  return platform === 'ig' ? 'Instagram' : platform === 'fb' ? 'Facebook' : 'Meta';
}

function SourceBadge({ lead, onClick }: { lead: LeadRecord; onClick?: () => void }) {
  const isMeta = lead.source === 'meta_lead_ads';
  const label = SOURCE_LABEL[lead.source] || 'Manual';
  return (
    <button
      type="button"
      onClick={isMeta ? onClick : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600,
        padding: '2px 9px', borderRadius: 'var(--mx-radius-full)',
        color: isMeta ? 'var(--mx-blue-600)' : 'var(--mx-ink-muted)',
        background: isMeta ? 'var(--mx-blue-50)' : 'var(--mx-surface-sunken)',
        border: 'none', cursor: isMeta ? 'pointer' : 'default'
      }}
    >
      {isMeta && <Share2 size={11} />}
      {label}
    </button>
  );
}

function LeadsViewContent({ currentUser }: LeadsViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const startUnattended = searchParams.get('filter') === 'unattended';
  const [mode, setMode] = useState<'capture' | 'list' | 'bulk'>(startUnattended ? 'list' : 'capture');
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | ''>('');
  const [interestFilter, setInterestFilter] = useState<DomainKey | ''>('');
  const [sourceFilter, setSourceFilter] = useState<LeadSource | ''>('');
  const [unattendedOnly, setUnattendedOnly] = useState(startUnattended);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<{ total: number; today: number; hot: number; unattended: number; metaTotal: number; metaToday: number } | null>(null);
  const [metaInfoLead, setMetaInfoLead] = useState<LeadRecord | null>(null);

  async function loadLeads() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/leads');
      if (!response.ok) throw new Error(String(response.status));
      const data: LeadRecord[] = await response.json();
      setLeads(data);
      setStatus(data.length ? `${data.length} lead${data.length === 1 ? '' : 's'}.` : 'No leads captured yet.');
    } catch {
      setStatus('Could not load leads. Refresh to try again.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
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
    if (sourceFilter) rows = rows.filter((l) => l.source === sourceFilter);
    if (unattendedOnly) rows = rows.filter(isLeadUnattended);
    const sorted = [...rows].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'oldest') return a.created_at < b.created_at ? -1 : 1;
      return a.created_at < b.created_at ? 1 : -1;
    });
    return sorted;
  }, [leads, q, priorityFilter, interestFilter, sourceFilter, unattendedOnly, sortBy]);

  const totalPages = Math.max(1, Math.ceil(visibleLeads.length / PAGE_SIZE));
  const pageRows = visibleLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [q, priorityFilter, interestFilter, sourceFilter, unattendedOnly, sortBy]);

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
        toast.error('Could not save this lead. Please try again.');
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
      toast.error('Could not reach the server.');
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
      toast.error(body?.error || 'Could not convert this lead.');
      return false;
    }
    await loadLeads();
    return true;
  }

  async function handleDelete(lead: LeadRecord) {
    if (!(await confirm({ message: `Delete the lead for "${lead.name || lead.company}"? This cannot be undone.`, danger: true }))) return;
    const response = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Could not delete this lead.');
      return;
    }
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
    loadStats();
  }

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';

  return (
    <AppShell title="Lead Capture / Inquiry" subtitle="Scan a business card, bulk-import from CSV or photos, qualify the lead, and follow up — all in one flow.">
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
              <div style={{ fontSize: 24, fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>{stats.hot} <Flame size={20} /></div>
              <div className={calcStyles.small}>Hot Leads</div>
            </div>
            <button
              type="button"
              className={calcStyles.sectionPanel}
              style={{ flex: 1, minWidth: 120, textAlign: 'center', cursor: 'pointer', border: sourceFilter === 'meta_lead_ads' ? '1px solid var(--mx-blue-600)' : undefined }}
              onClick={() => { setMode('list'); setSourceFilter((v) => (v === 'meta_lead_ads' ? '' : 'meta_lead_ads')); }}
            >
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--mx-blue-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Share2 size={18} /> {stats.metaTotal}</div>
              <div className={calcStyles.small}>Meta Leads</div>
            </button>
            <button
              type="button"
              className={calcStyles.sectionPanel}
              style={{ flex: 1, minWidth: 120, textAlign: 'center', cursor: 'pointer', border: unattendedOnly ? '1px solid #dc2626' : undefined }}
              onClick={() => { setMode('list'); setUnattendedOnly(true); }}
            >
              <div style={{ fontSize: 24, fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><AlertTriangle size={20} /> {stats.unattended}</div>
              <div className={calcStyles.small}>Unattended</div>
            </button>
          </div>
        )}

        <div className={historyStyles.modeToggle}>
          <button type="button" className={`${historyStyles.modeToggleBtn} ${mode === 'capture' ? historyStyles.modeToggleBtnActive : ''}`} onClick={() => setMode('capture')}>
            + Add Inquiry
          </button>
          <button
            type="button"
            className={`${historyStyles.modeToggleBtn} ${mode === 'bulk' ? historyStyles.modeToggleBtnActive : ''}`}
            onClick={() => setMode('bulk')}
          >
            Import Leads / Inquiries
          </button>
          <button
            type="button"
            className={`${historyStyles.modeToggleBtn} ${mode === 'list' ? historyStyles.modeToggleBtnActive : ''}`}
            onClick={showAllLeads}
          >
            All Leads
          </button>
        </div>

        {mode === 'capture' && (
          <LeadCaptureWizard creating={creating} onSubmit={handleSubmitLead} onConvertToProject={handleConvertToProject} onViewAllLeads={showAllLeads} />
        )}

        {mode === 'bulk' && (
          <LeadBulkImportWizard
            onImportComplete={() => {
              loadStats();
            }}
            onCancel={showAllLeads}
          />
        )}

        {mode === 'list' && (
          <>
            <div className={historyStyles.toolbar}>
              <input type="text" placeholder="Search name, company, city, email, mobile..." value={q} onChange={(e) => setQ(e.target.value)} />
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as LeadPriority | '')}>
                <option value="">All priorities</option>
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="cool">Cold</option>
              </select>
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={interestFilter} onChange={(e) => setInterestFilter(e.target.value as DomainKey | '')}>
                <option value="">All interests</option>
                {LEAD_DOMAIN_TILES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as LeadSource | '')}>
                <option value="">All sources</option>
                <option value="meta_lead_ads">Meta Lead Ads</option>
                <option value="manual">Manual</option>
                <option value="business_card">Business Card</option>
                <option value="csv_import">CSV Import</option>
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
                Unattended only
              </button>
              <button type="button" className={historyStyles.button} onClick={loadLeads}>Refresh</button>
              <a className={historyStyles.button} href="/api/leads/export.csv">Export CSV</a>
              <button type="button" className={historyStyles.button} onClick={() => window.print()}>Print</button>
            </div>
            {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

            {loading ? (
              <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={9} /></div>
            ) : loadFailed ? (
              <ErrorState message="Could not load leads — check your connection and try again." onRetry={loadLeads} />
            ) : (
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
                    <th>Source</th>
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
                      <td>
                        {l.interests.length > 0 ? (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            {l.interests.map((d) => {
                              const tile = LEAD_DOMAIN_TILES.find((t) => t.key === d);
                              const Icon = tile?.icon;
                              return Icon ? <Icon key={d} size={14} /> : <span key={d}>{d}</span>;
                            })}
                          </div>
                        ) : '-'}
                      </td>
                      <td><PriorityBadge priority={l.priority} /></td>
                      <td><SourceBadge lead={l} onClick={() => setMetaInfoLead(l)} /></td>
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
                    <tr><td colSpan={11}>
                      <EmptyState
                        icon={Contact}
                        title={leads.length === 0 ? 'No leads captured yet' : 'No leads match your filters'}
                        message={leads.length === 0 ? 'Scan a business card to capture your first lead.' : 'Try clearing a filter or search term.'}
                        action={leads.length === 0 ? <button type="button" className={calcStyles.btn} onClick={() => setMode('capture')}>Capture a Lead</button> : undefined}
                      />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            )}

            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', marginTop: 14 }}>
                <button type="button" className={historyStyles.button} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                <span className={calcStyles.small}>Page {page} of {totalPages}</span>
                <button type="button" className={historyStyles.button} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}

        {metaInfoLead && (
          <div className={notifyStyles.overlay} role="presentation" onClick={() => setMetaInfoLead(null)}>
            <div className={notifyStyles.wideCard} role="dialog" aria-modal="true" aria-label="Meta Information" onClick={(e) => e.stopPropagation()}>
              <div className={notifyStyles.confirmTitle}>Meta Information</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 14, rowGap: 8, fontSize: 13.5, marginTop: 10 }}>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Platform</span><span>{metaPlatformLabel(metaInfoLead.meta_platform)}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Campaign</span><span>{metaInfoLead.meta_campaign_name || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Ad Set</span><span>{metaInfoLead.meta_adset_name || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Ad</span><span>{metaInfoLead.meta_ad_name || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Form</span><span>{metaInfoLead.meta_form_name || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Meta Lead ID</span><span style={{ fontFamily: 'monospace' }}>{metaInfoLead.meta_lead_id || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Received</span><span>{formatDateTime(metaInfoLead.meta_created_at)}</span>
              </div>
              <div className={notifyStyles.confirmActions} style={{ marginTop: 18 }}>
                <button type="button" className={notifyStyles.confirmOk} onClick={() => setMetaInfoLead(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
    </AppShell>
  );
}

export default function LeadsView(props: LeadsViewProps) {
  return (
    <Suspense fallback={<AppShell title="Lead Capture / Inquiry" subtitle="Scan a business card, bulk-import from CSV or photos, qualify the lead, and follow up — all in one flow.">{null}</AppShell>}>
      <LeadsViewContent {...props} />
    </Suspense>
  );
}
