'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Send, Undo2, X, Eye, Megaphone } from 'lucide-react';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface Campaign {
  id: string;
  festival_name: string;
  festival_date: string;
  marketing_request_id: string;
  marketing_request_status: string;
  marketing_request_assignee: string;
  status: 'awaiting_creative' | 'pending_approval' | 'approved' | 'sending' | 'sent' | 'skipped';
  headline: string;
  message: string;
  has_banner: boolean;
  approved_by_name: string;
  approved_at: string;
  rejection_reason: string;
  sent_at: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  dry_run: boolean;
}

interface Row {
  festival_id: string;
  festival_name: string;
  festival_date: string;
  campaign: Campaign | null;
}

interface Overview {
  rows: Row[];
  recipients: { total: number; invalid: number; duplicates: number; unsubscribed: number };
  liveSending: boolean;
}

const STATUS_LABEL: Record<Campaign['status'], { text: string; color: string }> = {
  awaiting_creative: { text: 'Waiting for Marketing banner', color: 'var(--mx-warning)' },
  pending_approval: { text: 'Needs your approval', color: 'var(--mx-danger)' },
  approved: { text: 'Approved — will send on the day', color: 'var(--mx-success)' },
  sending: { text: 'Sending…', color: 'var(--mx-primary, #2563eb)' },
  sent: { text: 'Sent', color: 'var(--mx-success)' },
  skipped: { text: 'Not sent (not approved in time)', color: 'var(--mx-muted, #6b7280)' }
};

function formatDate(value: string): string {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
}

function daysAway(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(date + 'T00:00:00').getTime() - today.getTime()) / 86_400_000);
}

// Client festival greeting campaigns — the HR / Marketing manager / Admin
// review screen. MatrixIQ raises the banner request to Marketing on its own
// (lib/festivalCampaignStore.ts); this is where the result is checked,
// worded, test-sent and approved before it reaches every client.
export default function FestivalCampaignsView() {
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [openId, setOpenId] = useState<string | null>(null);
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/festival-campaigns');
      if (!response.ok) {
        setStatus(response.status === 403 ? 'Only HR, the Marketing manager or an Admin can review festival emails.' : 'Could not load festival campaigns.');
        return;
      }
      setData(await response.json());
      setStatus('');
    } catch {
      setStatus('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = data?.rows.find((r) => r.campaign?.id === openId)?.campaign || null;

  const loadPreview = useCallback(async (id: string, h: string, m: string) => {
    const params = new URLSearchParams({ headline: h, message: m });
    const response = await fetch(`/api/festival-campaigns/${id}/preview?${params.toString()}`);
    setPreviewHtml(response.ok ? await response.text() : '<p style="font-family:sans-serif">Preview unavailable.</p>');
  }, []);

  function startReview(c: Campaign) {
    setOpenId(c.id);
    setHeadline(c.headline);
    setMessage(c.message);
    setNotice(null);
    loadPreview(c.id, c.headline, c.message);
  }

  async function call(url: string, body: unknown, success: string, method: 'POST' | 'PATCH' = 'POST'): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice({ kind: 'error', text: result.error || 'Something went wrong.' });
        return false;
      }
      setNotice({ kind: 'ok', text: success.replace('{to}', result.to || '') });
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveWording() {
    if (!open) return;
    if (await call(`/api/festival-campaigns/${open.id}`, { headline, message }, 'Wording saved.', 'PATCH')) loadPreview(open.id, headline, message);
  }

  async function approve() {
    if (!open) return;
    const total = data?.recipients.total ?? 0;
    if (!confirm(`Approve the ${open.festival_name} email?\n\nIt will go to ${total} client email address(es) on ${formatDate(open.festival_date)} morning.`)) return;
    await call(`/api/festival-campaigns/${open.id}/approve`, { headline, message }, 'Approved. It will go out on the festival morning.');
  }

  async function sendBack() {
    if (!open) return;
    const reason = prompt('What should Marketing change in the banner?');
    if (!reason || !reason.trim()) return;
    if (await call(`/api/festival-campaigns/${open.id}/reject`, { reason }, 'Sent back to Marketing.')) setOpenId(null);
  }

  async function testSend() {
    if (!open) return;
    await call(`/api/festival-campaigns/${open.id}/test`, {}, 'Test email sent to {to}.');
  }

  async function raiseNow(row: Row) {
    if (!confirm(`Raise the banner request for ${row.festival_name} to Marketing now?`)) return;
    await call('/api/festival-campaigns', { festivalId: row.festival_id }, 'Banner request raised to Marketing.');
  }

  const editable = open && ['awaiting_creative', 'pending_approval', 'approved'].includes(open.status);

  return (
    <AppShell title="Festival Client Emails" subtitle="Banner from Marketing → approval → sent to every client in Client Master on the festival morning">
      {data && (
        <div className={calcStyles.sectionPanel} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
            <div>
              <div className={calcStyles.small}>Client recipients</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.recipients.total}</div>
            </div>
            <div className={calcStyles.small}>
              Skipped: {data.recipients.invalid} invalid · {data.recipients.duplicates} duplicate · {data.recipients.unsubscribed} unsubscribed
            </div>
            <div style={{ marginLeft: 'auto', fontWeight: 600, color: data.liveSending ? 'var(--mx-success)' : 'var(--mx-warning)' }}>
              {data.liveSending ? 'Live sending ON' : 'Live sending OFF — sends run as a dry run (no client is emailed)'}
            </div>
          </div>
        </div>
      )}

      {status && <p className={calcStyles.small}>{status}</p>}
      {notice && !open && <p style={{ color: notice.kind === 'ok' ? 'var(--mx-success)' : 'var(--mx-danger)' }}>{notice.text}</p>}

      {data && data.rows.length > 0 && (
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Festival</th>
              <th>Date</th>
              <th>Marketing request</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const c = row.campaign;
              const away = daysAway(row.festival_date);
              return (
                <tr key={row.festival_id}>
                  <td>{row.festival_name}</td>
                  <td>
                    {formatDate(row.festival_date)}
                    <div className={calcStyles.small}>{away === 0 ? 'Today' : away > 0 ? `in ${away} day${away === 1 ? '' : 's'}` : 'past'}</div>
                  </td>
                  <td>
                    {c?.marketing_request_id ? (
                      <a href="/marketing-requests">{c.marketing_request_status.replace(/_/g, ' ') || 'open'}{c.marketing_request_assignee ? ` · ${c.marketing_request_assignee}` : ''}</a>
                    ) : (
                      <span className={calcStyles.small}>{away > 0 ? 'Raised automatically 10 days before' : '—'}</span>
                    )}
                  </td>
                  <td>
                    {c ? (
                      <>
                        <span style={{ color: STATUS_LABEL[c.status].color, fontWeight: 600 }}>{STATUS_LABEL[c.status].text}</span>
                        {c.status === 'sent' && (
                          <div className={calcStyles.small}>
                            {c.dry_run ? 'Dry run — ' : ''}{c.sent_count} sent{c.failed_count ? `, ${c.failed_count} failed` : ''}
                          </div>
                        )}
                        {c.status === 'approved' && c.approved_by_name && <div className={calcStyles.small}>by {c.approved_by_name}</div>}
                        {c.status === 'awaiting_creative' && c.rejection_reason && <div className={calcStyles.small}>Sent back: {c.rejection_reason}</div>}
                      </>
                    ) : (
                      <span className={calcStyles.small}>Not started</span>
                    )}
                  </td>
                  <td>
                    {c ? (
                      <button type="button" className={`${historyStyles.button} ${c.status === 'pending_approval' ? historyStyles.primary : ''}`} onClick={() => startReview(c)}>
                        <Eye size={14} /> {c.status === 'pending_approval' ? 'Review & approve' : 'View'}
                      </button>
                    ) : away > 0 ? (
                      <button type="button" className={historyStyles.button} onClick={() => raiseNow(row)} disabled={busy}>
                        <Megaphone size={14} /> Request banner now
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${open.festival_name} client email`}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '24px 12px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpenId(null); }}
        >
          <div className={calcStyles.sectionPanel} style={{ width: '100%', maxWidth: 1100, background: 'var(--mx-surface, #fff)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{open.festival_name} — {formatDate(open.festival_date)}</h2>
              <span style={{ marginLeft: 12, color: STATUS_LABEL[open.status].color, fontWeight: 600 }}>{STATUS_LABEL[open.status].text}</span>
              <button type="button" className={historyStyles.button} style={{ marginLeft: 'auto' }} onClick={() => setOpenId(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
              <div>
                {!open.has_banner && open.status !== 'awaiting_creative' && (
                  <p style={{ color: 'var(--mx-warning)' }}>No banner image was delivered — the email will use the festive coloured header instead.</p>
                )}
                {open.status === 'awaiting_creative' && (
                  <p className={calcStyles.small}>Marketing is still working on the banner. You can prepare the wording meanwhile.</p>
                )}
                <div className={calcStyles.field}>
                  <label className={calcStyles.label} htmlFor="fc-headline">Headline</label>
                  <input id="fc-headline" className={calcStyles.formControl} value={headline} maxLength={200} disabled={!editable} onChange={(e) => setHeadline(e.target.value)} />
                </div>
                <div className={calcStyles.field} style={{ marginTop: 8 }}>
                  <label className={calcStyles.label} htmlFor="fc-message">Message (blank line = new paragraph)</label>
                  <textarea id="fc-message" className={calcStyles.formControl} rows={8} value={message} maxLength={5000} disabled={!editable} onChange={(e) => setMessage(e.target.value)} />
                </div>
                <p className={calcStyles.small}>Each client is greeted by name (&ldquo;Dear Mr. Sharma,&rdquo;) and the email ends with a thank-you line, your logo and an unsubscribe link.</p>

                {notice && <p style={{ color: notice.kind === 'ok' ? 'var(--mx-success)' : 'var(--mx-danger)' }}>{notice.text}</p>}

                <div className={calcStyles.inlineFlexGap8} style={{ flexWrap: 'wrap', marginTop: 12 }}>
                  {editable && (
                    <button type="button" className={historyStyles.button} onClick={() => loadPreview(open.id, headline, message)} disabled={busy}>
                      <Eye size={14} /> Refresh preview
                    </button>
                  )}
                  {editable && (
                    <button type="button" className={historyStyles.button} onClick={saveWording} disabled={busy}>Save wording</button>
                  )}
                  <button type="button" className={historyStyles.button} onClick={testSend} disabled={busy}>
                    <Send size={14} /> Send test to me
                  </button>
                  {open.status === 'pending_approval' && (
                    <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={approve} disabled={busy}>
                      <CheckCircle2 size={14} /> Approve for {data?.recipients.total ?? 0} clients
                    </button>
                  )}
                  {(open.status === 'pending_approval' || open.status === 'approved') && (
                    <button type="button" className={historyStyles.button} onClick={sendBack} disabled={busy}>
                      <Undo2 size={14} /> Send back to Marketing
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div className={calcStyles.label} style={{ marginBottom: 6 }}>Preview (as a client sees it)</div>
                <iframe
                  title="Email preview"
                  srcDoc={previewHtml}
                  // No scripts. Same-origin only so the not-yet-public banner loads with your session.
                  sandbox="allow-same-origin"
                  style={{ width: '100%', height: 640, border: '1px solid var(--mx-border, #e5e7eb)', borderRadius: 8, background: '#fff' }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
