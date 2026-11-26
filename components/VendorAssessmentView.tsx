'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import AppShell from './AppShell';
import CommonButton from './ui/CommonButton';
import CommonChip from './ui/CommonChip';
import SearchInput from './ui/SearchInput';
import StatCard, { StatCardGrid, StatCardTone } from './ui/StatCard';
import { useToast } from './ui/ToastProvider';
import { Skeleton, SkeletonCards } from './ui/Skeleton';
import styles from './vendorAssessment.module.css';
import {
  EMPTY_CONTACT,
  VENDOR_APPROVAL_STAGES,
  VENDOR_CATEGORIES,
  VENDOR_CONTACT_ROLES,
  VENDOR_DOCUMENTS,
  VENDOR_RELATIONS,
  VENDOR_STAGE_LABEL,
  VendorAssessmentRecord,
  VendorContact,
  VendorContactRole,
  VendorFile,
  relationLabel
} from '@/lib/vendorAssessmentShared';

type Row = VendorAssessmentRecord & { can_edit: boolean; can_decide: boolean };
type Tab = 'action' | 'pending' | 'approved' | 'rejected' | 'all';

interface FormState {
  company_name: string;
  address: string;
  contacts: Record<VendorContactRole, VendorContact>;
  business_purpose: string;
  categories: string[];
  relation_type: string;
  collaboration_date: string;
  agreement_period: string;
  documents: Record<string, VendorFile[]>;
  project_deal_details: string;
  initiated_by_ids: string[];
  overview_remarks: string;
}

const emptyContacts = () =>
  Object.fromEntries(VENDOR_CONTACT_ROLES.map((r) => [r.key, { ...EMPTY_CONTACT }])) as Record<VendorContactRole, VendorContact>;

const EMPTY_FORM = (): FormState => ({
  company_name: '',
  address: '',
  contacts: emptyContacts(),
  business_purpose: '',
  categories: [],
  relation_type: '',
  collaboration_date: '',
  agreement_period: '',
  documents: {},
  project_deal_details: '',
  initiated_by_ids: [],
  overview_remarks: ''
});

// Plain-language guide for every step of the form — what to fill, why, and an example.
const WIZARD = [
  { title: 'Company', help: 'Type the vendor company name exactly as on their letterhead. Add their address and, in one line, why we want to work with them.', example: 'e.g. “Supplies LED video walls for our AV projects in Gujarat.”' },
  { title: 'Contacts', help: 'Who do we talk to at the vendor? Fill at least ONE person. Leave the other boxes empty if you don’t know them.', example: 'Tip: Purchase = who sends quotes, Finance = who handles payments.' },
  { title: 'Relation', help: 'Tap what they sell (AV / AI / Robotics — you can tap more than one), then tap how they work with Nanta.', example: 'Not sure? Choose “Project partner only” — the approver can correct it.' },
  { title: 'Documents', help: 'Attach the SIGNED copies you have. Skip any you don’t have — this step is optional.', example: 'PDF, image or Word file, up to 10 MB each.' },
  { title: 'Deal', help: 'Short description of the project or deal with this vendor. Optional.', example: 'e.g. “Supplying 4 robots for XYZ Mall, ₹12 L, delivery in March.”' },
  { title: 'Team', help: 'Who from Nanta brought this vendor in? Search the name and tick it. Tick more than one if needed.', example: 'Usually the sales person who met the vendor.' },
  { title: 'Remarks', help: 'Anything the approvers should know — your overall opinion of this vendor. Then press Submit.', example: 'After you submit: VP / GM Sales → Finance → MD approve it, one after another.' }
];

const STATUS_LABEL = { pending: 'In approval', approved: 'Approved', rejected: 'Rejected' } as const;

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysSince(v: string) {
  const d = new Date(v).getTime();
  return Number.isNaN(d) ? 0 : Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

const RELATION_TONE: Record<string, string> = { trading: 'toneBlue', distribution: 'toneViolet', joint_venture: 'toneAmber', project: 'toneTeal' };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
}

export default function VendorAssessmentView({ currentUserId }: { currentUserId: string }) {
  const toast = useToast();
  const params = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [approverNames, setApproverNames] = useState<Record<string, string[]>>({});
  const [isPrivileged, setIsPrivileged] = useState(false);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(params.get('open'));
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [guideOpen, setGuideOpen] = useState(() => {
    try {
      return typeof window === 'undefined' || window.localStorage.getItem('va-guide-hidden') !== '1';
    } catch {
      return true;
    }
  });
  const [uploadingKey, setUploadingKey] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [remarks, setRemarks] = useState('');
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/vendor-assessments');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not load vendor assessments.');
      setRows(body.rows);
      setApproverNames(body.approverNames || {});
      setIsPrivileged(!!body.isPrivileged);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load vendor assessments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetch('/api/users/lite')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string }[]) => setTeam(list))
      .catch(() => undefined);
  }, [load]);

  const counts = useMemo(
    () => ({
      action: rows.filter((r) => r.can_decide).length,
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      all: rows.length
    }),
    [rows]
  );
  const activeTab: Tab = tab ?? (counts.action ? 'action' : 'all');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeTab === 'action' && !r.can_decide) return false;
      if (activeTab !== 'action' && activeTab !== 'all' && r.status !== activeTab) return false;
      if (!q) return true;
      return [r.company_name, r.business_purpose, relationLabel(r.relation_type), r.created_by_name, ...r.categories].join(' ').toLowerCase().includes(q);
    }).sort((a, b) => Number(b.can_decide) - Number(a.can_decide) || Number(b.status === 'pending') - Number(a.status === 'pending') || b.created_at.localeCompare(a.created_at));
  }, [rows, activeTab, query]);

  const open = rows.find((r) => r.id === openId) || null;

  function startNew() {
    setEditingId(null);
    setForm(EMPTY_FORM());
    setStep(0);
    setFormOpen(true);
  }

  function startEdit(r: Row) {
    setEditingId(r.id);
    setForm({
      company_name: r.company_name,
      address: r.address,
      contacts: { ...emptyContacts(), ...r.contacts },
      business_purpose: r.business_purpose,
      categories: [...r.categories],
      relation_type: r.relation_type,
      collaboration_date: r.collaboration_date || '',
      agreement_period: r.agreement_period,
      documents: { ...r.documents } as Record<string, VendorFile[]>,
      project_deal_details: r.project_deal_details,
      initiated_by_ids: [...r.initiated_by_ids],
      overview_remarks: r.overview_remarks
    });
    setOpenId(null);
    setStep(0);
    setFormOpen(true);
  }

  async function upload(key: string, files: FileList) {
    setUploadingKey(key);
    try {
      const fd = new FormData();
      fd.append('folder', 'vendor-assessments');
      Array.from(files).forEach((f) => fd.append('files', f));
      const res = await fetch('/api/uploads', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Upload failed.');
      const added: VendorFile[] = (body.urls as string[]).map((url, i) => ({ url, name: files[i]?.name || 'document' }));
      setForm((f) => ({ ...f, documents: { ...f.documents, [key]: [...(f.documents[key] || []), ...added] } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploadingKey('');
    }
  }

  function stepError(i: number): string {
    if (i === 0 && !form.company_name.trim()) return 'Please type the company name first.';
    if (i === 1 && !VENDOR_CONTACT_ROLES.some(({ key }) => form.contacts[key].name.trim())) return 'Please fill the name of at least one contact person.';
    if (i === 2 && !form.categories.length) return 'Tap at least one category: AV, AI or Robotics.';
    if (i === 2 && !form.relation_type) return 'Tap how this vendor works with Nanta.';
    if (i === 5 && !form.initiated_by_ids.length) return 'Tick at least one Nanta team member.';
    return '';
  }

  function goNext() {
    const err = stepError(step);
    if (err) {
      toast.error(err);
      return;
    }
    setStep((n) => Math.min(WIZARD.length - 1, n + 1));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (step < WIZARD.length - 1) {
      goNext();
      return;
    }
    const firstBad = WIZARD.findIndex((_, i) => stepError(i));
    if (firstBad >= 0) {
      setStep(firstBad);
      toast.error(stepError(firstBad));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editingId ? `/api/vendor-assessments/${editingId}` : '/api/vendor-assessments', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save.');
      toast.success(editingId ? 'Updated — sent back to VP / GM Sales for approval.' : 'Submitted — VP / GM Sales has been notified.');
      setFormOpen(false);
      await load();
      setOpenId(body.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function decide(r: Row, decision: 'approved' | 'rejected') {
    if (decision === 'rejected' && !remarks.trim()) {
      toast.error('Add a remark saying why it is rejected.');
      return;
    }
    setDeciding(true);
    try {
      const res = await fetch(`/api/vendor-assessments/${r.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, remarks })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not record the decision.');
      toast.success(decision === 'approved' ? 'Approved.' : 'Rejected — the creator has been told.');
      setRemarks('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the decision.');
    } finally {
      setDeciding(false);
    }
  }

  async function remove(r: Row) {
    if (!window.confirm(`Delete the assessment for ${r.company_name}? This cannot be undone.`)) return;
    const res = await fetch(`/api/vendor-assessments/${r.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Could not delete.');
      return;
    }
    toast.success('Deleted.');
    setOpenId(null);
    await load();
  }

  const setContact = (role: VendorContactRole, field: keyof VendorContact, value: string) =>
    setForm((f) => ({ ...f, contacts: { ...f.contacts, [role]: { ...f.contacts[role], [field]: value } } }));

  const checks = [
    !!form.company_name.trim(),
    VENDOR_CONTACT_ROLES.some(({ key }) => form.contacts[key].name.trim()),
    form.categories.length > 0,
    !!form.relation_type,
    form.initiated_by_ids.length > 0
  ];
  const ready = checks.filter(Boolean).length;

  const teamFiltered = team.filter((t) => !teamSearch.trim() || t.name.toLowerCase().includes(teamSearch.trim().toLowerCase()));

  return (
    <AppShell title="Vendor Assessment" subtitle="Assess new vendors and partner companies — approved by VP / GM Sales, Finance and MD.">
      {guideOpen ? (
        <section className={styles.guide}>
          <div className={styles.guideHead}>
            <strong>How Vendor Assessment works — 3 simple steps</strong>
            <CommonButton
              variant="outlined"
              size="sm"
              onClick={() => {
                setGuideOpen(false);
                try {
                  window.localStorage.setItem('va-guide-hidden', '1');
                } catch {}
              }}
            >
              Got it, hide this
            </CommonButton>
          </div>
          <ol className={styles.guideSteps}>
            <li>
              <span>1</span>
              <div>
                <strong>Click “+ New assessment”</strong>
                <small>A form opens. It asks one small thing at a time — just fill it and press Next.</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Press “Submit for approval”</strong>
                <small>It goes to VP / GM Sales, then Finance, then MD — automatically. You don’t send it to anyone.</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Watch the coloured steps on the card</strong>
                <small>✓ green = approved · orange = waiting · ✕ red = rejected (open it to read why, then Edit and resubmit).</small>
              </div>
            </li>
          </ol>
          {counts.action > 0 && <p className={styles.guideApprover}>👉 You are an approver: open a card marked “Your approval needed”, read it, then press Approve or Reject at the top.</p>}
        </section>
      ) : (
        <CommonButton variant="outlined" size="sm" className={styles.guideShow} onClick={() => setGuideOpen(true)}>
          ❓ How does this work?
        </CommonButton>
      )}

      <StatCardGrid className={styles.stats}>
        {[
          { k: 'all' as Tab, label: 'Total vendors', value: counts.all, tone: 'default' as StatCardTone },
          { k: 'pending' as Tab, label: 'In approval', value: counts.pending, tone: 'warning' as StatCardTone },
          { k: 'approved' as Tab, label: 'Approved', value: counts.approved, tone: 'success' as StatCardTone },
          { k: 'rejected' as Tab, label: 'Rejected', value: counts.rejected, tone: 'danger' as StatCardTone },
          ...(counts.action ? [{ k: 'action' as Tab, label: 'Awaiting you', value: counts.action, tone: 'brand' as StatCardTone }] : [])
        ].map((st) => (
          <StatCard key={st.k} value={loading ? <Skeleton width={64} height={24} /> : st.value} label={st.label} tone={st.tone} selected={activeTab === st.k} onClick={() => setTab(st.k)} actionLabel={`Show ${st.label.toLowerCase()}`} />
        ))}
      </StatCardGrid>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist">
          {(['action', 'pending', 'approved', 'rejected', 'all'] as Tab[])
            .filter((t) => t !== 'action' || counts.action > 0)
            .map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={activeTab === t}
                className={`${styles.tab} ${activeTab === t ? styles.tabActive : ''} ${t === 'action' ? styles.tabAction : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'action' ? 'Needs my approval' : t === 'all' ? 'All' : STATUS_LABEL[t]}
                <span className={styles.count}>{counts[t]}</span>
              </button>
            ))}
        </div>
        <div className={styles.toolbarRight}>
          <SearchInput inline placeholder="Search company, purpose, relation…" value={query} onChange={(v) => setQuery(v)} />
          <CommonButton variant="primary" leadingIcon={<Plus />} onClick={startNew}>
            New assessment
          </CommonButton>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {loading ? (
        <SkeletonCards count={6} />
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          <strong>No vendor assessments here yet.</strong>
          <span>Click the red <strong>“+ New assessment”</strong> button to add your first vendor. The form guides you step by step.</span>
          <CommonButton variant="primary" leadingIcon={<Plus />} onClick={startNew}>New assessment</CommonButton>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((r) => (
            <button key={r.id} type="button" className={`${styles.card} ${r.can_decide ? styles.cardAction : ''}`} onClick={() => setOpenId(r.id)}>
              <div className={styles.cardHead}>
                <span className={styles.logo}>{initials(r.company_name)}</span>
                <div className={styles.cardTitle}>
                  <strong>{r.company_name}</strong>
                  <small className={styles[RELATION_TONE[r.relation_type] || 'toneBlue']}>{relationLabel(r.relation_type)}</small>
                </div>
                <span className={`${styles.status} ${styles[`status_${r.status}`]}`}>{STATUS_LABEL[r.status]}</span>
              </div>
              {r.business_purpose && <p className={styles.purpose}>{r.business_purpose}</p>}
              <div className={styles.chips}>
                {r.categories.map((c) => (
                  <CommonChip key={c} size="sm" tone="neutral" label={c} />
                ))}
              </div>
              <Stepper record={r} compact />
              <div className={styles.cardFoot}>
                <span>By {r.created_by_name || '—'}</span>
                <span>{r.status === 'pending' ? `Waiting ${daysSince(r.updated_at)}d` : fmtDate(r.updated_at)}</span>
              </div>
              {r.can_decide && <span className={styles.actionBadge}>● Your approval needed</span>}
            </button>
          ))}
        </div>
      )}

      {/* ---------- detail drawer ---------- */}
      {open && (
        <div className={styles.overlay} onClick={() => setOpenId(null)}>
          <aside className={styles.drawer} onClick={(e) => e.stopPropagation()} aria-label={`${open.company_name} details`}>
            <header className={styles.drawerHead}>
              <span className={styles.logo}>{initials(open.company_name)}</span>
              <div className={styles.cardTitle}>
                <strong>{open.company_name}</strong>
                <small>
                  {relationLabel(open.relation_type)} · {open.categories.join(' / ')}
                </small>
              </div>
              <CommonButton variant="ghost" iconOnly leadingIcon={<X />} onClick={() => setOpenId(null)} aria-label="Close" />
            </header>

            <div className={styles.drawerBody}>
              <Stepper record={open} approverNames={approverNames} />

              {open.can_decide && open.approval_stage && (
                <section className={styles.decisionBox}>
                  <h4>Your decision as {VENDOR_STAGE_LABEL[open.approval_stage]}</h4>
                  <p className={styles.hint}>Read the details below. Happy with it? Press <strong>Approve</strong> — it moves to the next approver. Something wrong? Write what is wrong in the box, then press <strong>Reject</strong> — it goes back to the person who filled it.</p>
                  <textarea placeholder="Remarks — required if you reject (e.g. “GST certificate missing”)" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} />
                  <div className={styles.decisionButtons}>
                    <CommonButton variant="destructive" disabled={deciding} onClick={() => decide(open, 'rejected')}>
                      Reject
                    </CommonButton>
                    <CommonButton variant="success" disabled={deciding} onClick={() => decide(open, 'approved')}>
                      Approve
                    </CommonButton>
                  </div>
                </section>
              )}

              <Section title="Vendor details">
                <Field label="Address" value={open.address} />
                <Field label="Business purpose" value={open.business_purpose} />
                <Field label="Nanta relation" value={relationLabel(open.relation_type)} />
                <Field label="Collaboration date" value={fmtDate(open.collaboration_date)} />
                <Field label="Agreement period" value={open.agreement_period} />
              </Section>

              <Section title="Contact persons">
                <div className={styles.contactGrid}>
                  {VENDOR_CONTACT_ROLES.map(({ key, label }) => {
                    const c = open.contacts?.[key];
                    if (!c?.name && !c?.email && !c?.mobile) return null;
                    return (
                      <div key={key} className={styles.contactCard}>
                        <span className={styles.contactRole}>{label}</span>
                        <strong>{c.name || '—'}</strong>
                        {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                        {c.mobile && <a href={`tel:${c.mobile}`}>📱 {c.mobile}</a>}
                        {c.landline && <span>☎ {c.landline}</span>}
                      </div>
                    );
                  })}
                </div>
              </Section>

              <Section title="Signed documents">
                {VENDOR_DOCUMENTS.some((d) => open.documents?.[d.key]?.length) ? (
                  <ul className={styles.docList}>
                    {VENDOR_DOCUMENTS.flatMap((d) =>
                      (open.documents?.[d.key] || []).map((f, i) => (
                        <li key={`${d.key}-${i}`}>
                          <span className={styles.docKind}>{d.label}</span>
                          <a href={f.url} target="_blank" rel="noreferrer">
                            {f.name}
                          </a>
                        </li>
                      ))
                    )}
                  </ul>
                ) : (
                  <p className={styles.muted}>No documents attached.</p>
                )}
              </Section>

              <Section title="Project deal details">
                <p className={styles.pre}>{open.project_deal_details || '—'}</p>
              </Section>

              <Section title="Nanta team">
                <Field label="Initiated by" value={open.initiated_by_names.join(', ')} />
                <Field label="Submitted by" value={`${open.created_by_name} · ${fmtDate(open.created_at)}`} />
              </Section>

              <Section title="Business overview remarks">
                <p className={styles.pre}>{open.overview_remarks || '—'}</p>
              </Section>

              {open.approval_trail.length > 0 && (
                <Section title="Approval history">
                  <ol className={styles.trail}>
                    {open.approval_trail.map((t, i) => (
                      <li key={i} className={t.decision === 'approved' ? styles.trailOk : styles.trailNo}>
                        <strong>
                          {VENDOR_STAGE_LABEL[t.stage]} — {t.decision === 'approved' ? 'Approved' : 'Rejected'}
                        </strong>
                        <span>
                          {t.by_name} · {fmtDate(t.at)}
                        </span>
                        {t.remarks && <em>“{t.remarks}”</em>}
                      </li>
                    ))}
                  </ol>
                </Section>
              )}
            </div>

            {(open.can_edit || isPrivileged || (open.created_by === currentUserId && open.status === 'pending' && !open.approval_trail.length)) && (
              <footer className={styles.drawerFoot}>
                {(isPrivileged || (open.created_by === currentUserId && open.status === 'pending' && !open.approval_trail.length)) && (
                  <CommonButton variant="destructive" className={styles.pushLeft} onClick={() => remove(open)}>
                    Delete
                  </CommonButton>
                )}
                {open.can_edit && (
                  <CommonButton variant="primary" onClick={() => startEdit(open)}>
                    Edit
                  </CommonButton>
                )}
              </footer>
            )}
          </aside>
        </div>
      )}

      {/* ---------- create / edit form ---------- */}
      {formOpen && (
        <div className={styles.overlay} onClick={() => !saving && setFormOpen(false)}>
          <form className={`${styles.drawer} ${styles.formDrawer}`} onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <header className={styles.drawerHead}>
              <div className={styles.cardTitle}>
                <strong>{editingId ? 'Edit vendor assessment' : 'New vendor assessment'}</strong>
                <small>{editingId ? 'Saving sends it back to VP / GM Sales for approval.' : 'Goes to VP / GM Sales → Finance → MD for approval.'}</small>
                <div className={styles.progress} aria-label={`${ready} of 5 required fields done`}>
                  <span style={{ width: `${(ready / 5) * 100}%` }} />
                </div>
              </div>
              <CommonButton variant="ghost" iconOnly leadingIcon={<X />} onClick={() => setFormOpen(false)} aria-label="Close" />
            </header>

            <div className={styles.drawerBody}>
              <ol className={styles.wizSteps}>
                {WIZARD.map((w, i) => (
                  <li key={w.title}>
                    <button
                      type="button"
                      className={`${styles.wizStep} ${i === step ? styles.wizNow : ''} ${i < step ? styles.wizDone : ''}`}
                      onClick={() => (i <= step || !WIZARD.slice(0, i).some((_, j) => stepError(j)) ? setStep(i) : toast.error('Finish the earlier steps first.'))}
                    >
                      <span>{i < step ? '✓' : i + 1}</span>
                      {w.title}
                    </button>
                  </li>
                ))}
              </ol>
              <div className={styles.helpBox}>
                <strong>💡 What to do here</strong>
                <p>{WIZARD[step].help}</p>
                <small>{WIZARD[step].example}</small>
              </div>
              {step === 0 && (
              <Section title="Step 1 of 7 · Vendor details">
                <label className={styles.field}>
                  <span>Company name *</span>
                  <input required value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span>Address</span>
                  <textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span>Business purpose</span>
                  <textarea rows={2} value={form.business_purpose} onChange={(e) => setForm({ ...form, business_purpose: e.target.value })} />
                </label>
              </Section>
              )}

              {step === 1 && (
              <Section title="Step 2 of 7 · Contact persons">
                <p className={styles.hint}>Add at least one — Management, Purchase, Finance or Logistics side.</p>
                <div className={styles.contactForm}>
                  {VENDOR_CONTACT_ROLES.map(({ key, label }) => (
                    <fieldset key={key} className={styles.contactFieldset}>
                      <legend>{label}</legend>
                      <input placeholder="Name" value={form.contacts[key].name} onChange={(e) => setContact(key, 'name', e.target.value)} />
                      <input placeholder="Email ID" type="email" value={form.contacts[key].email} onChange={(e) => setContact(key, 'email', e.target.value)} />
                      <div className={styles.twoCol}>
                        <input placeholder="Mobile" inputMode="tel" value={form.contacts[key].mobile} onChange={(e) => setContact(key, 'mobile', e.target.value)} />
                        <input placeholder="Landline" inputMode="tel" value={form.contacts[key].landline} onChange={(e) => setContact(key, 'landline', e.target.value)} />
                      </div>
                    </fieldset>
                  ))}
                </div>
              </Section>
              )}

              {step === 2 && (
              <Section title="Step 3 of 7 · Relationship">
                <div className={styles.field}>
                  <span>Categories *</span>
                  <div className={styles.segment}>
                    {VENDOR_CATEGORIES.map((c) => {
                      const on = form.categories.includes(c);
                      return (
                        <CommonChip
                          key={c}
                          selected={on}
                          onClick={() => setForm({ ...form, categories: on ? form.categories.filter((x) => x !== c) : [...form.categories, c] })}
                        >
                          {c}
                        </CommonChip>
                      );
                    })}
                  </div>
                </div>
                <div className={styles.field}>
                  <span>Nanta relation *</span>
                  <div className={styles.relationGrid}>
                    {VENDOR_RELATIONS.map((r) => (
                      <CommonChip
                        key={r.key}
                        selected={form.relation_type === r.key}
                        onClick={() => setForm({ ...form, relation_type: r.key })}
                      >
                        {r.label}
                      </CommonChip>
                    ))}
                  </div>
                </div>
                <div className={styles.twoCol}>
                  <label className={styles.field}>
                    <span>Collaboration date</span>
                    <input type="date" value={form.collaboration_date} onChange={(e) => setForm({ ...form, collaboration_date: e.target.value })} />
                  </label>
                  <label className={styles.field}>
                    <span>Agreement period (if any)</span>
                    <input placeholder="e.g. 2 years, Apr 2026 – Mar 2028" value={form.agreement_period} onChange={(e) => setForm({ ...form, agreement_period: e.target.value })} />
                  </label>
                </div>
              </Section>
              )}

              {step === 3 && (
              <Section title="Step 4 of 7 · Signed documents">
                <div className={styles.docForm}>
                  {VENDOR_DOCUMENTS.map((d) => (
                    <div key={d.key} className={styles.docSlot}>
                      <div className={styles.docSlotHead}>
                        <strong>{d.label}</strong>
                        <label className={styles.uploadBtn}>
                          {uploadingKey === d.key ? 'Uploading…' : '+ Attach'}
                          <input type="file" multiple hidden disabled={!!uploadingKey} onChange={(e) => e.target.files?.length && upload(d.key, e.target.files)} />
                        </label>
                      </div>
                      {(form.documents[d.key] || []).map((f, i) => (
                        <div key={i} className={styles.fileRow}>
                          <a href={f.url} target="_blank" rel="noreferrer">
                            📄 {f.name}
                          </a>
                          <CommonButton
                            variant="ghost"
                            size="sm"
                            iconOnly
                            leadingIcon={<X />}
                            aria-label="Remove file"
                            onClick={() => setForm((s) => ({ ...s, documents: { ...s.documents, [d.key]: (s.documents[d.key] || []).filter((_, j) => j !== i) } }))}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </Section>
              )}

              {step === 4 && (
              <Section title="Step 5 of 7 · Project deal details">
                <textarea className={styles.block} rows={4} placeholder="Generic project / deal details" value={form.project_deal_details} onChange={(e) => setForm({ ...form, project_deal_details: e.target.value })} />
              </Section>
              )}

              {step === 5 && (
              <Section title="Step 6 of 7 · Nanta team initiated by">
                <input className={styles.block} placeholder="Search team…" value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} />
                {form.initiated_by_ids.length > 0 && (
                  <div className={styles.chips}>
                    {form.initiated_by_ids.map((id) => (
                      <CommonChip
                        key={id}
                        label={team.find((t) => t.id === id)?.name || 'Selected'}
                        onRemove={() => setForm({ ...form, initiated_by_ids: form.initiated_by_ids.filter((x) => x !== id) })}
                      />
                    ))}
                  </div>
                )}
                <div className={styles.teamList}>
                  {teamFiltered.map((t) => {
                    const on = form.initiated_by_ids.includes(t.id);
                    return (
                      <label key={t.id} className={`${styles.teamRow} ${on ? styles.teamOn : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setForm({ ...form, initiated_by_ids: on ? form.initiated_by_ids.filter((x) => x !== t.id) : [...form.initiated_by_ids, t.id] })}
                        />
                        <span className={styles.avatar}>{initials(t.name)}</span>
                        {t.name}
                      </label>
                    );
                  })}
                </div>
              </Section>
              )}

              {step === 6 && (
              <Section title="Step 7 of 7 · Business overview remarks">
                <textarea className={styles.block} rows={4} value={form.overview_remarks} onChange={(e) => setForm({ ...form, overview_remarks: e.target.value })} />
              </Section>
              )}
            </div>

            <footer className={styles.drawerFoot}>
              {step > 0 ? (
                <CommonButton variant="ghost" leadingIcon={<ChevronLeft />} onClick={() => setStep((n) => n - 1)} disabled={saving}>
                  Back
                </CommonButton>
              ) : (
                <CommonButton variant="outlined" onClick={() => setFormOpen(false)} disabled={saving}>
                  Cancel
                </CommonButton>
              )}
              {step < WIZARD.length - 1 && (
                <CommonButton variant="primary" trailingIcon={<ChevronRight />} onClick={goNext}>
                  Next: {WIZARD[step + 1].title}
                </CommonButton>
              )}
              {step === WIZARD.length - 1 && (
              <CommonButton type="submit" variant="primary" leadingIcon={<Check />} loading={saving} loadingLabel="Saving…" disabled={!!uploadingKey}>
                {editingId ? 'Save & resubmit' : 'Submit for approval'}
              </CommonButton>
              )}
            </footer>
          </form>
        </div>
      )}
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.kv}>
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );
}

function Stepper({ record, approverNames, compact }: { record: VendorAssessmentRecord; approverNames?: Record<string, string[]>; compact?: boolean }) {
  // The current round's decisions. A rejection ends a round; an edit
  // restarts at VP / GM Sales, so 'pending at sales' means nothing is done yet.
  const trail = record.approval_trail;
  const rejIdx = trail.map((t) => t.decision).lastIndexOf('rejected');
  let effective: typeof trail = [];
  if (record.status === 'rejected') {
    const prev = trail.slice(0, rejIdx).map((t) => t.decision).lastIndexOf('rejected');
    effective = trail.slice(prev + 1, rejIdx + 1);
  } else if (!(record.status === 'pending' && record.approval_stage === 'sales')) {
    effective = trail.slice(rejIdx + 1);
  }
  return (
    <ol className={`${styles.stepper} ${compact ? styles.stepperCompact : ''}`}>
      {VENDOR_APPROVAL_STAGES.map((s) => {
        const done = [...effective].reverse().find((t) => t.stage === s);
        const state = done ? done.decision : record.approval_stage === s ? 'current' : 'waiting';
        return (
          <li key={s} className={styles[`step_${state}`]}>
            <span className={styles.stepDot}>{state === 'approved' ? '✓' : state === 'rejected' ? '✕' : VENDOR_APPROVAL_STAGES.indexOf(s) + 1}</span>
            <span className={styles.stepLabel}>
              {VENDOR_STAGE_LABEL[s]}
              {!compact && <small>{done ? `${done.by_name}` : approverNames?.[s]?.join(', ') || 'Not assigned in Department Master'}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
