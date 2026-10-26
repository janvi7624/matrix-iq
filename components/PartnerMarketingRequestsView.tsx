'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PartnerRecord } from '@/lib/types';
import {
  PARTNER_MARKETING_STAGE_LABEL,
  PARTNER_MARKETING_STAGE_ORDER,
  PartnerMarketingStage,
  PartnerVisibleMarketingRequest
} from '@/lib/partnerMarketingVisibility';
import { MARKETING_PRIORITY_META, MARKETING_REQUEST_TYPE_LABEL } from '@/lib/marketingRequestHelpers';
import MarketingRequestWizard, { MarketingRequestForm } from './MarketingRequestWizard';
import PartnerShell from './PartnerShell';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface PartnerProjectOption {
  id: string;
  project_name: string;
  client_name: string;
  company: string;
}

function formatDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readonlyField}>
      <div className={styles.readonlyLabel}>{label}</div>
      <div className={styles.readonlyValue}>{value || '—'}</div>
    </div>
  );
}

/**
 * The partner's own project picker.
 *
 * Replaces the internal ProjectSelect, which self-fetches /api/projects — a
 * route Layer 1 refuses to a partner session. A plain <select> is enough
 * here: a partner has their own submissions, not the whole company's
 * pipeline, so there is nothing to type-to-filter through.
 */
function PartnerProjectPicker({
  projects,
  value,
  onChange
}: {
  projects: PartnerProjectOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select className={calcStyles.formControl} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">-- Not linked to a specific project --</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.project_name || p.client_name}
          {p.company ? ` — ${p.company}` : ''}
        </option>
      ))}
    </select>
  );
}

export default function PartnerMarketingRequestsView({ partner }: { partner: PartnerRecord }) {
  const toast = useToast();
  const [requests, setRequests] = useState<PartnerVisibleMarketingRequest[]>([]);
  const [projects, setProjects] = useState<PartnerProjectOption[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [tab, setTab] = useState<'list' | 'new'>('list');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // reloadKey is the refresh handle: submitting a request bumps it and this
  // effect re-runs. Async IIFE with a cancelled guard, matching
  // components/MaterialsView.tsx — calling a loader straight out of the
  // effect body sets state during the effect and cascades renders.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/partner/marketing-requests');
        if (!response.ok) throw new Error(String(response.status));
        const data: PartnerVisibleMarketingRequest[] = await response.json();
        if (cancelled) return;
        setRequests(data);
        setStatus(data.length ? '' : 'You have not raised any marketing requests yet.');
      } catch {
        if (!cancelled) setStatus('Could not load your requests. Refresh to try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // The picker's options, loaded once. Failing quietly is correct — a partner
  // with no projects yet must still be able to raise a request.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/partner/projects');
        const rows = response.ok ? await response.json() : [];
        if (!cancelled) setProjects(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = useCallback(
    async (form: MarketingRequestForm) => {
      setCreating(true);
      try {
        const response = await fetch('/api/partner/marketing-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form)
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(body?.error || 'Could not send this request.');
          return null;
        }
        setReloadKey((k) => k + 1);
        return body as PartnerVisibleMarketingRequest;
      } catch {
        toast.error('Could not send this request.');
        return null;
      } finally {
        setCreating(false);
      }
    },
    [toast]
  );

  const open = useMemo(() => requests.find((r) => r.id === openId) || null, [requests, openId]);

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const r of requests) by[r.stage] = (by[r.stage] ?? 0) + 1;
    return by;
  }, [requests]);

  return (
    <PartnerShell
      title="Marketing Requests"
      subtitle="Ask our marketing team for collateral and follow it through to delivery"
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      <div className={styles.tabStrip}>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'list' ? styles.tabActive : ''}`}
          onClick={() => { setTab('list'); setOpenId(null); }}
        >
          My Requests{requests.length ? ` (${requests.length})` : ''}
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'new' ? styles.tabActive : ''}`}
          onClick={() => { setTab('new'); setOpenId(null); }}
        >
          New Request
        </button>
      </div>

      {tab === 'new' && (
        <MarketingRequestWizard
          creating={creating}
          onSubmit={handleSubmit}
          onViewAllRequests={() => { setTab('list'); setReloadKey((k) => k + 1); }}
          renderProjectPicker={(value, onChange) => (
            <PartnerProjectPicker projects={projects} value={value} onChange={onChange} />
          )}
        />
      )}

      {tab === 'list' && !open && (
        <>
          {requests.length > 0 && (
            <div className={styles.statCardRow}>
              {PARTNER_MARKETING_STAGE_ORDER.map((stage) => (
                <div key={stage} className={styles.statCard}>
                  <div className={styles.statCardLabel}>{PARTNER_MARKETING_STAGE_LABEL[stage]}</div>
                  <div className={styles.statCardValue}>{counts[stage] ?? 0}</div>
                </div>
              ))}
            </div>
          )}

          {status && <div className={historyStyles.status}>{status}</div>}

          <div className={styles.cardGrid}>
            {requests.map((r) => (
              <button
                key={r.id}
                type="button"
                className={styles.card}
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => setOpenId(r.id)}
              >
                <p className={styles.cardTitle}>{r.title}</p>
                <p className={styles.cardDesc}>
                  {MARKETING_REQUEST_TYPE_LABEL[r.request_type]} · {r.product_category}
                </p>
                <p className={styles.cardDesc} style={{ marginTop: 6 }}>
                  <span className={styles.statusChip}>{r.stage_label}</span>
                  {r.action_required ? ' · Needs your input' : ''}
                </p>
                <div className={styles.progressBarOuter} style={{ marginTop: 8 }}>
                  <div className={styles.progressBarInner} style={{ width: `${r.progress_percent}%` }} />
                </div>
                <p className={styles.cardDesc} style={{ marginTop: 6 }}>Raised {formatDate(r.created_at)}</p>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'list' && open && (
        <>
          <div className={styles.detailHeader}>
            <div>
              <div className={styles.detailHeaderTitle}>{open.title}</div>
              <div className={styles.detailHeaderMeta}>
                {MARKETING_REQUEST_TYPE_LABEL[open.request_type]} · {open.product_category} · raised {formatDate(open.created_at)}
              </div>
            </div>
            <button type="button" className={historyStyles.button} onClick={() => setOpenId(null)}>← Back to all requests</button>
          </div>

          {/* Terminal-negative is not a step on the path, so the stepper is
              replaced rather than shown with nothing highlighted. */}
          {open.stage === 'rejected' ? (
            <div className={styles.pending}>
              <strong>Not proceeding.</strong>
              {open.rejection_reason ? ` ${open.rejection_reason}` : ' Your relationship manager can explain the detail.'}
            </div>
          ) : (
            <div className={styles.stageTrack}>
              {PARTNER_MARKETING_STAGE_ORDER.map((step: PartnerMarketingStage, i) => {
                const currentStep = PARTNER_MARKETING_STAGE_ORDER.indexOf(open.stage);
                return (
                  <div
                    key={step}
                    className={`${styles.stageRow} ${i < currentStep ? styles.stageRowDone : ''} ${i === currentStep ? styles.stageRowCurrent : ''}`}
                  >
                    {PARTNER_MARKETING_STAGE_LABEL[step]}
                  </div>
                );
              })}
            </div>
          )}

          {open.action_required && (
            <div className={styles.pending} style={{ marginTop: 12 }}>
              Marketing needs more information before they can continue. Your relationship manager will be in touch.
            </div>
          )}

          <h3 className={styles.sectionHeading}>Request details</h3>
          <div className={styles.readonlyGrid}>
            <Field label="Request Title" value={open.title} />
            <Field label="Product Category" value={open.product_category} />
            <Field label="Collateral Type" value={MARKETING_REQUEST_TYPE_LABEL[open.request_type]} />
            <Field label="Priority" value={MARKETING_PRIORITY_META[open.priority].label} />
            <Field label="Needed By" value={formatDate(open.needed_by_date)} />
            <Field label="Last Updated" value={formatDate(open.updated_at)} />
          </div>

          <h3 className={styles.sectionHeading}>Description of requirement</h3>
          <p className={styles.readonlyValue}>{open.description || '—'}</p>

          {open.additional_info && (
            <>
              <h3 className={styles.sectionHeading}>Additional information</h3>
              <p className={styles.readonlyValue}>{open.additional_info}</p>
            </>
          )}

          {open.attachments.length > 0 && (
            <>
              <h3 className={styles.sectionHeading}>Your attachments</h3>
              <div className={styles.cardGrid}>
                {open.attachments.map((a) => (
                  <a key={a} className={styles.card} href={a} target="_blank" rel="noopener noreferrer">
                    <p className={styles.cardTitle}>{a.split('/').pop()}</p>
                    <p className={styles.cardDesc}>Open attachment</p>
                  </a>
                ))}
              </div>
            </>
          )}

          {open.stage === 'completed' && (
            <>
              <h3 className={styles.sectionHeading}>Delivered by Marketing</h3>
              {open.final_notes && <p className={styles.readonlyValue}>{open.final_notes}</p>}
              {open.final_files.length > 0 ? (
                <div className={styles.cardGrid}>
                  {open.final_files.map((f) => (
                    <a key={f} className={styles.card} href={f} target="_blank" rel="noopener noreferrer">
                      <p className={styles.cardTitle}>{f.split('/').pop()}</p>
                      <p className={styles.cardDesc}>Download</p>
                    </a>
                  ))}
                </div>
              ) : (
                <p className={styles.pending}>No files were attached to this delivery.</p>
              )}
            </>
          )}
        </>
      )}
    </PartnerShell>
  );
}
