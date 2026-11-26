'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Building2,
  FileText,
  Handshake,
  Hash,
  Landmark,
  LucideIcon,
  Megaphone,
  Percent,
  Receipt,
  RotateCcw,
  Save,
  Wrench
} from 'lucide-react';
import { AppConfig, NotificationTemplate } from '@/lib/types';
import AppShell from '@/components/AppShell';
import CommonButton from '@/components/ui/CommonButton';
import CommonChip from '@/components/ui/CommonChip';
import SearchInput from '@/components/ui/SearchInput';
import Select from '@/components/ui/Select';
import ErrorState from '@/components/ui/ErrorState';
import { Skeleton, SkeletonForm } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/ToastProvider';
import calcStyles from '@/components/calculator.module.css';
import s from './settingsPage.module.css';
import { fetchCached } from '@/lib/fetchCached';

type SectionKey =
  | 'company'
  | 'bank'
  | 'tax'
  | 'terms'
  | 'numbering'
  | 'marketing'
  | 'tms'
  | 'partners'
  | 'reimbursement'
  | 'notifications';

const SECTIONS: { key: SectionKey; title: string; description: string; icon: LucideIcon }[] = [
  { key: 'company', title: 'Company', description: 'Name, registration and contact details', icon: Building2 },
  { key: 'bank', title: 'Bank details', description: 'Printed on quotations and invoices', icon: Landmark },
  { key: 'tax', title: 'Currency & tax', description: 'Currency, tax label and default rate', icon: Percent },
  { key: 'terms', title: 'Quotation terms', description: 'Terms & conditions on every PDF', icon: FileText },
  { key: 'numbering', title: 'Number series', description: 'Document number prefixes', icon: Hash },
  { key: 'marketing', title: 'Marketing', description: 'Who new requests are assigned to', icon: Megaphone },
  { key: 'tms', title: 'TMS', description: 'BOM finance approval', icon: Wrench },
  { key: 'partners', title: 'Partners', description: 'Who can create partner accounts', icon: Handshake },
  { key: 'reimbursement', title: 'Reimbursement', description: 'Monthly submission deadline', icon: Receipt },
  { key: 'notifications', title: 'Notifications', description: 'Message templates', icon: Bell }
];

type User = { id: string; username: string; name: string };

/** One setting: what it is (and why) on the left, the control on the right. */
function SettingRow({ label, help, htmlFor, stack, children }: { label: string; help?: ReactNode; htmlFor?: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={`${s.row} ${stack ? s.rowStack : ''}`}>
      <div className={s.rowText}>
        <label className={s.rowLabel} htmlFor={htmlFor}>
          {label}
        </label>
        {help && <p className={s.rowHelp}>{help}</p>}
      </div>
      <div className={s.rowControl}>{children}</div>
    </div>
  );
}

function TextSetting({ id, label, help, value, onChange, type = 'text', placeholder }: { id: string; label: string; help?: ReactNode; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <SettingRow label={label} help={help} htmlFor={id}>
      <input id={id} type={type} className={calcStyles.formControl} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </SettingRow>
  );
}

export default function ApplicationSettingsPage() {
  const toast = useToast();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [termsText, setTermsText] = useState('');
  // The last loaded/saved version — what "Discard" goes back to and what "unsaved changes" compares against.
  const [saved, setSaved] = useState<{ config: AppConfig; terms: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [creatorSearch, setCreatorSearch] = useState('');
  const [section, setSection] = useState<SectionKey>('company');

  useEffect(() => {
    fetchCached('/api/users/lite').then(setUsers).catch(() => setUsers([]));
  }, []);

  async function load() {
    setLoadError('');
    try {
      const response = await fetch('/api/admin/settings');
      if (!response.ok) throw new Error(String(response.status));
      const data: AppConfig = await response.json();
      const terms = data.quotationTerms.join('\n');
      setConfig(data);
      setTermsText(terms);
      setSaved({ config: data, terms });
    } catch {
      setLoadError('Could not load settings.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const dirty = useMemo(
    () => !!config && !!saved && (termsText !== saved.terms || JSON.stringify(config) !== JSON.stringify(saved.config)),
    [config, saved, termsText]
  );

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

  function discard() {
    if (!saved) return;
    setConfig(saved.config);
    setTermsText(saved.terms);
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const payload = { ...config, quotationTerms: termsText.split('\n').map((t) => t.trim()).filter(Boolean) };
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: AppConfig = await response.json();
      const terms = updated.quotationTerms.join('\n');
      setConfig(updated);
      setTermsText(terms);
      setSaved({ config: updated, terms });
      toast.success('Settings saved.');
    } catch {
      toast.error('Could not save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const active = SECTIONS.find((x) => x.key === section)!;
  const userLabel = (u: User) => `${u.name || u.username} (${u.username})`;
  const matchingUsers = users.filter((u) => `${u.name} ${u.username}`.toLowerCase().includes(creatorSearch.trim().toLowerCase()));

  function renderSection(c: AppConfig) {
    switch (section) {
      case 'company':
        return (
          <>
            <div className={s.group}>
              <h3 className={s.groupTitle}>Identity</h3>
              <TextSetting id="st-name" label="Display name" help="Shown in the app and on documents." value={c.companyName} onChange={(v) => set('companyName', v)} />
              <TextSetting id="st-legal" label="Legal name" help="Registered name for invoices and agreements." value={c.companyLegalName} onChange={(v) => set('companyLegalName', v)} />
              <TextSetting id="st-gst" label="GST number" value={c.gstNumber} onChange={(v) => set('gstNumber', v)} />
              <TextSetting id="st-pan" label="PAN number" value={c.panNumber} onChange={(v) => set('panNumber', v)} />
            </div>
            <div className={s.group}>
              <h3 className={s.groupTitle}>Address</h3>
              <TextSetting id="st-a1" label="Address line 1" value={c.addressLine1} onChange={(v) => set('addressLine1', v)} />
              <TextSetting id="st-a2" label="Address line 2" value={c.addressLine2} onChange={(v) => set('addressLine2', v)} />
              <TextSetting id="st-a3" label="Address line 3" value={c.addressLine3} onChange={(v) => set('addressLine3', v)} />
            </div>
            <div className={s.group}>
              <h3 className={s.groupTitle}>Contact</h3>
              <TextSetting id="st-phone" label="Contact phone" type="tel" value={c.contactPhone} onChange={(v) => set('contactPhone', v)} />
              <TextSetting id="st-email" label="Contact email" type="email" value={c.contactEmail} onChange={(v) => set('contactEmail', v)} />
              <TextSetting id="st-web" label="Website" type="url" value={c.website} onChange={(v) => set('website', v)} />
            </div>
          </>
        );
      case 'bank':
        return (
          <div className={s.group}>
            <TextSetting id="st-bacc-name" label="Account name" value={c.bankAccountName} onChange={(v) => set('bankAccountName', v)} />
            <TextSetting id="st-bacc-no" label="Account number" value={c.bankAccountNumber} onChange={(v) => set('bankAccountNumber', v)} />
            <TextSetting id="st-bank" label="Bank name" value={c.bankName} onChange={(v) => set('bankName', v)} />
            <TextSetting id="st-branch" label="Branch" value={c.bankBranch} onChange={(v) => set('bankBranch', v)} />
            <TextSetting id="st-ifsc" label="IFSC" value={c.bankIfsc} onChange={(v) => set('bankIfsc', v)} />
          </div>
        );
      case 'tax':
        return (
          <div className={s.group}>
            <TextSetting id="st-cur-code" label="Currency code" help="e.g. INR" value={c.currencyCode} onChange={(v) => set('currencyCode', v)} />
            <TextSetting id="st-cur-sym" label="Currency symbol" help="e.g. ₹" value={c.currencySymbol} onChange={(v) => set('currencySymbol', v)} />
            <TextSetting id="st-tax-label" label="Tax label" help="e.g. GST — used in totals and line items." value={c.taxLabel} onChange={(v) => set('taxLabel', v)} />
            <SettingRow label="Default tax %" help="Pre-filled on new products and quotation lines." htmlFor="st-tax">
              <div className={s.suffixInput}>
                <input id="st-tax" type="number" className={calcStyles.formControl} value={c.defaultTaxPercent} onChange={(e) => set('defaultTaxPercent', parseFloat(e.target.value) || 0)} />
                <span className={s.suffix}>%</span>
              </div>
            </SettingRow>
          </div>
        );
      case 'terms':
        return (
          <div className={s.group}>
            <SettingRow stack label="Terms & conditions" help="One term per line — printed as a numbered list on every quotation PDF from now on." htmlFor="st-terms">
              <textarea id="st-terms" className={calcStyles.formControl} rows={12} value={termsText} onChange={(e) => setTermsText(e.target.value)} />
              <div className={s.counter}>{termsText.split('\n').filter((t) => t.trim()).length} terms</div>
            </SettingRow>
          </div>
        );
      case 'numbering':
        return (
          <div className={s.group}>
            <TextSetting id="st-dc" label="Delivery Challan prefix" help="Added in front of every new Delivery Challan number." value={c.dcNumberPrefix} onChange={(v) => set('dcNumberPrefix', v)} />
            <div className={s.note}>
              Quotation numbers keep their fixed NT-&lt;domain&gt;-DD/MM/YYYY/### format for now — changing that format touches active parsing logic across the calculator and isn&apos;t safe to make config-driven yet.
            </div>
          </div>
        );
      case 'marketing':
        return (
          <div className={s.group}>
            <SettingRow
              label="Marketing owner"
              htmlFor="st-mkt-owner"
              help="New Marketing Requests are assigned to this person when they're created. Who can review tickets is set separately in Role Management."
            >
              <Select id="st-mkt-owner" value={c.marketingOwnerId} onChange={(e) => set('marketingOwnerId', e.target.value)}>
                <option value="">— None selected —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{userLabel(u)}</option>
                ))}
              </Select>
            </SettingRow>
          </div>
        );
      case 'tms':
        return (
          <div className={s.group}>
            <SettingRow
              label="BOM finance approver"
              htmlFor="st-bom"
              help="After a Technical Manager approves a TMS BOM Request, this person approves it before it moves to Accounts for payment."
            >
              <Select id="st-bom" value={c.bomFinanceApproverId} onChange={(e) => set('bomFinanceApproverId', e.target.value)}>
                <option value="">— None selected —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{userLabel(u)}</option>
                ))}
              </Select>
            </SettingRow>
          </div>
        );
      case 'partners':
        return (
          <div className={s.group}>
            {/* A list of named people, not a role: the sales staff who bring
                partners in share the generic 'user' role with many other
                accounts, so granting it to the role would hand partner
                creation to all of them. */}
            <SettingRow
              stack
              label="Who can create partner accounts"
              help={
                <>
                  These people get the <strong>Partner</strong> module without being made admins. Each partner they create is theirs: they approve its Agreement, NDA, GST and PAN, and see only their own partners. A change applies from the person&apos;s next sign-in.
                </>
              }
            >
              <div className={s.chosen}>
                {c.partnerCreatorIds.length === 0 && <span className={s.muted}>Nobody yet — pick people below.</span>}
                {c.partnerCreatorIds.map((id) => {
                  const u = users.find((x) => x.id === id);
                  return (
                    <CommonChip
                      key={id}
                      size="sm"
                      tone="brand"
                      label={u ? u.name || u.username : 'Unknown user'}
                      removeLabel={`Remove ${u ? u.name || u.username : 'this user'}`}
                      onRemove={() => set('partnerCreatorIds', c.partnerCreatorIds.filter((x) => x !== id))}
                    />
                  );
                })}
              </div>
              <SearchInput value={creatorSearch} placeholder={`Search ${users.length} people by name or username…`} aria-label="Search people" onChange={(v) => setCreatorSearch(v)} />
              <div className={s.people}>
                {matchingUsers.map((u) => {
                  const chosen = c.partnerCreatorIds.includes(u.id);
                  return (
                    <label key={u.id} className={`${s.person} ${chosen ? s.personOn : ''}`}>
                      <input
                        type="checkbox"
                        checked={chosen}
                        onChange={() => set('partnerCreatorIds', chosen ? c.partnerCreatorIds.filter((id) => id !== u.id) : [...c.partnerCreatorIds, u.id])}
                      />
                      <span className={s.personName}>{u.name || u.username}</span>
                      <span className={s.personUser}>@{u.username}</span>
                    </label>
                  );
                })}
                {matchingUsers.length === 0 && <p className={s.muted}>Nobody matches that.</p>}
              </div>
            </SettingRow>
          </div>
        );
      case 'reimbursement':
        return (
          <div className={s.group}>
            <SettingRow
              label="Submission deadline"
              htmlFor="st-reimb"
              help="Employees can submit a reimbursement sheet through this day of each month. Leave blank for no deadline. HR can still extend a specific month from the Reimbursement page."
            >
              <div className={s.suffixInput}>
                <input
                  id="st-reimb"
                  type="number"
                  min={1}
                  max={31}
                  className={calcStyles.formControl}
                  value={c.reimbursementDeadlineDay ?? ''}
                  placeholder="No deadline"
                  onChange={(e) => set('reimbursementDeadlineDay', e.target.value === '' ? null : Number(e.target.value))}
                />
                <span className={s.suffix}>day of month</span>
              </div>
            </SettingRow>
          </div>
        );
      case 'notifications':
        return (
          <>
            <div className={s.note}>
              Text templates only — no email/SMS is sent yet, since there&apos;s no messaging integration in the app. They&apos;re here so the content is ready once that&apos;s wired up.
            </div>
            {c.notificationTemplates.map((t, i) => (
              <div key={t.key} className={s.group}>
                <h3 className={s.groupTitle}>{t.label}</h3>
                <TextSetting id={`st-tpl-${t.key}-subject`} label="Subject" value={t.subject} onChange={(v) => setTemplate(i, { subject: v })} />
                <SettingRow label="Body" htmlFor={`st-tpl-${t.key}-body`}>
                  <textarea id={`st-tpl-${t.key}-body`} className={calcStyles.formControl} rows={3} value={t.body} onChange={(e) => setTemplate(i, { body: e.target.value })} />
                </SettingRow>
              </div>
            ))}
          </>
        );
    }
  }

  // fillPage: the screen itself doesn't scroll — the settings form scrolls inside its panel.
  return (
    <AppShell fillPage title="Application Configuration" subtitle="Administration › company details, tax, terms, and numbering — no code required.">
      {loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : (
        <div className={s.layout}>
          {/* Left: every settings area. A column on desktop, a scrollable strip on smaller screens. */}
          <nav className={s.nav} aria-label="Settings sections">
            {SECTIONS.map(({ key, title, description, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={`${s.navItem} ${section === key ? s.navItemActive : ''}`}
                aria-current={section === key ? 'page' : undefined}
                onClick={() => setSection(key)}
              >
                <span className={s.navIcon} aria-hidden="true">
                  <Icon />
                </span>
                <span className={s.navText}>
                  <span className={s.navTitle}>{title}</span>
                  <span className={s.navDesc}>{description}</span>
                </span>
              </button>
            ))}
          </nav>

          {/* Right: the chosen area's settings. */}
          <section className={s.panel} aria-labelledby="settings-panel-title">
            <header className={s.panelHead}>
              <span className={s.panelIcon} aria-hidden="true">
                <active.icon />
              </span>
              <div>
                <h2 id="settings-panel-title" className={s.panelTitle}>{active.title}</h2>
                <p className={s.panelDesc}>{active.description}</p>
              </div>
            </header>

            <div className={s.panelBody}>
              {config ? (
                renderSection(config)
              ) : (
                <div className={s.group}>
                  <Skeleton width="30%" height={14} />
                  <SkeletonForm fields={5} />
                </div>
              )}
            </div>

            {/* Always in reach: shows when something changed, one save for every section. */}
            <footer className={`${s.saveBar} ${dirty ? s.saveBarDirty : ''}`}>
              <span className={s.saveState} aria-live="polite">
                {dirty ? 'You have unsaved changes' : 'All changes saved'}
              </span>
              <div className={s.saveActions}>
                <CommonButton variant="ghost" size="md" leadingIcon={<RotateCcw />} disabled={!dirty || saving} onClick={discard}>
                  Discard
                </CommonButton>
                <CommonButton variant="primary" size="md" leadingIcon={<Save />} disabled={!dirty || !config} loading={saving} loadingLabel="Saving…" onClick={handleSave}>
                  Save settings
                </CommonButton>
              </div>
            </footer>
          </section>
        </div>
      )}
    </AppShell>
  );
}
