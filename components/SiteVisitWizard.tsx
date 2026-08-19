'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, MapPin, Package, Users, FileText, ClipboardList, CheckCircle2, Search, Clock, Monitor } from 'lucide-react';
import { DomainKey, ProjectRecord, QuotationRecord, DemoScheduleRecord, SiteVisitRecord, VisitStage } from '@/lib/types';
import { TECHNICAL_TEAM, SALES_TEAM } from '@/lib/teamMembers';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { getDomainProducts } from '@/lib/domainProducts';
import { STAGE_LABEL, STAGE_HINT } from '@/lib/siteVisitReminder';
import TeamCheckboxes from './TeamCheckboxes';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { todayDateInputValue } from '@/lib/dateHelpers';

export interface SiteVisitWizardForm {
  projectId: string;
  companyName: string;
  contactPerson: string;
  clientEmail: string;
  clientPhone: string;
  location: string;
  visitDate: string;
  purpose: string;
  category: DomainKey | '';
  productsInterested: string[];
  visitDetails: string;
  imageUrls: string[];
  teamTechnical: string[];
  teamSales: string[];
  actionPlan: string;
  reminderDate: string;
  stage: VisitStage | '';
}

function emptyForm(prefillProjectId: string): SiteVisitWizardForm {
  return {
    projectId: prefillProjectId,
    companyName: '',
    contactPerson: '',
    clientEmail: '',
    clientPhone: '',
    location: '',
    visitDate: new Date().toISOString().slice(0, 10),
    purpose: '',
    category: '',
    productsInterested: [],
    visitDetails: '',
    imageUrls: [],
    teamTechnical: [],
    teamSales: [],
    actionPlan: '',
    reminderDate: '',
    stage: ''
  };
}

const STEPS = [
  { icon: Building2, label: 'Client Information' },
  { icon: MapPin, label: 'Visit Information' },
  { icon: Package, label: 'Products Interested' },
  { icon: Users, label: 'Team Members' },
  { icon: FileText, label: 'Notes' },
  { icon: CheckCircle2, label: 'Review & Submit' }
];

function Required() {
  return <span className={historyStyles.requiredMark}>*</span>;
}

function ImageUploader({ imageUrls, onChange }: { imageUrls: string[]; onChange: (urls: string[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

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
      toast.error('Could not upload one or more photos. Try a smaller file (max 8MB each).');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={calcStyles.field}>
      <label className={calcStyles.label}>Photos (optional)</label>
      <label className={calcStyles.fileUpload}>
        <input type="file" accept="image/*" multiple disabled={uploading} onChange={(e) => handleFiles(e.target.files)} style={{ display: 'none' }} />
        {uploading ? 'Uploading…' : '+ Add Photos'}
      </label>
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

interface SiteVisitWizardProps {
  visits: SiteVisitRecord[];
  prefillProjectId: string;
  creating: boolean;
  onSubmit: (form: SiteVisitWizardForm) => Promise<SiteVisitRecord | null>;
}

export default function SiteVisitWizard({ visits, prefillProjectId, creating, onSubmit }: SiteVisitWizardProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<SiteVisitWizardForm>(() => emptyForm(prefillProjectId));
  const [autofillNotice, setAutofillNotice] = useState('');
  const [historySummary, setHistorySummary] = useState<{ visitCount: number; lastQuotation: QuotationRecord | null; lastDemo: DemoScheduleRecord | null } | null>(null);
  const [successRecord, setSuccessRecord] = useState<SiteVisitRecord | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (prefillProjectId) setForm((f) => ({ ...f, projectId: prefillProjectId }));
  }, [prefillProjectId]);

  const existingCompanies = useMemo(() => Array.from(new Set(visits.map((v) => v.company_name).filter(Boolean))), [visits]);
  const suggestions = useMemo(() => {
    const q = form.companyName.trim().toLowerCase();
    if (!q) return [];
    return existingCompanies.filter((c) => c.toLowerCase().includes(q) && c.toLowerCase() !== q).slice(0, 5);
  }, [form.companyName, existingCompanies]);

  async function applySuggestion(company: string) {
    const match = visits.find((v) => v.company_name === company);
    if (!match) return;
    setForm((f) => ({
      ...f,
      companyName: match.company_name,
      contactPerson: match.contact_person,
      clientEmail: match.client_email,
      clientPhone: match.client_phone,
      location: match.location,
      projectId: match.project_id || f.projectId
    }));
    setAutofillNotice(`Loaded ${match.company_name}'s details from a previous visit. Just confirm and continue.`);

    const visitCount = visits.filter((v) => v.company_name === company).length;
    if (match.project_id) {
      try {
        const response = await fetch(`/api/projects/${match.project_id}`);
        if (response.ok) {
          const json = await response.json();
          const quotations: QuotationRecord[] = json.quotations || [];
          const demos: DemoScheduleRecord[] = json.demos || [];
          setHistorySummary({
            visitCount,
            lastQuotation: quotations.length ? quotations[quotations.length - 1] : null,
            lastDemo: demos.length ? demos[demos.length - 1] : null
          });
        }
      } catch {
        setHistorySummary({ visitCount, lastQuotation: null, lastDemo: null });
      }
    } else {
      setHistorySummary({ visitCount, lastQuotation: null, lastDemo: null });
    }
  }

  function toggleProduct(tag: string) {
    setForm((f) => ({
      ...f,
      productsInterested: f.productsInterested.includes(tag) ? f.productsInterested.filter((p) => p !== tag) : [...f.productsInterested, tag]
    }));
  }

  function validateStep(index: number): string | null {
    if (index === 0 && !form.companyName.trim()) return 'Company name is required.';
    if (index === 1 && !form.visitDate) return 'Visit date is required.';
    return null;
  }

  function goNext() {
    const error = validateStep(step);
    if (error) {
      setErrors([error]);
      return;
    }
    setErrors([]);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function goBack() {
    setErrors([]);
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleSubmit() {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const error = validateStep(i);
      if (error) {
        setStep(i);
        setErrors([error]);
        return;
      }
    }
    const created = await onSubmit(form);
    if (created) {
      setSuccessRecord(created);
    }
  }

  function handleRegisterAnother() {
    setSuccessRecord(null);
    setHistorySummary(null);
    setAutofillNotice('');
    setErrors([]);
    setForm(emptyForm(prefillProjectId));
    setStep(0);
  }

  if (successRecord) {
    return (
      <div className={historyStyles.wizardCard}>
        <div className={historyStyles.successPanel}>
          <div className={historyStyles.successIcon}><CheckCircle2 size={48} /></div>
          <h2 className={calcStyles.h2} style={{ marginTop: 0, borderLeft: 'none', paddingLeft: 0 }}>Site visit saved!</h2>
          <div className={calcStyles.small}>
            {successRecord.company_name} — {successRecord.project_id ? `linked to project ${successRecord.project_id}` : 'no project linked'}
          </div>
          <div className={historyStyles.successActions}>
            <Link className={historyStyles.bigBtn} href={`/quotation${successRecord.project_id ? `?projectId=${successRecord.project_id}` : ''}`}>
              <FileText size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Create Quotation
            </Link>
            <Link className={historyStyles.bigBtn} href={`/demo-schedule${successRecord.project_id ? `?projectId=${successRecord.project_id}` : ''}`}>
              <Monitor size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Schedule Demo
            </Link>
            {successRecord.project_id && (
              <Link className={historyStyles.bigBtnGhost} href={`/projects/${successRecord.project_id}`}>
                <Clock size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />View Timeline
              </Link>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <button type="button" className={historyStyles.bigBtnGhost} onClick={handleRegisterAnother}>
              + Register Another Visit
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={historyStyles.wizardSteps}>
        {STEPS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className={`${historyStyles.wizardStep} ${i === step ? historyStyles.wizardStepActive : ''} ${i < step ? historyStyles.wizardStepDone : ''}`}
            onClick={() => setStep(i)}
          >
            <span className={historyStyles.wizardStepCircle}>{i < step ? '✓' : <s.icon size={18} />}</span>
            <span className={historyStyles.wizardStepLabel}>{i + 1}. {s.label}</span>
          </button>
        ))}
      </div>

      <div className={historyStyles.wizardCard}>
        {step === 0 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Building2 size={20} /> Client Information</h2>
            <div className={historyStyles.wizardCardHint}>Start typing a company name — if they've visited before, we'll suggest their saved details.</div>
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}
            {autofillNotice && <div className={historyStyles.autofillNotice}>{autofillNotice}</div>}
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Company name<Required /></label>
              <input
                className={calcStyles.formControl}
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="Start typing..."
                autoFocus
              />
              {suggestions.length > 0 && (
                <div className={historyStyles.suggestionBox}>
                  {suggestions.map((c) => (
                    <button key={c} type="button" className={historyStyles.suggestionItem} onClick={() => applySuggestion(c)}>
                      <Search size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{c} — use this existing client
                    </button>
                  ))}
                </div>
              )}
            </div>
            {historySummary && (
              <div className={historyStyles.historyCard}>
                <ClipboardList size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{historySummary.visitCount} previous visit{historySummary.visitCount === 1 ? '' : 's'} on file.
                {historySummary.lastQuotation && ` Last quotation: ${historySummary.lastQuotation.quotation_number} (₹${historySummary.lastQuotation.total.toLocaleString('en-IN')}).`}
                {historySummary.lastDemo && ` Previous demo: ${new Date(historySummary.lastDemo.scheduled_at).toLocaleDateString('en-IN')} (${historySummary.lastDemo.status}).`}
              </div>
            )}
            <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginTop: 16 }}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Contact person</label>
                <input className={calcStyles.formControl} value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Client email</label>
                <input type="email" className={calcStyles.formControl} value={form.clientEmail} onChange={(e) => setForm((f) => ({ ...f, clientEmail: e.target.value }))} />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client contact number</label>
              <input className={calcStyles.formControl} value={form.clientPhone} onChange={(e) => setForm((f) => ({ ...f, clientPhone: e.target.value }))} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><MapPin size={20} /> Visit Information</h2>
            <div className={historyStyles.wizardCardHint}>When and where did (or will) this visit happen?</div>
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Visit date<Required /></label>
                <input type="date" className={calcStyles.formControl} value={form.visitDate} onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Location</label>
                <input className={calcStyles.formControl} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Site / office address" />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Purpose of visit</label>
              <input className={calcStyles.formControl} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Initial requirement discussion" />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Package size={20} /> Products Interested</h2>
            <div className={historyStyles.wizardCardHint}>Pick a category, then tick the specific products the client is interested in.</div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Category</label>
              <select className={calcStyles.formControl} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as DomainKey | '', productsInterested: [] }))}>
                <option value="">-- Select category --</option>
                {(Object.keys(DOMAIN_DISPLAY_NAME) as DomainKey[]).map((k) => (
                  <option key={k} value={k}>{DOMAIN_DISPLAY_NAME[k]}</option>
                ))}
              </select>
            </div>
            {form.category && (
              getDomainProducts(form.category).length > 0 ? (
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Products</label>
                  <div className={historyStyles.teamGrid}>
                    {getDomainProducts(form.category).map((p) => (
                      <label key={p}>
                        <input type="checkbox" checked={form.productsInterested.includes(p)} onChange={() => toggleProduct(p)} />
                        {p}
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={calcStyles.small}>No fixed catalog for {DOMAIN_DISPLAY_NAME[form.category]} — describe it in the technical brief below.</div>
              )
            )}
            <div className={calcStyles.field} style={{ marginTop: 12 }}>
              <label className={calcStyles.label}>Technical brief</label>
              <textarea className={calcStyles.formControl} rows={3} value={form.visitDetails} onChange={(e) => setForm((f) => ({ ...f, visitDetails: e.target.value }))} />
            </div>
            <ImageUploader imageUrls={form.imageUrls} onChange={(urls) => setForm((f) => ({ ...f, imageUrls: urls }))} />
          </>
        )}

        {step === 3 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Users size={20} /> Team Members</h2>
            <div className={historyStyles.wizardCardHint}>Who's attending or involved in this visit?</div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <TeamCheckboxes label="Technical team" options={TECHNICAL_TEAM} selected={form.teamTechnical} onChange={(next) => setForm((f) => ({ ...f, teamTechnical: next }))} />
              <TeamCheckboxes label="Sales team" options={SALES_TEAM} selected={form.teamSales} onChange={(next) => setForm((f) => ({ ...f, teamSales: next }))} />
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><FileText size={20} /> Notes</h2>
            <div className={historyStyles.wizardCardHint}>What's the plan, and how urgent is this client?</div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Action plan</label>
                <textarea className={calcStyles.formControl} rows={2} value={form.actionPlan} onChange={(e) => setForm((f) => ({ ...f, actionPlan: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Reminder date</label>
                <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={form.reminderDate} onChange={(e) => setForm((f) => ({ ...f, reminderDate: e.target.value }))} />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Stage of the client</label>
              <div className={historyStyles.stageOptions}>
                {(['hot', 'warm', 'cold'] as VisitStage[]).map((s) => (
                  <div
                    key={s}
                    className={`${historyStyles.stageOption} ${form.stage === s ? historyStyles.stageOptionActive : ''}`}
                    onClick={() => setForm((f) => ({ ...f, stage: s }))}
                  >
                    <strong>{STAGE_LABEL[s]}</strong>
                    <span>{STAGE_HINT[s]}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><CheckCircle2 size={20} /> Review &amp; Submit</h2>
            <div className={historyStyles.wizardCardHint}>Double-check the details below, then submit.</div>
            <div className={historyStyles.reviewGrid}>
              <div className={historyStyles.reviewRow}><strong>Company:</strong> {form.companyName || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Contact:</strong> {form.contactPerson || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Email:</strong> {form.clientEmail || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Phone:</strong> {form.clientPhone || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Visit date:</strong> {form.visitDate || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Location:</strong> {form.location || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Purpose:</strong> {form.purpose || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Category:</strong> {form.category ? DOMAIN_DISPLAY_NAME[form.category] : '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Products:</strong> {form.productsInterested.join(', ') || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Team:</strong> {[...form.teamTechnical, ...form.teamSales].join(', ') || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Action plan:</strong> {form.actionPlan || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Stage:</strong> {form.stage ? STAGE_LABEL[form.stage] : '-'}</div>
            </div>
            <div className={calcStyles.small} style={{ marginTop: 12 }}>
              {form.projectId ? `This visit will be linked to project ${form.projectId}.` : 'No matching project — a new one will be created automatically for this client.'}
            </div>
          </>
        )}

        <div className={historyStyles.wizardNav}>
          <button type="button" className={historyStyles.bigBtnGhost} onClick={goBack} disabled={step === 0}>
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className={historyStyles.bigBtn} onClick={goNext}>
              Next →
            </button>
          ) : (
            <button type="button" className={historyStyles.bigBtn} disabled={creating} onClick={handleSubmit}>
              {creating ? 'Saving…' : 'Submit Site Visit'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
