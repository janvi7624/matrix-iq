'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DomainKey, SiteVisitRecord, UserRole, VisitStage } from '@/lib/types';
import { TECHNICAL_TEAM, SALES_TEAM } from '@/lib/teamMembers';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { isReminderDue, STAGE_LABEL, STAGE_HINT } from '@/lib/siteVisitReminder';
import PortalHeader from './PortalHeader';
import TeamCheckboxes from './TeamCheckboxes';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface SiteVisitsViewProps {
  currentUser: { username: string; role: UserRole };
}

const EMPTY_FORM = {
  projectId: '',
  companyName: '',
  contactPerson: '',
  clientEmail: '',
  clientPhone: '',
  location: '',
  visitDate: '',
  teamTechnical: [] as string[],
  teamSales: [] as string[],
  purpose: '',
  category: '' as DomainKey | '',
  visitDetails: '',
  imageUrls: [] as string[],
  actionPlan: '',
  reminderDate: '',
  stage: '' as VisitStage | ''
};

const EMPTY_UPDATE_FORM = { teamTechnical: [] as string[], teamSales: [] as string[], projectDetails: '', ongoingActivities: '' };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function StagePicker({ value, onChange }: { value: VisitStage | ''; onChange: (v: VisitStage) => void }) {
  const stages: VisitStage[] = ['hot', 'warm', 'cold'];
  return (
    <div className={calcStyles.field}>
      <label className={calcStyles.label}>Stage of the client</label>
      <div className={historyStyles.stageOptions}>
        {stages.map((s) => (
          <div
            key={s}
            className={`${historyStyles.stageOption} ${value === s ? historyStyles.stageOptionActive : ''}`}
            onClick={() => onChange(s)}
          >
            <strong>{STAGE_LABEL[s]}</strong>
            <span>{STAGE_HINT[s]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImageUploader({ imageUrls, onChange }: { imageUrls: string[]; onChange: (urls: string[]) => void }) {
  const [uploading, setUploading] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const body = new FormData();
      Array.from(fileList).forEach((f) => body.append('files', f));
      const response = await fetch('/api/site-visits/upload', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      const data: { urls: string[] } = await response.json();
      onChange([...imageUrls, ...data.urls]);
    } catch {
      alert('Could not upload one or more images. Try a smaller file (max 8MB each).');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={calcStyles.field}>
      <label className={calcStyles.label}>Images (optional)</label>
      <input type="file" accept="image/*" multiple disabled={uploading} onChange={(e) => handleFiles(e.target.files)} />
      {uploading && <div className={calcStyles.small}>Uploading…</div>}
      {imageUrls.length > 0 && (
        <div className={historyStyles.imageStrip}>
          {imageUrls.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="Site visit" onClick={() => onChange(imageUrls.filter((u) => u !== url))} title="Click to remove" />
          ))}
        </div>
      )}
    </div>
  );
}

function SiteVisitDetail({
  visit,
  onPatch,
  onAddUpdate,
  onClose
}: {
  visit: SiteVisitRecord;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onAddUpdate: (id: string, entry: typeof EMPTY_UPDATE_FORM) => Promise<void>;
  onClose: () => void;
}) {
  const [actionPlan, setActionPlan] = useState(visit.action_plan);
  const [reminderDate, setReminderDate] = useState(visit.reminder_date);
  const [stage, setStage] = useState(visit.stage);
  const [status, setStatus] = useState(visit.status);
  const [busy, setBusy] = useState(false);
  const [updateForm, setUpdateForm] = useState(EMPTY_UPDATE_FORM);
  const [addingUpdate, setAddingUpdate] = useState(false);

  async function handleSaveDetails() {
    setBusy(true);
    try {
      await onPatch(visit.id, { actionPlan, reminderDate, stage, status });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddUpdate(e: FormEvent) {
    e.preventDefault();
    if (!updateForm.projectDetails.trim() && !updateForm.ongoingActivities.trim()) {
      alert('Add project details or ongoing activities.');
      return;
    }
    setAddingUpdate(true);
    try {
      await onAddUpdate(visit.id, updateForm);
      setUpdateForm(EMPTY_UPDATE_FORM);
    } finally {
      setAddingUpdate(false);
    }
  }

  return (
    <div className={historyStyles.detailPanel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <h2 className={calcStyles.h2} style={{ margin: 0 }}>
            {visit.company_name}
          </h2>
          <div className={calcStyles.small}>
            Visited {formatDate(visit.visit_date)} by {visit.created_by}
            {visit.contact_person ? ` · Contact: ${visit.contact_person}` : ''}
            {visit.project_id ? (
              <>
                {' · '}
                <Link href={`/projects/${visit.project_id}`}>Project {visit.project_id}</Link>
              </>
            ) : ''}
          </div>
        </div>
        <button type="button" className={historyStyles.button} onClick={onClose}>
          Close
        </button>
      </div>

      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Client email</label>
          <div className={calcStyles.small}>{visit.client_email || '-'}</div>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Client phone</label>
          <div className={calcStyles.small}>{visit.client_phone || '-'}</div>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Location</label>
          <div className={calcStyles.small}>{visit.location || '-'}</div>
        </div>
      </div>
      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Purpose</label>
          <div className={calcStyles.small}>{visit.purpose || '-'}</div>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Category</label>
          <div className={calcStyles.small}>{visit.category ? DOMAIN_DISPLAY_NAME[visit.category] : '-'}</div>
        </div>
      </div>
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Visit details</label>
        <div className={calcStyles.small}>{visit.visit_details || '-'}</div>
      </div>
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Team on registration visit</label>
        <div className={calcStyles.small}>
          {[...visit.team_technical, ...visit.team_sales].join(', ') || '-'}
        </div>
      </div>
      {visit.image_urls.length > 0 && (
        <div className={historyStyles.imageStrip}>
          {visit.image_urls.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={url} href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="Site visit" />
            </a>
          ))}
        </div>
      )}

      <hr style={{ margin: '18px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Action plan</label>
          <textarea className={calcStyles.formControl} rows={2} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} />
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Reminder date</label>
          <input type="date" className={calcStyles.formControl} value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
        </div>
      </div>
      <StagePicker value={stage} onChange={setStage} />
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Status</label>
        <select className={calcStyles.formControl} value={status} onChange={(e) => setStatus(e.target.value as SiteVisitRecord['status'])}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleSaveDetails}>
        {busy ? 'Saving…' : 'Save details'}
      </button>

      <hr style={{ margin: '18px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

      <h3 style={{ marginTop: 0 }}>Project updates</h3>
      <div className={historyStyles.timeline}>
        {visit.updates.length === 0 && <div className={calcStyles.small}>No updates logged yet.</div>}
        {visit.updates
          .slice()
          .reverse()
          .map((u) => (
            <div key={u.id} className={historyStyles.timelineEntry}>
              <div className={historyStyles.timelineMeta}>
                {formatDateTime(u.updated_at)} · {u.updated_by}
                {[...u.team_technical, ...u.team_sales].length > 0 ? ` · Team: ${[...u.team_technical, ...u.team_sales].join(', ')}` : ''}
              </div>
              {u.project_details && <div><strong>Project details:</strong> {u.project_details}</div>}
              {u.ongoing_activities && <div><strong>Ongoing activities:</strong> {u.ongoing_activities}</div>}
            </div>
          ))}
      </div>

      <h3>Log a new update</h3>
      <form onSubmit={handleAddUpdate}>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <TeamCheckboxes
            label="Technical team involved"
            options={TECHNICAL_TEAM}
            selected={updateForm.teamTechnical}
            onChange={(next) => setUpdateForm((f) => ({ ...f, teamTechnical: next }))}
          />
          <TeamCheckboxes
            label="Sales team involved"
            options={SALES_TEAM}
            selected={updateForm.teamSales}
            onChange={(next) => setUpdateForm((f) => ({ ...f, teamSales: next }))}
          />
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Project details</label>
          <textarea
            className={calcStyles.formControl}
            rows={2}
            value={updateForm.projectDetails}
            onChange={(e) => setUpdateForm((f) => ({ ...f, projectDetails: e.target.value }))}
          />
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Ongoing activities</label>
          <textarea
            className={calcStyles.formControl}
            rows={2}
            value={updateForm.ongoingActivities}
            onChange={(e) => setUpdateForm((f) => ({ ...f, ongoingActivities: e.target.value }))}
          />
        </div>
        <div className={calcStyles.small} style={{ marginBottom: 8 }}>
          Date of updation is recorded automatically: {formatDateTime(new Date().toISOString())}
        </div>
        <button type="submit" className={calcStyles.btn} disabled={addingUpdate}>
          {addingUpdate ? 'Saving…' : 'Add update'}
        </button>
      </form>
    </div>
  );
}

function SiteVisitsContent({ currentUser }: SiteVisitsViewProps) {
  const searchParams = useSearchParams();
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const [visits, setVisits] = useState<SiteVisitRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<'register' | 'update'>(searchParams.get('focus') === 'open' ? 'update' : 'register');
  const [openOnly, setOpenOnly] = useState(searchParams.get('focus') === 'open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [autofillNotice, setAutofillNotice] = useState('');
  const prefillProjectId = searchParams.get('projectId') || '';

  useEffect(() => {
    if (prefillProjectId) setForm((f) => ({ ...f, projectId: prefillProjectId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillProjectId]);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/site-visits');
      if (!response.ok) throw new Error(String(response.status));
      const data: SiteVisitRecord[] = await response.json();
      setVisits(data);
      setStatus(data.length ? `${data.length} visit${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the site visits API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleVisits = useMemo(() => (openOnly ? visits.filter((v) => v.status === 'open') : visits), [visits, openOnly]);
  const openVisit = useMemo(() => visits.find((v) => v.id === openId) || null, [visits, openId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.companyName.trim() || !form.visitDate) {
      alert('Company name and visit date are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/site-visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      setAutofillNotice('');
      await load();
    } catch {
      alert('Could not save this site visit. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  // Same client, new domain: carry over everything except the visit date,
  // category, and images so the rep only has to pick the new domain.
  function handleCompanyBlur() {
    const name = form.companyName.trim();
    if (!name) return;
    const match = visits.find((v) => v.company_name.trim().toLowerCase() === name.toLowerCase());
    if (!match) return;
    setForm((f) => ({
      ...f,
      contactPerson: f.contactPerson || match.contact_person,
      clientEmail: f.clientEmail || match.client_email,
      clientPhone: f.clientPhone || match.client_phone,
      teamTechnical: f.teamTechnical.length ? f.teamTechnical : match.team_technical,
      teamSales: f.teamSales.length ? f.teamSales : match.team_sales,
      purpose: f.purpose || match.purpose,
      visitDetails: f.visitDetails || match.visit_details,
      actionPlan: f.actionPlan || match.action_plan,
      reminderDate: f.reminderDate || match.reminder_date,
      stage: f.stage || match.stage
    }));
    setAutofillNotice(`Loaded details from an earlier visit to ${match.company_name} — just update the category and visit-specific info.`);
  }

  async function handlePatch(id: string, patch: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/site-visits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      alert('Could not save this update. Please try again.');
    }
  }

  async function handleAddUpdate(id: string, entry: typeof EMPTY_UPDATE_FORM) {
    await handlePatch(id, { action: 'addUpdate', ...entry });
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this site visit report? This cannot be undone.')) return;
    try {
      const response = await fetch(`/api/site-visits/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setVisits((prev) => prev.filter((v) => v.id !== id));
      if (openId === id) setOpenId(null);
    } catch {
      alert('Could not delete this site visit.');
    }
  }

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Site Visit Reports" subtitle="Register a visit, then keep logging project updates over time." />
      <main className={historyStyles.main}>
        <div className={historyStyles.modeToggle}>
          <button
            type="button"
            className={`${historyStyles.modeToggleBtn} ${mode === 'register' ? historyStyles.modeToggleBtnActive : ''}`}
            onClick={() => setMode('register')}
          >
            Register new visit
          </button>
          <button
            type="button"
            className={`${historyStyles.modeToggleBtn} ${mode === 'update' ? historyStyles.modeToggleBtnActive : ''}`}
            onClick={() => {
              setMode('update');
              setOpenOnly(true);
            }}
          >
            Update details of visit
          </button>
        </div>

        {mode === 'register' && (
        <>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Register a site visit</h2>
        {autofillNotice && <div className={historyStyles.autofillNotice}>{autofillNotice}</div>}
        {prefillProjectId && <div className={historyStyles.autofillNotice}>Linked to project {prefillProjectId}.</div>}
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <div className={calcStyles.small} style={{ marginBottom: 10 }}>
            {form.projectId ? `This visit will be linked to project ${form.projectId}.` : "No project selected — a new project will be created automatically for this client."}
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Company name *</label>
              <input
                className={calcStyles.formControl}
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                onBlur={handleCompanyBlur}
                required
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Contact person</label>
              <input className={calcStyles.formControl} value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Visit date *</label>
              <input type="date" className={calcStyles.formControl} value={form.visitDate} onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))} required />
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client email</label>
              <input type="email" className={calcStyles.formControl} value={form.clientEmail} onChange={(e) => setForm((f) => ({ ...f, clientEmail: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client contact number</label>
              <input className={calcStyles.formControl} value={form.clientPhone} onChange={(e) => setForm((f) => ({ ...f, clientPhone: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Location</label>
              <input className={calcStyles.formControl} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <TeamCheckboxes
              label="Technical team involved"
              options={TECHNICAL_TEAM}
              selected={form.teamTechnical}
              onChange={(next) => setForm((f) => ({ ...f, teamTechnical: next }))}
            />
            <TeamCheckboxes
              label="Sales team involved"
              options={SALES_TEAM}
              selected={form.teamSales}
              onChange={(next) => setForm((f) => ({ ...f, teamSales: next }))}
            />
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Purpose of visit</label>
              <input className={calcStyles.formControl} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Category</label>
              <select className={calcStyles.formControl} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as DomainKey | '' }))}>
                <option value="">-- Select category --</option>
                {(Object.keys(DOMAIN_DISPLAY_NAME) as DomainKey[]).map((k) => (
                  <option key={k} value={k}>{DOMAIN_DISPLAY_NAME[k]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Visit details (technical brief)</label>
            <textarea className={calcStyles.formControl} rows={3} value={form.visitDetails} onChange={(e) => setForm((f) => ({ ...f, visitDetails: e.target.value }))} />
          </div>

          <ImageUploader imageUrls={form.imageUrls} onChange={(urls) => setForm((f) => ({ ...f, imageUrls: urls }))} />

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Action plan</label>
              <textarea className={calcStyles.formControl} rows={2} value={form.actionPlan} onChange={(e) => setForm((f) => ({ ...f, actionPlan: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Reminder date</label>
              <input type="date" className={calcStyles.formControl} value={form.reminderDate} onChange={(e) => setForm((f) => ({ ...f, reminderDate: e.target.value }))} />
            </div>
          </div>

          <StagePicker value={form.stage} onChange={(v) => setForm((f) => ({ ...f, stage: v }))} />

          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Saving…' : 'Register site visit'}
          </button>
        </form>
        </>
        )}

        <div className={historyStyles.toolbar} style={{ marginTop: 24 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open visits only
          </label>
          <button type="button" className={historyStyles.button} onClick={load}>
            Refresh
          </button>
        </div>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Visit Date</th>
                <th>Company</th>
                <th>Project</th>
                <th>Category</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Reminder</th>
                <th>Logged By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleVisits.length === 0 ? (
                <tr>
                  <td colSpan={9} className={historyStyles.empty}>
                    No site visits recorded yet.
                  </td>
                </tr>
              ) : (
                visibleVisits.map((v) => (
                  <tr key={v.id}>
                    <td>{formatDate(v.visit_date)}</td>
                    <td>
                      {v.company_name}
                      {v.contact_person ? ` (${v.contact_person})` : ''}
                    </td>
                    <td>{v.project_id ? <Link href={`/projects/${v.project_id}`}>{v.project_id}</Link> : '-'}</td>
                    <td>{v.category ? DOMAIN_DISPLAY_NAME[v.category] : '-'}</td>
                    <td>{v.stage ? <span className={historyStyles.stageBadge}>{STAGE_LABEL[v.stage]}</span> : '-'}</td>
                    <td>{v.status === 'open' ? 'Open' : 'Closed'}</td>
                    <td>{isReminderDue(v) ? <span className={historyStyles.reminderBadge}>Reminder due</span> : <span className={historyStyles.followUpOk}>-</span>}</td>
                    <td>{v.created_by}</td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className={historyStyles.button} onClick={() => setOpenId(v.id)}>
                        Open
                      </button>
                      <Link className={historyStyles.button} href={`/quotation${v.project_id ? `?projectId=${v.project_id}` : ''}`}>
                        Create Quotation
                      </Link>
                      {isPrivileged && (
                        <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(v.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {openVisit && (
          <SiteVisitDetail visit={openVisit} onPatch={handlePatch} onAddUpdate={handleAddUpdate} onClose={() => setOpenId(null)} />
        )}
      </main>
    </div>
  );
}

export default function SiteVisitsView({ currentUser }: SiteVisitsViewProps) {
  return (
    <Suspense fallback={<div className={historyStyles.body} />}>
      <SiteVisitsContent currentUser={currentUser} />
    </Suspense>
  );
}
