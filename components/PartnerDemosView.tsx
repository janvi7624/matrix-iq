'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PartnerRecord } from '@/lib/types';
import { stagesForMode } from '@/lib/demoStages';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { getDomainProducts } from '@/lib/domainProducts';
import type { DemoProductLine, DomainKey } from '@/lib/types';
import WorkflowStepper, { StepperStep } from './ui/WorkflowStepper';
import PartnerShell from './PartnerShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface PartnerDemo {
  id: string;
  company: string;
  client_name: string;
  mode: string;
  location: string;
  status: string;
  status_label: string;
  internal_status: string;
  internal_status_label: string;
  stage_index: number;
  assigned_technical_person: string;
  requested_date: string;
  scheduled_at: string;
  requirements: string;
  partner_remark: string;
  can_cancel: boolean;
  created_at: string;
}

/**
 * The same approval chain the sales team sees, from the same definition
 * (lib/demoStages.ts).
 *
 * A cancelled demo gets no stepper: cancellation can happen from any status
 * and records no stage, so a position on the chain would be fabricated.
 */
function buildSteps(demo: PartnerDemo): StepperStep[] | null {
  if (demo.internal_status === 'cancelled') return null;
  return stagesForMode(demo.mode).map((stage, i) => ({
    key: stage.key,
    label: stage.label,
    state: demo.stage_index < 0 ? 'upcoming' : i < demo.stage_index ? 'done' : i === demo.stage_index ? 'current' : 'upcoming'
  }));
}

interface PartnerProjectOption {
  id: string;
  reference: string;
  company: string;
  client_name: string;
}

// The same domain list the internal form offers.
const ALL_DOMAINS = Object.keys(DOMAIN_DISPLAY_NAME) as DomainKey[];

const EMPTY = {
  projectId: '',
  quotationId: '',
  clientName: '',
  company: '',
  location: '',
  mode: 'onsite',
  productDomains: [] as DomainKey[],
  productsRequired: [] as DemoProductLine[],
  preferredDate: '',
  priority: 'medium',
  demoObjective: '',
  requirements: ''
};

export default function PartnerDemosView({ partner }: { partner: PartnerRecord }) {
  const [demos, setDemos] = useState<PartnerDemo[]>([]);
  const [projects, setProjects] = useState<PartnerProjectOption[]>([]);
  const [quotations, setQuotations] = useState<{ id: string; quotation_number: string }[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/partner/demos');
      if (!response.ok) throw new Error(String(response.status));
      const data: PartnerDemo[] = await response.json();
      setDemos(data);
      setStatus(data.length ? '' : 'You have not requested any demos yet.');
    } catch {
      setStatus('Could not load your demo requests. Refresh to try again.');
    }
  }, []);

  useEffect(() => {
    load();
    fetch('/api/partner/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
    // Only quotations actually shared with this partner are offered — the
    // server refuses any other, so a wider list would be options that 400.
    fetch('/api/partner/quotations')
      .then((r) => (r.ok ? r.json() : []))
      .then(setQuotations)
      .catch(() => setQuotations([]));
  }, [load]);

  // Same behaviour as the internal form: unticking a domain clears the
  // products picked under it, so a hidden line cannot be submitted.
  function toggleDomain(d: DomainKey) {
    setForm((f) => {
      const has = f.productDomains.includes(d);
      return {
        ...f,
        productDomains: has ? f.productDomains.filter((x) => x !== d) : [...f.productDomains, d],
        productsRequired: has
          ? f.productsRequired.filter((p) => !p.product.startsWith(`${DOMAIN_DISPLAY_NAME[d]}: `))
          : f.productsRequired
      };
    });
  }

  function toggleProduct(tag: string) {
    setForm((f) => {
      const exists = f.productsRequired.find((p) => p.product === tag);
      return {
        ...f,
        productsRequired: exists
          ? f.productsRequired.filter((p) => p.product !== tag)
          : [...f.productsRequired, { product: tag, quantity: 1 }]
      };
    });
  }

  function setProductQty(tag: string, quantity: number) {
    setForm((f) => ({
      ...f,
      productsRequired: f.productsRequired.map((p) => (p.product === tag ? { ...p, quantity: Math.max(1, quantity) } : p))
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/partner/demos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error || 'Could not submit your request.');
        return;
      }
      setForm(EMPTY);
      setShowForm(false);
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    setError('');
    const response = await fetch(`/api/partner/demos/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error || 'Could not withdraw this request.');
      return;
    }
    await load();
  }

  return (
    <PartnerShell
      title="Demo Requests"
      subtitle="Request a product demonstration for your customer"
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      {error && <div className={historyStyles.loginError}>{error}</div>}

      {showForm ? (
        <form className={calcStyles.sectionPanel} onSubmit={submit}>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Request a demo</h2>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="dproject">Project</label>
              <select id="dproject" className={calcStyles.formControl} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">— Select project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.reference} — {p.company || p.client_name}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="dquote">Quotation</label>
              <select id="dquote" className={calcStyles.formControl} value={form.quotationId} onChange={(e) => setForm({ ...form, quotationId: e.target.value })}>
                <option value="">-- None / not linked yet --</option>
                {quotations.map((q) => (
                  <option key={q.id} value={q.id}>{q.quotation_number}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="dclient">Client name *</label>
            <input id="dclient" className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required />
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="dcompany">Company</label>
              <input id="dcompany" className={calcStyles.formControl} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="dloc1">Location</label>
              <input id="dloc1" className={calcStyles.formControl} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
          </div>

          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="dmode">How is the demo given?</label>
            <select id="dmode" className={calcStyles.formControl} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="onsite">At the client&apos;s site — equipment is sent</option>
              <option value="virtual">Online — screen share, nothing shipped</option>
            </select>
            {/* The same consequence the internal form spells out, so a
                partner understands why an onsite demo takes longer. */}
            <span className={calcStyles.small}>
              {form.mode === 'virtual'
                ? 'No delivery challan, dispatch or material return. Approved by the manager, then marked done after the demo.'
                : 'Goes to Back Office for a delivery challan after approval.'}
            </span>
          </div>

          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Domain(s) demonstrated</label>
            <div className={historyStyles.teamGrid}>
              {ALL_DOMAINS.map((d) => (
                <label key={d}>
                  <input type="checkbox" checked={form.productDomains.includes(d)} onChange={() => toggleDomain(d)} />
                  {DOMAIN_DISPLAY_NAME[d]}
                </label>
              ))}
            </div>
          </div>

          {/* The per-domain catalogue, straight from lib/domainProducts.ts —
              the same products, quantities and no-catalogue message the
              internal form shows. */}
          {form.productDomains.map((d) => {
            const catalog = getDomainProducts(d);
            if (!catalog.length) {
              return (
                <div key={d} className={`${calcStyles.small} ${calcStyles.mb8}`}>
                  No fixed product catalog for {DOMAIN_DISPLAY_NAME[d]} — describe what&apos;s required in Notes below.
                </div>
              );
            }
            return (
              <div key={d} className={calcStyles.field}>
                <label className={calcStyles.label}>{DOMAIN_DISPLAY_NAME[d]} products required</label>
                <div className={historyStyles.teamGrid}>
                  {catalog.map((product) => {
                    const tag = `${DOMAIN_DISPLAY_NAME[d]}: ${product}`;
                    const line = form.productsRequired.find((p) => p.product === tag);
                    return (
                      <label key={tag} className={calcStyles.inlineFlexGap6}>
                        <input type="checkbox" checked={!!line} onChange={() => toggleProduct(tag)} />
                        {product}
                        {line && (
                          <input
                            type="number"
                            min={1}
                            className={`${calcStyles.formControl} ${calcStyles.qtyInputMini}`}
                            value={line.quantity}
                            onClick={(e) => e.preventDefault()}
                            onChange={(e) => setProductQty(tag, parseInt(e.target.value, 10) || 1)}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="ddate">Demo date &amp; time *</label>
              <input
                id="ddate"
                type="datetime-local"
                className={calcStyles.formControl}
                value={form.preferredDate}
                onChange={(e) => setForm({ ...form, preferredDate: e.target.value })}
                required
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="dpriority">Priority</label>
              <select id="dpriority" className={calcStyles.formControl} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="dobj">Demo objective</label>
            <textarea id="dobj" rows={3} className={calcStyles.formControl} value={form.demoObjective} onChange={(e) => setForm({ ...form, demoObjective: e.target.value })} />
          </div>

          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="dreq">Notes</label>
            <textarea id="dreq" rows={3} className={calcStyles.formControl} value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} />
          </div>

          {/* The internal form ends by naming who must approve. The partner
              gets the same sentence, minus the named internal approvers —
              who those people are is staffing information. */}
          <p className={calcStyles.small}>
            This request goes to our technical team for availability, then a manager, and the technical person is
            assigned by your sales contact.
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className={calcStyles.btn} disabled={busy}>{busy ? 'Submitting...' : 'Submit request'}</button>
            <button type="button" className={historyStyles.button} onClick={() => { setShowForm(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <section className={styles.intro}>
          <h2 className={styles.introTitle}>Request a demonstration</h2>
          <p className={styles.introSub}>
            Tell us what your customer wants to see and when suits them. We will confirm availability and assign the right
            technical person.
          </p>
          <button type="button" className={calcStyles.btn} style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>+ New demo request</button>
        </section>
      )}

      <h3 className={styles.sectionHeading}>Your requests</h3>
      {status && <div className={historyStyles.status}>{status}</div>}
      {demos.map((d) => {
        const steps = buildSteps(d);
        return (
          <div key={d.id} className={calcStyles.sectionPanel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>{d.company || d.client_name}</strong>
                <div className={calcStyles.small}>
                  {d.mode === 'virtual' ? 'Online demo' : 'Onsite demo'}
                  {d.location ? ` · ${d.location}` : ''}
                  {' · requested '}{new Date(d.created_at).toLocaleDateString('en-IN')}
                </div>
              </div>
              {/* The internal status, verbatim — same words the sales team
                  reads, so a phone call about it needs no translating. */}
              <span className={historyStyles.statusPill}>{d.internal_status_label}</span>
            </div>

            {steps ? (
              <div style={{ margin: '14px 0' }}>
                <WorkflowStepper steps={steps} />
              </div>
            ) : (
              <p className={calcStyles.small} style={{ marginTop: 10 }}>This request was cancelled.</p>
            )}

            <div className={styles.statCardRow}>
              <div className={styles.statCard}>
                <span className={styles.statCardLabel}>Requested for</span>
                <span className={styles.statCardValue}>
                  {d.requested_date ? new Date(d.requested_date).toLocaleDateString('en-IN') : '—'}
                </span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statCardLabel}>Confirmed date</span>
                <span className={styles.statCardValue}>
                  {d.scheduled_at ? new Date(d.scheduled_at).toLocaleString('en-IN') : 'Not yet confirmed'}
                </span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statCardLabel}>Technical person</span>
                <span className={styles.statCardValue}>
                  {d.assigned_technical_person || 'Not yet assigned'}
                  {/* Stated plainly so nobody asks the partner to pick: the
                      sales person assigns, exactly as internally. */}
                  <span className={styles.statCardSub}>Assigned by your sales contact</span>
                </span>
              </div>
            </div>

            {d.requirements && (
              <p className={calcStyles.small}><strong>What you asked for:</strong> {d.requirements}</p>
            )}
            {d.partner_remark && (
              <p className={calcStyles.small}><strong>Update from our team:</strong> {d.partner_remark}</p>
            )}

            {d.can_cancel && (
              <button type="button" className={historyStyles.button} onClick={() => withdraw(d.id)}>
                Withdraw request
              </button>
            )}
          </div>
        );
      })}
    </PartnerShell>
  );
}
