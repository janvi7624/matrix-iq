'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import StateCitySelect from './ui/StateCitySelect';
import { useToast } from './ui/ToastProvider';
import { PROJECT_DEPARTMENTS, PROJECT_DEPARTMENT_LABEL, ProjectDepartment } from '@/lib/projectDepartmentOptions';
import { partnerCodePrefix } from '@/lib/partnerCode';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerWorkspace.module.css';

// Creating a partner from inside the Partner module.
//
// Only the company name is required. Everything else is editable on the
// partner's own page afterwards, and asking for it all up front is how a
// form stops getting filled in — the point of this screen is to get the
// account made so the portal login can be issued and the documents can
// start arriving.
export default function PartnerCreateView() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    gst_number: ''
  });
  const [saving, setSaving] = useState(false);
  // Which way the documents will arrive. Only affects where this form sends
  // you next — the upload itself happens on the partner's own page, which is
  // also where it can be done later if the answer changes.
  const [documentSource, setDocumentSource] = useState<'partner' | 'us'>('partner');
  // Drives the partner code's PTR-AI-/PTR-ROB-/PTR-AV-/PTR-ALL- segment (see
  // lib/partnerCode.ts) — not asked for anywhere else on this deliberately
  // minimal form, so it has to be collected here.
  const [departments, setDepartments] = useState<ProjectDepartment[]>([]);
  // Who will fill in PAN, bank details and website: checked lets the partner
  // do it themselves later on their own portal login; unchecked (default)
  // keeps it admin/RM-only, entered on the partner's page after creation —
  // same "decide now, fill in later" shape as documentSource above, and for
  // the same reason (nobody fills in a form this long in one sitting).
  const [partnerManagesFinancials, setPartnerManagesFinancials] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDepartment(d: ProjectDepartment) {
    setDepartments((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.company_name.trim()) { toast.error('Company name is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          departments,
          financial_details_scope: partnerManagesFinancials ? 'partner' : 'internal'
        })
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { toast.error(body?.error || 'Could not create this partner.'); return; }
      toast.success(
        documentSource === 'us'
          ? 'Partner created. Upload their documents below — each one counts as approved.'
          : 'Partner created. Issue their portal login next, then they upload their documents for you to approve.'
      );
      router.push(`/partners/${body.partner.id}`);
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="New partner" subtitle="Partner › create a partner account you will manage.">
      <form className={calcStyles.sectionPanel} onSubmit={submit}>
        <p className={calcStyles.small}>
          You will be recorded as this partner&apos;s relationship manager, so it appears in your Partner list and you approve its
          Agreement, NDA, GST and PAN. The partner cannot use the portal until all of them are approved.
        </p>

        <div className={calcStyles.field}>
          <label className={calcStyles.label} htmlFor="company_name">Company name *</label>
          <input
            id="company_name"
            className={calcStyles.formControl}
            value={form.company_name}
            onChange={(e) => set('company_name', e.target.value)}
            autoFocus
          />
        </div>

        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="contact_person">Contact person</label>
            <input id="contact_person" className={calcStyles.formControl} value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="email">Email</label>
            <input id="email" type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="phone">Phone</label>
            <input id="phone" className={calcStyles.formControl} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>

        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <StateCitySelect
            state={form.state}
            city={form.city}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            idPrefix="partnerCreate"
          />
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="gst_number">GST number</label>
            <input id="gst_number" className={calcStyles.formControl} value={form.gst_number} onChange={(e) => set('gst_number', e.target.value)} />
          </div>
        </div>

        {/* Determines the partner code's segment (PTR-AI-0002, PTR-ROB-0002,
            PTR-AV-0002, or PTR-ALL-0002 for all three) — see
            lib/partnerCode.ts. Optional: left blank, the partner gets the
            plain PTR-#### series, same as before this existed. */}
        <div className={calcStyles.field}>
          <span className={calcStyles.label}>Departments</span>
          <div className={styles.choiceRow}>
            {PROJECT_DEPARTMENTS.filter((d) => d !== 'other').map((d) => (
              <label key={d} className={calcStyles.small}>
                <input type="checkbox" checked={departments.includes(d)} onChange={() => toggleDepartment(d)} />{' '}
                {PROJECT_DEPARTMENT_LABEL[d]}
              </label>
            ))}
          </div>
          <span className={calcStyles.small}>
            Partner code will start <strong>{partnerCodePrefix(departments)}</strong>
            {partnerCodePrefix(departments) === 'PTR-' ? ' (no department, or more than one without all three)' : ''}.
          </span>
        </div>

        {/* Who maintains PAN, bank details and website. Neither is asked for
            here — same reasoning as the document choice below: get the
            account made first, fill the rest in afterwards, on whichever
            page ends up owning it. */}
        <div className={calcStyles.field}>
          <label className={calcStyles.small}>
            <input
              type="checkbox"
              checked={partnerManagesFinancials}
              onChange={(e) => setPartnerManagesFinancials(e.target.checked)}
            />{' '}
            <strong>Let the partner fill in their own PAN number, bank details & website</strong>
          </label>
          <span className={calcStyles.small}>
            {partnerManagesFinancials
              ? 'They get a new "Company Profile" page in their own portal login to fill and edit these themselves.'
              : 'Left unchecked: these stay admin/RM-only, entered on this partner’s page after creation.'}
          </span>
        </div>

        {/* Who provides the Agreement, NDA, GST and PAN.
            Asked here because the answer changes what happens next, and
            because a signed agreement often already exists — reaching us by
            email long before the partner logs in. */}
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Who will provide the onboarding documents?</label>
          <div className={styles.choiceRow}>
            <label className={`${styles.choice} ${documentSource === 'partner' ? styles.choiceActive : ''}`}>
              <input
                type="radio"
                name="documentSource"
                checked={documentSource === 'partner'}
                onChange={() => setDocumentSource('partner')}
              />
              <span>
                <strong>The partner uploads them</strong>
                <span className={calcStyles.small}>
                  They sign in, upload them all, and you approve each one. They cannot use the rest of the portal until you do.
                </span>
              </span>
            </label>
            <label className={`${styles.choice} ${documentSource === 'us' ? styles.choiceActive : ''}`}>
              <input
                type="radio"
                name="documentSource"
                checked={documentSource === 'us'}
                onChange={() => setDocumentSource('us')}
              />
              <span>
                <strong>I already have them</strong>
                <span className={calcStyles.small}>
                  You upload them on the partner&apos;s page straight after this. They count as approved, since you are the approver.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className={historyStyles.formActions}>
          <button type="submit" className={calcStyles.btn} disabled={saving}>
            {saving ? 'Creating…' : documentSource === 'us' ? 'Create & upload documents' : 'Create partner'}
          </button>
          <button type="button" className={historyStyles.button} onClick={() => router.push('/partners')}>Cancel</button>
        </div>
      </form>
    </AppShell>
  );
}
