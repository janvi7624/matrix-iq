'use client';

import { useRef, useState, type ReactNode } from 'react';
import {
  Megaphone, CheckCircle2,
  FileText, Share2, Image as ImageIcon, Video, Mail, Globe, Camera, Calendar, MoreHorizontal,
  type LucideIcon
} from 'lucide-react';
import {
  MARKETING_PRODUCT_CATEGORIES,
  MarketingProductCategory,
  MarketingRequestPriority,
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

/**
 * The confirmation screen reads three fields off whatever the submit handler
 * returned. Declared structurally rather than as MarketingRequestRecord so
 * the Partner Portal can reuse this form unchanged: it submits to
 * /api/partner/marketing-requests, which answers with the whitelisted
 * PartnerVisibleMarketingRequest (lib/partnerMarketingVisibility.ts) and
 * deliberately has no created_by.
 */
export interface SubmittedRequestSummary {
  title: string;
  product_category: string;
  created_by?: string;
}

interface MarketingRequestWizardProps {
  creating: boolean;
  onSubmit: (form: MarketingRequestForm) => Promise<SubmittedRequestSummary | null>;
  onViewAllRequests: () => void;
  /**
   * Overrides the project picker. The default, ProjectSelect, self-fetches
   * /api/projects — a route Layer 1 refuses to a partner session — so the
   * portal passes its own picker over /api/partner/projects. Everything else
   * about the form stays identical, which is the point: field parity between
   * the two audiences comes from sharing this component, not from keeping two
   * forms in step by hand.
   */
  renderProjectPicker?: (value: string, onChange: (projectId: string) => void) => ReactNode;
}

/**
 * Asking Marketing for something — ONE screen.
 *
 * This was a four-step wizard, and the steps were the reason nobody used it:
 * four requests were filed in four months. Only THREE fields are actually
 * required (title, category, description) and all three sat on step 1. Steps
 * 2 and 3 were entirely optional, and step 4 collected nothing at all — it
 * only re-displayed what you had just typed. So the form made you click
 * "Next" three times to send three fields, and the reward for filling in more
 * was more screens.
 *
 * Now: the required fields and the two one-click choices (type, priority) are
 * visible immediately, Submit is reachable from the first moment, and the
 * genuinely optional extras — project link, attachments, extra notes — sit
 * behind one disclosure for the minority of requests that need them.
 *
 * The form's SHAPE is deliberately unchanged (MarketingRequestForm, the
 * submit handler, the props). Nothing about the API, the record or the
 * portal's reuse of this component changes — this is the same request, asked
 * for in less work.
 */
export default function MarketingRequestWizard({ creating, onSubmit, onViewAllRequests, renderProjectPicker }: MarketingRequestWizardProps) {
  const toast = useToast();
  const [form, setForm] = useState<MarketingRequestForm>(emptyForm());
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [successRecord, setSuccessRecord] = useState<SubmittedRequestSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function validate(): string[] {
    const errs: string[] = [];
    if (!form.title.trim()) errs.push('Give this request a short title.');
    if (!form.productCategory) errs.push('Pick a product category.');
    if (!form.description.trim()) errs.push('Describe what you need.');
    return errs;
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
    // Every problem at once. The wizard could only ever show the first error
    // on the step you happened to be standing on.
    const errs = validate();
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    const created = await onSubmit(form);
    if (created) setSuccessRecord(created);
  }

  function handleRequestAnother() {
    setSuccessRecord(null);
    setForm(emptyForm());
    setErrors([]);
  }

  if (successRecord) {
    return (
      <div className={historyStyles.wizardCard}>
        <div className={historyStyles.successPanel}>
          <div className={historyStyles.successIcon}><CheckCircle2 size={48} /></div>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2NoAccent}`}>Request sent to Marketing</h2>
          <div className={`${calcStyles.small} ${calcStyles.mb12}`}>
            <strong>{successRecord.title}</strong> is with the Marketing team. They will come back to you — you can follow it under My Requests.
          </div>
          <div className={styles.categoryStrip}>
            <span className={styles.stripLabel}>Category:</span>
            <span className={styles.stripValue}>{successRecord.product_category}</span>
            {successRecord.created_by && (
              <>
                <span className={styles.stripDot}>•</span>
                <span className={styles.stripLabel}>Requester:</span>
                <span className={styles.stripValue}>{successRecord.created_by}</span>
              </>
            )}
          </div>
          <div className={historyStyles.successActions}>
            <button type="button" className={historyStyles.bigBtn} onClick={handleRequestAnother}>Ask for something else</button>
            <button type="button" className={historyStyles.bigBtnGhost} onClick={onViewAllRequests}>View all my requests</button>
          </div>
        </div>
      </div>
    );
  }

  const categoryStyle = getProductCategoryStyle(form.productCategory);
  const optionalCount =
    (form.projectId ? 1 : 0) + form.attachments.length + (form.additionalInfo.trim() ? 1 : 0);

  return (
    <div className={historyStyles.wizardCard}>
      <h2 className={historyStyles.wizardCardTitle}><Megaphone size={22} /> Ask Marketing for something</h2>
      <div className={historyStyles.wizardCardHint}>
        Three things to fill in. Everything else is optional.
      </div>

      {errors.length > 0 && (
        <div className={historyStyles.loginError} role="alert">
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}

      <div className={`${calcStyles.row} ${calcStyles.columns} ${styles.mt16}`}>
        <div className={`${calcStyles.field} ${styles.fieldMajor}`}>
          <label className={calcStyles.label} htmlFor="mr-title">What do you need? *</label>
          <input
            id="mr-title"
            className={calcStyles.formControl}
            placeholder="e.g. Product brochure for Smart City tender"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className={`${calcStyles.field} ${styles.fieldMinor}`}>
          <label className={calcStyles.label} htmlFor="mr-category">Product *</label>
          <select
            id="mr-category"
            className={`${calcStyles.formControl} ${form.productCategory ? styles.categorySelectActive : ''}`}
            value={form.productCategory}
            onChange={(e) => setForm((f) => ({ ...f, productCategory: e.target.value as MarketingProductCategory }))}
            style={
              form.productCategory
                ? { color: categoryStyle.text, background: categoryStyle.bg, borderColor: categoryStyle.border }
                : undefined
            }
          >
            <option value="">Select a product…</option>
            {MARKETING_PRODUCT_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={`${calcStyles.field} ${styles.mt16}`}>
        <label className={calcStyles.label} htmlFor="mr-description">Tell them a bit more *</label>
        <textarea
          id="mr-description"
          className={calcStyles.formControl}
          rows={4}
          placeholder="Who is it for, where will it be used, any sizes, branding or specifications to follow…"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div className={styles.mt16}>
        <label className={calcStyles.label}>Kind of collateral</label>
        <div className={historyStyles.tagGrid}>
          {REQUEST_TYPE_TILES.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={form.requestType === t.key}
              className={`${historyStyles.tagTile} ${form.requestType === t.key ? historyStyles.tagTileActive : ''}`}
              onClick={() => setForm((f) => ({ ...f, requestType: t.key }))}
            >
              <span className={historyStyles.tagTileEmoji}><t.icon size={22} /></span>
              <div className={historyStyles.tagTileName}>{MARKETING_REQUEST_TYPE_LABEL[t.key]}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Priority and the date sit together: the date is what actually tells
          Marketing when it is needed, and choosing "Urgent" without one has
          never scheduled anything. */}
      <div className={`${calcStyles.row} ${calcStyles.columns} ${styles.mt16}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>How soon?</label>
          <div className={historyStyles.stageOptions}>
            {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={form.priority === p}
                className={`${historyStyles.stageOption} ${form.priority === p ? historyStyles.stageOptionActive : ''}`}
                onClick={() => setForm((f) => ({ ...f, priority: p }))}
              >
                <strong>{MARKETING_PRIORITY_META[p].label}</strong>
                <span>{MARKETING_PRIORITY_META[p].hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label} htmlFor="mr-needed">Needed by</label>
          <input
            id="mr-needed"
            type="date"
            className={calcStyles.formControl}
            min={todayDateInputValue()}
            value={form.neededByDate}
            onChange={(e) => setForm((f) => ({ ...f, neededByDate: e.target.value }))}
          />
          <span className={calcStyles.small}>Leave blank if there is no fixed date.</span>
        </div>
      </div>

      {/* A native <details>: no state to manage, keyboard and screen readers
          handle it for free, and it stays open once opened. The count in the
          summary is what stops anything added here being forgotten when it is
          closed again. */}
      <details className={styles.moreDetails}>
        <summary className={styles.moreSummary}>
          Add a project, files or notes
          {optionalCount > 0 && <span className={styles.moreBadge}>{optionalCount}</span>}
        </summary>

        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Related sales project</label>
          {renderProjectPicker ? (
            renderProjectPicker(form.projectId, (projectId) => setForm((f) => ({ ...f, projectId })))
          ) : (
            <ProjectSelect
              value={form.projectId}
              placeholder="-- Not linked to a specific project --"
              onChange={(projectId) => setForm((f) => ({ ...f, projectId }))}
            />
          )}
        </div>

        <div className={styles.mb16}>
          <label className={calcStyles.label}>Reference files</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            multiple
            className={styles.hiddenInput}
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <div>
            <button type="button" className={calcStyles.secondaryButton} disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? 'Uploading…' : '+ Add files'}
            </button>
          </div>

          {form.attachments.length > 0 && (
            <div className={`${historyStyles.imageStrip} ${calcStyles.mt12}`}>
              {form.attachments.map((url) => (
                <div key={url} className={styles.attachmentThumbWrap}>
                  <button
                    type="button"
                    className={historyStyles.imageStripRemoveBtn}
                    aria-label="Remove this attachment"
                    onClick={() => setForm((f) => ({ ...f, attachments: f.attachments.filter((u) => u !== url) }))}
                  >
                    {/* A just-uploaded blob URL, not a known-size asset —
                        next/image cannot optimise it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={calcStyles.field}>
          <label className={calcStyles.label} htmlFor="mr-extra">Anything else</label>
          <textarea
            id="mr-extra"
            className={calcStyles.formControl}
            rows={3}
            placeholder="Client requirements, reference links, technical notes…"
            value={form.additionalInfo}
            onChange={(e) => setForm((f) => ({ ...f, additionalInfo: e.target.value }))}
          />
        </div>
      </details>

      <div className={`${historyStyles.wizardNav} ${styles.mt24}`}>
        <span />
        <button type="button" className={historyStyles.bigBtn} disabled={creating} onClick={handleSubmit}>
          {creating ? 'Sending…' : 'Send to Marketing'}
        </button>
      </div>
    </div>
  );
}
