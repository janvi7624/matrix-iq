'use client';

import { useEffect, useState } from 'react';
import { AppConfig, NotificationTemplate } from '@/lib/types';
import AppShell from '@/components/AppShell';
import styles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import pageStyles from './settingsPage.module.css';

export default function ApplicationSettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [saving, setSaving] = useState(false);
  const [termsText, setTermsText] = useState('');
  const [users, setUsers] = useState<{ id: string; username: string; name: string }[]>([]);

  useEffect(() => {
    fetch('/api/users/lite').then((r) => (r.ok ? r.json() : [])).then(setUsers).catch(() => setUsers([]));
  }, []);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/admin/settings');
      if (!response.ok) throw new Error(String(response.status));
      const data: AppConfig = await response.json();
      setConfig(data);
      setTermsText(data.quotationTerms.join('\n'));
      setStatus('');
    } catch {
      setStatus('Could not load settings. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function setTemplate(index: number, patch: Partial<NotificationTemplate>) {
    setConfig((prev) => {
      if (!prev) return prev;
      const templates = prev.notificationTemplates.map((t, i) => (i === index ? { ...t, ...patch } : t));
      return { ...prev, notificationTemplates: templates };
    });
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setStatus('Saving...');
    try {
      const payload = { ...config, quotationTerms: termsText.split('\n').map((t) => t.trim()).filter(Boolean) };
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: AppConfig = await response.json();
      setConfig(updated);
      setTermsText(updated.quotationTerms.join('\n'));
      setStatus('Saved.');
    } catch {
      setStatus('Could not save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Application Configuration" subtitle="Administration › company details, tax, terms, and numbering — no code required.">
        <div className={styles.status}>{status}</div>
        {config && (
          <>
            <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Company Information</h2>
            <div className={calcStyles.sectionPanel}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Display name</label>
                  <input className={calcStyles.formControl} value={config.companyName} onChange={(e) => set('companyName', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Legal name</label>
                  <input className={calcStyles.formControl} value={config.companyLegalName} onChange={(e) => set('companyLegalName', e.target.value)} />
                </div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>GST number</label>
                  <input className={calcStyles.formControl} value={config.gstNumber} onChange={(e) => set('gstNumber', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>PAN number</label>
                  <input className={calcStyles.formControl} value={config.panNumber} onChange={(e) => set('panNumber', e.target.value)} />
                </div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Address line 1</label>
                <input className={calcStyles.formControl} value={config.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Address line 2</label>
                <input className={calcStyles.formControl} value={config.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Address line 3</label>
                <input className={calcStyles.formControl} value={config.addressLine3} onChange={(e) => set('addressLine3', e.target.value)} />
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Contact phone</label>
                  <input className={calcStyles.formControl} value={config.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Contact email</label>
                  <input className={calcStyles.formControl} value={config.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Website</label>
                  <input className={calcStyles.formControl} value={config.website} onChange={(e) => set('website', e.target.value)} />
                </div>
              </div>
            </div>

            <h2 className={calcStyles.h2}>Bank Details</h2>
            <div className={calcStyles.sectionPanel}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Account name</label>
                  <input className={calcStyles.formControl} value={config.bankAccountName} onChange={(e) => set('bankAccountName', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Account number</label>
                  <input className={calcStyles.formControl} value={config.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value)} />
                </div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Bank name</label>
                  <input className={calcStyles.formControl} value={config.bankName} onChange={(e) => set('bankName', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Branch</label>
                  <input className={calcStyles.formControl} value={config.bankBranch} onChange={(e) => set('bankBranch', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>IFSC</label>
                  <input className={calcStyles.formControl} value={config.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value)} />
                </div>
              </div>
            </div>

            <h2 className={calcStyles.h2}>Currency &amp; Tax</h2>
            <div className={calcStyles.sectionPanel}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Currency code</label>
                  <input className={calcStyles.formControl} value={config.currencyCode} onChange={(e) => set('currencyCode', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Currency symbol</label>
                  <input className={calcStyles.formControl} value={config.currencySymbol} onChange={(e) => set('currencySymbol', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Tax label</label>
                  <input className={calcStyles.formControl} value={config.taxLabel} onChange={(e) => set('taxLabel', e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Default tax %</label>
                  <input className={calcStyles.formControl} type="number" value={config.defaultTaxPercent} onChange={(e) => set('defaultTaxPercent', parseFloat(e.target.value) || 0)} />
                </div>
              </div>
            </div>

            <h2 className={calcStyles.h2}>Quotation Terms &amp; Conditions</h2>
            <div className={calcStyles.sectionPanel}>
              <div className={styles.status}>One term per line — printed as a numbered list on every quotation PDF from now on.</div>
              <textarea className={calcStyles.formControl} rows={10} value={termsText} onChange={(e) => setTermsText(e.target.value)} />
            </div>

            <h2 className={calcStyles.h2}>Number Series</h2>
            <div className={calcStyles.sectionPanel}>
              <div className={`${calcStyles.field} ${pageStyles.maxWidth260}`}>
                <label className={calcStyles.label}>Delivery Challan prefix</label>
                <input className={calcStyles.formControl} value={config.dcNumberPrefix} onChange={(e) => set('dcNumberPrefix', e.target.value)} />
              </div>
              <div className={styles.status}>
                Quotation numbers keep their fixed NT-&lt;domain&gt;-DD/MM/YYYY/### format for now — changing that format touches active parsing logic across the calculator and isn&apos;t safe to make config-driven yet.
              </div>
            </div>

            <h2 className={calcStyles.h2}>Marketing Settings</h2>
            <div className={calcStyles.sectionPanel}>
              <div className={`${calcStyles.field} ${pageStyles.maxWidth320}`}>
                <label className={calcStyles.label}>Marketing Owner</label>
                <select className={calcStyles.formControl} value={config.marketingOwnerId} onChange={(e) => set('marketingOwnerId', e.target.value)}>
                  <option value="">— None selected —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.username} ({u.username})</option>
                  ))}
                </select>
              </div>
              <div className={styles.status}>
                New Marketing Requests are assigned to this person by default when they&apos;re created. This is separate from the Role Management &quot;approve&quot; permission on the marketing-requests module, which controls who can review tickets — the Marketing Owner is just who a new ticket lands on first.
              </div>
            </div>

            <h2 className={calcStyles.h2}>TMS Settings</h2>
            <div className={calcStyles.sectionPanel}>
              <div className={`${calcStyles.field} ${pageStyles.maxWidth320}`}>
                <label className={calcStyles.label}>BOM Finance Approver</label>
                <select className={calcStyles.formControl} value={config.bomFinanceApproverId} onChange={(e) => set('bomFinanceApproverId', e.target.value)}>
                  <option value="">— None selected —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.username} ({u.username})</option>
                  ))}
                </select>
              </div>
              <div className={styles.status}>
                After a TMS BOM Request is approved by its Technical Manager, it needs approval from this person before it can move to Accounts for payment. Changing this doesn&apos;t require a code change — the previous approver just stops being asked.
              </div>
            </div>

            <h2 className={calcStyles.h2}>Notification Templates</h2>
            <div className={calcStyles.sectionPanel}>
              <div className={styles.status}>
                Text templates only — no email/SMS is actually sent yet, since there&apos;s no messaging integration in the app. These are here so the content is ready once that&apos;s wired up.
              </div>
              {config.notificationTemplates.map((t, i) => (
                <div key={t.key} className={`${pageStyles.templateBlock} ${i > 0 ? pageStyles.templateBlockDivider : ''}`}>
                  <div className={pageStyles.templateLabel}>{t.label}</div>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Subject</label>
                    <input className={calcStyles.formControl} value={t.subject} onChange={(e) => setTemplate(i, { subject: e.target.value })} />
                  </div>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Body</label>
                    <textarea className={calcStyles.formControl} rows={2} value={t.body} onChange={(e) => setTemplate(i, { body: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>

            <button type="button" className={calcStyles.btn} disabled={saving} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </>
        )}
    </AppShell>
  );
}
