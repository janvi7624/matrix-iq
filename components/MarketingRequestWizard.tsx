'use client';

import { useRef, useState } from 'react';
import {
  Megaphone, Flame, Paperclip, CheckCircle2,
  FileText, Share2, Image as ImageIcon, Video, Mail, Globe, Camera, Calendar, MoreHorizontal,
  type LucideIcon
} from 'lucide-react';
import { MarketingRequestPriority, MarketingRequestRecord, MarketingRequestType, ProjectRecord } from '@/lib/types';
import { MARKETING_PRIORITY_META, MARKETING_REQUEST_TYPE_LABEL } from '@/lib/marketingRequestHelpers';
import { STAGE_LABEL as PROJECT_STAGE_LABEL } from '@/lib/projectStages';
import { todayDateInputValue } from '@/lib/dateHelpers';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

export interface MarketingRequestForm {
  title: string;
  requestType: MarketingRequestType;
  description: string;
  priority: MarketingRequestPriority;
  neededByDate: string;
  projectId: string;
  attachments: string[];
}

function emptyForm(): MarketingRequestForm {
  return { title: '', requestType: 'other', description: '', priority: 'medium', neededByDate: '', projectId: '', attachments: [] };
}

const REQUEST_TYPE_TILES: { key: MarketingRequestType; icon: LucideIcon }[] = [
  { key: 'brochure_flyer', icon: FileText },
  { key: 'social_media', icon: Share2 },
  { key: 'banner_standee', icon: ImageIcon },
  { key: 'video_reel', icon: Video },
  { key: 'email_campaign', icon: Mail },
  { key: 'website_update', icon: Globe },
  { key: 'product_photography', icon: Camera },
  { key: 'event_collateral', icon: Calendar },
  { key: 'other', icon: MoreHorizontal }
];

const STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: Megaphone, label: 'What Do You Need' },
  { icon: Flame, label: 'Priority & Timing' },
  { icon: Paperclip, label: 'Attachments' },
  { icon: CheckCircle2, label: 'Review & Submit' }
];

interface MarketingRequestWizardProps {
  creating: boolean;
  projects: ProjectRecord[];
  onSubmit: (form: MarketingRequestForm) => Promise<MarketingRequestRecord | null>;
  onViewAllRequests: () => void;
}

export default function MarketingRequestWizard({ creating, projects, onSubmit, onViewAllRequests }: MarketingRequestWizardProps) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<MarketingRequestForm>(emptyForm());
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [successRecord, setSuccessRecord] = useState<MarketingRequestRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function validateStep(index: number): string[] {
    if (index === 0 && !form.title.trim()) return ['Give this request a short title.'];
    if (index === 0 && !form.description.trim()) return ['Describe what you need — the more detail, the faster Marketing can help.'];
    return [];
  }

  function goNext() {
    const errs = validateStep(step);
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function goBack() {
    setErrors([]);
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('folder', 'marketing-requests');
      Array.from(fileList).forEach((f) => body.append('files', f));
      const response = await fetch('/api/uploads', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      const data: { urls: string[] } = await response.json();
      setForm((f) => ({ ...f, attachments: [...f.attachments, ...data.urls] }));
    } catch {
      toast.error('Could not upload one or more files. Try a smaller file.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const errs = validateStep(i);
      if (errs.length) {
        setStep(i);
        setErrors(errs);
        return;
      }
    }
    const created = await onSubmit(form);
    if (created) setSuccessRecord(created);
  }

  function handleRequestAnother() {
    setSuccessRecord(null);
    setForm(emptyForm());
    setStep(0);
  }

  if (successRecord) {
    return (
      <div className={historyStyles.wizardCard}>
        <div className={historyStyles.successPanel}>
          <div className={historyStyles.successIcon}><CheckCircle2 size={48} /></div>
          <h2 className={calcStyles.h2} style={{ marginTop: 0, borderLeft: 'none', paddingLeft: 0 }}>Request sent to Marketing!</h2>
          <div className={calcStyles.small}>
            {successRecord.title} — Marketing will review it and set a delivery timeline soon.
          </div>
          <div className={historyStyles.successActions}>
            <button type="button" className={historyStyles.bigBtn} onClick={handleRequestAnother}>Submit Another Request</button>
            <button type="button" className={historyStyles.bigBtnGhost} onClick={onViewAllRequests}>View All My Requests</button>
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
            onClick={() => i < step && setStep(i)}
          >
            <span className={historyStyles.wizardStepCircle}>{i < step ? '✓' : <s.icon size={18} />}</span>
            <span className={historyStyles.wizardStepLabel}>{i + 1}. {s.label}</span>
          </button>
        ))}
      </div>

      <div className={historyStyles.wizardCard}>
        {step === 0 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Megaphone size={22} /> What Do You Need?</h2>
            <div className={historyStyles.wizardCardHint}>Pick the closest match, then describe it in your own words.</div>
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}
            <div className={historyStyles.tagGrid}>
              {REQUEST_TYPE_TILES.map((t) => (
                <div
                  key={t.key}
                  className={`${historyStyles.tagTile} ${form.requestType === t.key ? historyStyles.tagTileActive : ''}`}
                  onClick={() => setForm((f) => ({ ...f, requestType: t.key }))}
                >
                  <span className={historyStyles.tagTileEmoji}><t.icon size={24} /></span>
                  <div className={historyStyles.tagTileName}>{MARKETING_REQUEST_TYPE_LABEL[t.key]}</div>
                </div>
              ))}
            </div>
            <div className={calcStyles.field} style={{ marginTop: 16 }}>
              <label className={calcStyles.label}>Title</label>
              <input
                className={calcStyles.formControl}
                placeholder="e.g. Brochure for the XYZ Corp proposal"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>What exactly do you need?</label>
              <textarea
                className={calcStyles.formControl}
                rows={5}
                placeholder="Describe the request — sizes, quantities, where it'll be used, any brand/client details..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            {projects.length > 0 && (
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Related project (optional)</label>
                <select className={calcStyles.formControl} value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}>
                  <option value="">-- Not linked to a project --</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.id} — {p.company || p.client_name} ({PROJECT_STAGE_LABEL[p.stage]})</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Flame size={22} /> Priority &amp; Timing</h2>
            <div className={historyStyles.wizardCardHint}>How urgent is this? Marketing will confirm the actual delivery date.</div>
            <div className={historyStyles.stageOptions}>
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
                <div
                  key={p}
                  className={`${historyStyles.stageOption} ${form.priority === p ? historyStyles.stageOptionActive : ''}`}
                  onClick={() => setForm((f) => ({ ...f, priority: p }))}
                >
                  <strong>{MARKETING_PRIORITY_META[p].label}</strong>
                  <span>{MARKETING_PRIORITY_META[p].hint}</span>
                </div>
              ))}
            </div>
            <div className={calcStyles.field} style={{ marginTop: 16 }}>
              <label className={calcStyles.label}>Needed by (optional)</label>
              <input
                type="date"
                className={calcStyles.formControl}
                min={todayDateInputValue()}
                value={form.neededByDate}
                onChange={(e) => setForm((f) => ({ ...f, neededByDate: e.target.value }))}
              />
              <span className={calcStyles.small}>This is what you're hoping for — Marketing will confirm a real delivery date once they review your request.</span>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Paperclip size={22} /> Attachments</h2>
            <div className={historyStyles.wizardCardHint}>Add reference images, a brief, or a logo file — optional, but it helps Marketing get it right the first time.</div>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx" multiple style={{ display: 'none' }} onChange={(e) => handleFilesSelected(e.target.files)} />
            <button type="button" className={calcStyles.secondaryButton} disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? 'Uploading…' : '+ Add Files'}
            </button>
            {form.attachments.length > 0 && (
              <div className={historyStyles.imageStrip}>
                {form.attachments.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={url} src={url} alt="Attachment" onClick={() => setForm((f) => ({ ...f, attachments: f.attachments.filter((u) => u !== url) }))} title="Click to remove" />
                ))}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><CheckCircle2 size={22} /> Review &amp; Submit</h2>
            <div className={historyStyles.wizardCardHint}>Double-check the details below, then send it to Marketing.</div>
            <div className={historyStyles.reviewGrid}>
              <div className={historyStyles.reviewRow}><strong>Type:</strong> {MARKETING_REQUEST_TYPE_LABEL[form.requestType]}</div>
              <div className={historyStyles.reviewRow}><strong>Title:</strong> {form.title || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Priority:</strong> {MARKETING_PRIORITY_META[form.priority].label}</div>
              <div className={historyStyles.reviewRow}><strong>Needed by:</strong> {form.neededByDate || 'Not specified'}</div>
              <div className={historyStyles.reviewRow}><strong>Attachments:</strong> {form.attachments.length || 'None'}</div>
              <div className={historyStyles.reviewRow}><strong>Description:</strong> {form.description || '-'}</div>
            </div>
          </>
        )}

        <div className={historyStyles.wizardNav}>
          {step > 0 ? <button type="button" className={historyStyles.bigBtnGhost} onClick={goBack}>← Back</button> : <span />}
          {step < STEPS.length - 1 ? (
            <button type="button" className={historyStyles.bigBtn} onClick={goNext}>Next →</button>
          ) : (
            <button type="button" className={historyStyles.bigBtn} disabled={creating} onClick={handleSubmit}>
              {creating ? 'Sending…' : 'Send to Marketing'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
