'use client';

import { useRef, useState } from 'react';
import {
  Megaphone, Flame, Paperclip, CheckCircle2,
  FileText, Share2, Image as ImageIcon, Video, Mail, Globe, Camera, Calendar, MoreHorizontal,
  Layers,
  type LucideIcon
} from 'lucide-react';
import {
  MARKETING_PRODUCT_CATEGORIES,
  MarketingProductCategory,
  MarketingRequestPriority,
  MarketingRequestRecord,
  MarketingRequestType
} from '@/lib/types';
import { MARKETING_PRIORITY_META, MARKETING_REQUEST_TYPE_LABEL, getProductCategoryStyle } from '@/lib/marketingRequestHelpers';
import { todayDateInputValue } from '@/lib/dateHelpers';
import { useToast } from './ui/ToastProvider';
import ProjectSelect from './ui/ProjectSelect';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './marketingRequestWizard.module.css';

export interface MarketingRequestForm {
  title: string;
  productCategory: MarketingProductCategory;
  requestType: MarketingRequestType;
  description: string;
  additionalInfo: string;
  priority: MarketingRequestPriority;
  neededByDate: string;
  projectId: string;
  attachments: string[];
}

function emptyForm(): MarketingRequestForm {
  return {
    title: '',
    productCategory: '',
    requestType: 'other',
    description: '',
    additionalInfo: '',
    priority: 'medium',
    neededByDate: '',
    projectId: '',
    attachments: []
  };
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
  { icon: Megaphone, label: 'Request & Category' },
  { icon: Flame, label: 'Priority & Deadline' },
  { icon: Paperclip, label: 'Files & Details' },
  { icon: CheckCircle2, label: 'Review & Submit' }
];

interface MarketingRequestWizardProps {
  creating: boolean;
  onSubmit: (form: MarketingRequestForm) => Promise<MarketingRequestRecord | null>;
  onViewAllRequests: () => void;
}

export default function MarketingRequestWizard({ creating, onSubmit, onViewAllRequests }: MarketingRequestWizardProps) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<MarketingRequestForm>(emptyForm());
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [successRecord, setSuccessRecord] = useState<MarketingRequestRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function validateStep(index: number): string[] {
    if (index === 0) {
      const errs: string[] = [];
      if (!form.title.trim()) errs.push('Give this request a short title.');
      if (!form.productCategory) errs.push('Please select a Product Category.');
      if (!form.description.trim()) errs.push('Describe what you need — the more detail, the faster Marketing can help.');
      return errs;
    }
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
          <h2 className={`${calcStyles.h2} ${calcStyles.h2NoAccent}`}>Request sent to Marketing!</h2>
          <div className={`${calcStyles.small} ${calcStyles.mb12}`}>
            <strong>{successRecord.title}</strong> has been submitted. A Marketing Team member will review your requirement, prepare the content, and coordinate technical review before delivering the final result back to you.
          </div>
          <div className={styles.categoryStrip}>
            <span className={styles.stripLabel}>Category:</span>
            <span className={styles.stripValue}>{successRecord.product_category}</span>
            <span className={styles.stripDot}>•</span>
            <span className={styles.stripLabel}>Requester:</span>
            <span className={styles.stripValue}>{successRecord.created_by}</span>
          </div>
          <div className={historyStyles.successActions}>
            <button type="button" className={historyStyles.bigBtn} onClick={handleRequestAnother}>Submit Another Request</button>
            <button type="button" className={historyStyles.bigBtnGhost} onClick={onViewAllRequests}>View All My Requests</button>
          </div>
        </div>
      </div>
    );
  }

  const categoryStyle = getProductCategoryStyle(form.productCategory);

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
            <h2 className={historyStyles.wizardCardTitle}><Megaphone size={22} /> Request Details &amp; Product Category</h2>
            <div className={historyStyles.wizardCardHint}>Specify what marketing collateral or assistance you need and the product domain.</div>
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}

            <div className={`${calcStyles.row} ${calcStyles.columns} ${styles.mt16}`}>
              <div className={`${calcStyles.field} ${styles.fieldMajor}`}>
                <label className={calcStyles.label}>Request Title *</label>
                <input
                  className={calcStyles.formControl}
                  placeholder="e.g. Product Brochure for Smart City Tender"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>

              <div className={`${calcStyles.field} ${styles.fieldMinor}`}>
                <label className={calcStyles.label}>Product Category *</label>
                <select
                  className={`${calcStyles.formControl} ${form.productCategory ? styles.categorySelectActive : ''}`}
                  value={form.productCategory}
                  onChange={(e) => setForm((f) => ({ ...f, productCategory: e.target.value as MarketingProductCategory }))}
                  style={
                    form.productCategory
                      ? {
                          color: categoryStyle.text,
                          background: categoryStyle.bg,
                          borderColor: categoryStyle.border
                        }
                      : undefined
                  }
                >
                  <option value="">[ Select Product Category ▼ ]</option>
                  {MARKETING_PRODUCT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.mt16}>
              <label className={calcStyles.label}>Collateral Type</label>
              <div className={historyStyles.tagGrid}>
                {REQUEST_TYPE_TILES.map((t) => (
                  <div
                    key={t.key}
                    className={`${historyStyles.tagTile} ${form.requestType === t.key ? historyStyles.tagTileActive : ''}`}
                    onClick={() => setForm((f) => ({ ...f, requestType: t.key }))}
                  >
                    <span className={historyStyles.tagTileEmoji}><t.icon size={22} /></span>
                    <div className={historyStyles.tagTileName}>{MARKETING_REQUEST_TYPE_LABEL[t.key]}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${calcStyles.field} ${styles.mt16}`}>
              <label className={calcStyles.label}>Description of Requirement *</label>
              <textarea
                className={calcStyles.formControl}
                rows={4}
                placeholder="Describe what you need — target audience, key product specifications, dimensions, where it will be used, specific branding notes..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Related Sales Project (Optional)</label>
              <ProjectSelect
                value={form.projectId}
                placeholder="-- Not linked to a specific project --"
                onChange={(projectId) => setForm((f) => ({ ...f, projectId }))}
              />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Flame size={22} /> Priority &amp; Required Deadline</h2>
            <div className={historyStyles.wizardCardHint}>Help Marketing and Technical prioritize your request accurately.</div>
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
            <div className={`${calcStyles.field} ${styles.mt20}`}>
              <label className={calcStyles.label}>Required Deadline / Needed By Date (Optional)</label>
              <input
                type="date"
                className={calcStyles.formControl}
                min={todayDateInputValue()}
                value={form.neededByDate}
                onChange={(e) => setForm((f) => ({ ...f, neededByDate: e.target.value }))}
              />
              <span className={calcStyles.small}>The date you need this collateral ready. Marketing will align on this timeline.</span>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Paperclip size={22} /> Attachments &amp; Additional Information</h2>
            <div className={historyStyles.wizardCardHint}>Add reference logos, sample documents, product data sheets, or extra notes.</div>

            <div className={styles.mb16}>
              <label className={calcStyles.label}>Attachments</label>
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" multiple className={styles.hiddenInput} onChange={(e) => handleFilesSelected(e.target.files)} />
              <div>
                <button type="button" className={calcStyles.secondaryButton} disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  {uploading ? 'Uploading…' : '+ Add Files / Attachments'}
                </button>
              </div>

              {form.attachments.length > 0 && (
                <div className={`${historyStyles.imageStrip} ${calcStyles.mt12}`}>
                  {form.attachments.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <div key={url} className={styles.attachmentThumbWrap}>
                      <img src={url} alt="Attachment" title="Click to remove" onClick={() => setForm((f) => ({ ...f, attachments: f.attachments.filter((u) => u !== url) }))} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`${calcStyles.field} ${styles.mt16}`}>
              <label className={calcStyles.label}>Additional Information (Optional)</label>
              <textarea
                className={calcStyles.formControl}
                rows={3}
                placeholder="Any client requirements, technical specifications, reference links, or notes..."
                value={form.additionalInfo}
                onChange={(e) => setForm((f) => ({ ...f, additionalInfo: e.target.value }))}
              />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><CheckCircle2 size={22} /> Review &amp; Submit Request</h2>
            <div className={historyStyles.wizardCardHint}>Review all information before submitting to the Marketing team.</div>

            <div className={`${historyStyles.reviewGrid} ${styles.mt16}`}>
              <div className={historyStyles.reviewRow}>
                <strong>Product Category:</strong>
                <span className={styles.categoryPill} style={{ background: categoryStyle.bg, color: categoryStyle.text }}>
                  {form.productCategory}
                </span>
              </div>
              <div className={historyStyles.reviewRow}><strong>Title:</strong> {form.title || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Type:</strong> {MARKETING_REQUEST_TYPE_LABEL[form.requestType]}</div>
              <div className={historyStyles.reviewRow}><strong>Priority:</strong> {MARKETING_PRIORITY_META[form.priority].label}</div>
              <div className={historyStyles.reviewRow}><strong>Required Deadline:</strong> {form.neededByDate || 'Not specified'}</div>
              <div className={historyStyles.reviewRow}><strong>Attachments:</strong> {form.attachments.length ? `${form.attachments.length} file(s)` : 'None'}</div>
              <div className={historyStyles.reviewRow}><strong>Description:</strong> {form.description || '-'}</div>
              {form.additionalInfo && (
                <div className={historyStyles.reviewRow}><strong>Additional Info:</strong> {form.additionalInfo}</div>
              )}
            </div>
          </>
        )}

        <div className={`${historyStyles.wizardNav} ${styles.mt24}`}>
          {step > 0 ? <button type="button" className={historyStyles.bigBtnGhost} onClick={goBack}>← Back</button> : <span />}
          {step < STEPS.length - 1 ? (
            <button type="button" className={historyStyles.bigBtn} onClick={goNext}>Next →</button>
          ) : (
            <button type="button" className={historyStyles.bigBtn} disabled={creating} onClick={handleSubmit}>
              {creating ? 'Sending to Marketing…' : 'Submit Marketing Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
