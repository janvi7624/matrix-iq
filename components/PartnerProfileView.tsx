'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import PartnerShell from './PartnerShell';
import { useToast } from './ui/ToastProvider';
import calcStyles from './calculator.module.css';

interface ProfilePayload {
  company_name: string;
  partner_code: string;
  financial_details_scope: 'partner' | 'internal';
  website: string;
  pan_number: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_ifsc_code: string;
  bank_name: string;
}

const EMPTY_FORM = {
  website: '',
  pan_number: '',
  bank_account_name: '',
  bank_account_number: '',
  bank_ifsc_code: '',
  bank_name: ''
};

// The partner's self-service counterpart to the admin/RM fields on
// PartnerDetailView — only reachable at all when this partner's account has
// financial_details_scope: 'partner' (set on PartnerCreateView, or later by
// an admin/RM). For 'internal' accounts the page explains who to contact
// instead of showing a form nothing will accept.
export default function PartnerProfileView({ companyName, partnerCode }: { companyName: string; partnerCode: string }) {
  const toast = useToast();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/partner/profile');
      const body = await res.json().catch(() => null);
      if (!res.ok) { setFailed(body?.error || 'Could not load your company profile.'); return; }
      setData(body);
      setForm({
        website: body.website || '',
        pan_number: body.pan_number || '',
        bank_account_name: body.bank_account_name || '',
        bank_account_number: body.bank_account_number || '',
        bank_ifsc_code: body.bank_ifsc_code || '',
        bank_name: body.bank_name || ''
      });
      setFailed('');
    } catch {
      setFailed('Could not reach the server.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/partner/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { toast.error(body?.error || 'Could not save.'); return; }
      toast.success('Company profile saved.');
      await load();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PartnerShell title="Company Profile" subtitle="PAN, bank details and website on file for your company." partnerName={companyName} partnerCode={partnerCode}>
      {failed && <div className={calcStyles.small}>{failed}</div>}

      {!data ? (
        <div className={calcStyles.sectionPanel}><p className={calcStyles.small}>Loading…</p></div>
      ) : data.financial_details_scope !== 'partner' ? (
        <div className={calcStyles.sectionPanel}>
          <p className={calcStyles.small}>
            Your PAN number, bank details and website are maintained by your account manager, not here —
            contact them for any change.
          </p>
        </div>
      ) : (
        <form className={calcStyles.sectionPanel} onSubmit={submit}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="website">Website</label>
            <input id="website" className={calcStyles.formControl} value={form.website} onChange={(e) => set('website', e.target.value)} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="pan_number">PAN number</label>
            <input id="pan_number" className={calcStyles.formControl} value={form.pan_number} onChange={(e) => set('pan_number', e.target.value.toUpperCase())} />
          </div>

          <h2 className={calcStyles.h2}>Bank details</h2>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="bank_name">Bank name</label>
              <input id="bank_name" className={calcStyles.formControl} value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="bank_account_name">Account holder name</label>
              <input id="bank_account_name" className={calcStyles.formControl} value={form.bank_account_name} onChange={(e) => set('bank_account_name', e.target.value)} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="bank_account_number">Account number</label>
              <input id="bank_account_number" className={calcStyles.formControl} value={form.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value)} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="bank_ifsc_code">IFSC code</label>
              <input id="bank_ifsc_code" className={calcStyles.formControl} value={form.bank_ifsc_code} onChange={(e) => set('bank_ifsc_code', e.target.value.toUpperCase())} />
            </div>
          </div>

          <button type="submit" className={calcStyles.btn} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </form>
      )}
    </PartnerShell>
  );
}
