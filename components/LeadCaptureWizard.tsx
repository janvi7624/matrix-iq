'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { DomainKey, LeadPriority, LeadRecord } from '@/lib/types';
import { LEAD_DOMAIN_TILES, LEAD_SUB_INTERESTS, LEAD_FOLLOW_UP_ACTIONS, LEAD_BUDGET_OPTIONS, LEAD_PRIORITY_META } from '@/lib/leadInterestOptions';
import { preprocessCardImage, scanBusinessCard } from '@/lib/cardOcr';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface LeadForm {
  name: string;
  mobile: string;
  email: string;
  designation: string;
  company: string;
  city: string;
  cardImageUrl: string;
  interests: DomainKey[];
  subInterests: string[];
  priority: LeadPriority;
  followUpActions: string[];
  budget: string;
  notes: string;
}

function emptyForm(): LeadForm {
  return { name: '', mobile: '', email: '', designation: '', company: '', city: '', cardImageUrl: '', interests: [], subInterests: [], priority: '', followUpActions: [], budget: '', notes: '' };
}

const STEPS = [
  { icon: '📸', label: 'Capture' },
  { icon: '👤', label: 'Confirm Details' },
  { icon: '🎯', label: 'Area of Interest' },
  { icon: '🔥', label: 'Priority & Follow-up' },
  { icon: '📝', label: 'Notes' },
  { icon: '✅', label: 'Review & Submit' }
];

interface LeadCaptureWizardProps {
  creating: boolean;
  onSubmit: (form: LeadForm) => Promise<LeadRecord | null>;
  onConvertToCrm: (leadId: string) => Promise<boolean>;
}

export default function LeadCaptureWizard({ creating, onSubmit, onConvertToCrm }: LeadCaptureWizardProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<LeadForm>(emptyForm());
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanNote, setScanNote] = useState('');
  const [successRecord, setSuccessRecord] = useState<LeadRecord | null>(null);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  async function handleImageSelected(file: File | undefined) {
    if (!file) return;
    setScanning(true);
    setScanProgress(0);
    setScanNote('Preparing photo…');
    try {
      const [uploadResult] = await Promise.all([
        (async (): Promise<string | null> => {
          const body = new FormData();
          body.append('folder', 'leads');
          body.append('files', file);
          const response = await fetch('/api/uploads', { method: 'POST', body });
          if (!response.ok) return null;
          const data: { urls: string[] } = await response.json();
          return data.urls[0] || null;
        })(),
        (async () => {
          setScanNote('Reading business card…');
          const preprocessed = await preprocessCardImage(file);
          const parsed = await scanBusinessCard(preprocessed, (pct) => setScanProgress(pct));
          setForm((f) => ({
            ...f,
            name: parsed.name || f.name,
            mobile: parsed.mobile || f.mobile,
            email: parsed.email || f.email,
            designation: parsed.designation || f.designation,
            company: parsed.company || f.company,
            city: parsed.city || f.city
          }));
        })()
      ]);

      if (uploadResult) setForm((f) => ({ ...f, cardImageUrl: uploadResult }));
      setStep(1);
    } catch {
      setScanNote('Could not read the card automatically — please enter the details manually below.');
      setStep(1);
    } finally {
      setScanning(false);
    }
  }

  function manualEntry() {
    setStep(1);
  }

  function toggleInterest(domain: DomainKey) {
    setForm((f) => ({ ...f, interests: f.interests.includes(domain) ? f.interests.filter((d) => d !== domain) : [...f.interests, domain] }));
  }

  function toggleSubInterest(tag: string) {
    setForm((f) => ({ ...f, subInterests: f.subInterests.includes(tag) ? f.subInterests.filter((t) => t !== tag) : [...f.subInterests, tag] }));
  }

  function toggleFollowUp(tag: string) {
    setForm((f) => ({ ...f, followUpActions: f.followUpActions.includes(tag) ? f.followUpActions.filter((t) => t !== tag) : [...f.followUpActions, tag] }));
  }

  function validateStep(index: number): string[] {
    if (index === 1 && !form.name.trim() && !form.company.trim()) return ['Enter at least a name or a company.'];
    if (index === 2 && form.interests.length === 0) return ['Select at least one area of interest.'];
    if (index === 3 && !form.priority) return ['Select a priority level.'];
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

  async function handleSubmit() {
    for (let i = 1; i < STEPS.length - 1; i++) {
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

  function handleCaptureNext() {
    setSuccessRecord(null);
    setConverted(false);
    setForm(emptyForm());
    setStep(0);
  }

  async function handleConvert() {
    if (!successRecord) return;
    setConverting(true);
    try {
      const ok = await onConvertToCrm(successRecord.id);
      if (ok) setConverted(true);
    } finally {
      setConverting(false);
    }
  }

  if (successRecord) {
    return (
      <div className={historyStyles.wizardCard}>
        <div className={historyStyles.successPanel}>
          <div className={historyStyles.successIcon}>✅</div>
          <h2 className={calcStyles.h2} style={{ marginTop: 0, borderLeft: 'none', paddingLeft: 0 }}>Lead saved!</h2>
          <div className={calcStyles.small}>
            {successRecord.name || successRecord.company}
            {successRecord.priority && (
              <span className={`${historyStyles.priorityBadge} ${successRecord.priority === 'hot' ? historyStyles.priorityBadgeHot : successRecord.priority === 'warm' ? historyStyles.priorityBadgeWarm : historyStyles.priorityBadgeCool}`} style={{ marginLeft: 8 }}>
                {successRecord.priority.toUpperCase()}
              </span>
            )}
          </div>
          <div className={historyStyles.successActions}>
            <button type="button" className={historyStyles.bigBtn} onClick={handleCaptureNext}>📸 Scan Next Lead</button>
            <Link className={historyStyles.bigBtnGhost} href="/leads?view=list">📋 View All Leads</Link>
            {!converted ? (
              <button type="button" className={historyStyles.bigBtnGhost} disabled={converting} onClick={handleConvert}>
                {converting ? 'Converting…' : '🤝 Convert to CRM Contact'}
              </button>
            ) : (
              <div className={historyStyles.autofillNotice}>Added to the CRM pipeline.</div>
            )}
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
            <span className={historyStyles.wizardStepCircle}>{i < step ? '✓' : s.icon}</span>
            <span className={historyStyles.wizardStepLabel}>{i + 1}. {s.label}</span>
          </button>
        ))}
      </div>

      <div className={historyStyles.wizardCard}>
        {step === 0 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><span>📸</span> Capture the Lead</h2>
            <div className={historyStyles.wizardCardHint}>Scan a business card and we&apos;ll read the details automatically — or enter them by hand.</div>

            {scanning ? (
              <div className={historyStyles.scanProgress}>
                <div className={historyStyles.scanSpinner} />
                <div className={historyStyles.scanProgressPct}>{scanProgress}%</div>
                <div className={historyStyles.scanProgressText}>{scanNote}</div>
              </div>
            ) : (
              <div className={historyStyles.captureChoices}>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => handleImageSelected(e.target.files?.[0])} />
                <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageSelected(e.target.files?.[0])} />

                <button type="button" className={historyStyles.captureCard} onClick={() => cameraInputRef.current?.click()}>
                  <div className={historyStyles.captureCardIcon}>📸</div>
                  <div>
                    <div className={historyStyles.captureCardTitle}>Scan Business Card</div>
                    <div className={historyStyles.captureCardSub}>Opens your camera — take a photo and we&apos;ll read the details instantly</div>
                  </div>
                </button>

                <button type="button" className={`${historyStyles.captureCard} ${historyStyles.captureCardGhost}`} onClick={() => galleryInputRef.current?.click()}>
                  <div className={historyStyles.captureCardIcon}>🖼️</div>
                  <div>
                    <div className={historyStyles.captureCardTitle}>Upload from Gallery</div>
                    <div className={historyStyles.captureCardSub}>Pick an existing photo of a business card</div>
                  </div>
                </button>

                <button type="button" className={`${historyStyles.captureCard} ${historyStyles.captureCardGhost}`} onClick={manualEntry}>
                  <div className={historyStyles.captureCardIcon}>✍️</div>
                  <div>
                    <div className={historyStyles.captureCardTitle}>Enter Manually</div>
                    <div className={historyStyles.captureCardSub}>Type contact details directly</div>
                  </div>
                </button>
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><span>👤</span> Confirm Details</h2>
            <div className={historyStyles.wizardCardHint}>{scanNote || 'Correct anything the scan got wrong — every field is editable.'}</div>
            {form.cardImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.cardImageUrl} alt="Business card" style={{ maxHeight: 140, borderRadius: 10, marginBottom: 14, border: '1px solid #e5e7eb' }} />
            )}
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Full name</label>
                <input className={calcStyles.formControl} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Designation</label>
                <input className={calcStyles.formControl} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Purchase Manager" />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Company</label>
              <input className={calcStyles.formControl} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Mobile</label>
                <input className={calcStyles.formControl} type="tel" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Email</label>
                <input className={calcStyles.formControl} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>City</label>
                <input className={calcStyles.formControl} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><span>🎯</span> Area of Interest</h2>
            <div className={historyStyles.wizardCardHint}>What is this contact interested in? Select all that apply.</div>
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}
            <div className={historyStyles.tagGrid}>
              {LEAD_DOMAIN_TILES.map((t) => (
                <div
                  key={t.key}
                  className={`${historyStyles.tagTile} ${form.interests.includes(t.key) ? historyStyles.tagTileActive : ''}`}
                  onClick={() => toggleInterest(t.key)}
                >
                  <span className={historyStyles.tagTileEmoji}>{t.icon}</span>
                  <div className={historyStyles.tagTileName}>{t.label}</div>
                  <div className={historyStyles.tagTileHint}>{t.hint}</div>
                </div>
              ))}
            </div>
            {form.interests.map((domain) => {
              const options = LEAD_SUB_INTERESTS[domain];
              if (!options) return null;
              const tile = LEAD_DOMAIN_TILES.find((t) => t.key === domain);
              return (
                <div key={domain} style={{ marginTop: 14 }}>
                  <div className={calcStyles.label}>{tile?.icon} Which {tile?.label.toLowerCase()}?</div>
                  <div className={historyStyles.pillWrap}>
                    {options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={`${historyStyles.pillBtn} ${form.subInterests.includes(opt) ? historyStyles.pillBtnActive : ''}`}
                        onClick={() => toggleSubInterest(opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><span>🔥</span> Priority &amp; Follow-up</h2>
            <div className={historyStyles.wizardCardHint}>How hot is this lead, and what&apos;s the next action?</div>
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}
            <div className={historyStyles.stageOptions}>
              {(['hot', 'warm', 'cool'] as const).map((p) => (
                <div
                  key={p}
                  className={`${historyStyles.stageOption} ${form.priority === p ? historyStyles.stageOptionActive : ''}`}
                  onClick={() => setForm((f) => ({ ...f, priority: p }))}
                >
                  <strong>{LEAD_PRIORITY_META[p].icon} {LEAD_PRIORITY_META[p].label}</strong>
                  <span>{LEAD_PRIORITY_META[p].hint}</span>
                </div>
              ))}
            </div>

            <div className={calcStyles.label} style={{ marginTop: 16 }}>Follow-up action</div>
            <div className={historyStyles.chipGrid}>
              {LEAD_FOLLOW_UP_ACTIONS.map((a) => (
                <div
                  key={a.tag}
                  className={`${historyStyles.chipBtn} ${form.followUpActions.includes(a.tag) ? historyStyles.chipBtnActive : ''}`}
                  onClick={() => toggleFollowUp(a.tag)}
                >
                  <span className={historyStyles.chipEmoji}>{a.icon}</span>
                  <span className={historyStyles.chipLabel}>{a.tag}</span>
                </div>
              ))}
            </div>

            <div className={calcStyles.label} style={{ marginTop: 16 }}>Budget range</div>
            <div className={historyStyles.pillWrap}>
              {LEAD_BUDGET_OPTIONS.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`${historyStyles.pillBtn} ${form.budget === b ? historyStyles.pillBtnActive : ''}`}
                  onClick={() => setForm((f) => ({ ...f, budget: f.budget === b ? '' : b }))}
                >
                  {b}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><span>📝</span> Notes</h2>
            <div className={historyStyles.wizardCardHint}>Specific requirement, product discussed, timeline, competitor mentioned…</div>
            <div className={calcStyles.field}>
              <textarea className={calcStyles.formControl} rows={5} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><span>✅</span> Review &amp; Submit</h2>
            <div className={historyStyles.wizardCardHint}>Double-check the details below, then save.</div>
            <div className={historyStyles.reviewGrid}>
              <div className={historyStyles.reviewRow}><strong>Name:</strong> {form.name || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Designation:</strong> {form.designation || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Company:</strong> {form.company || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Mobile:</strong> {form.mobile || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Email:</strong> {form.email || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>City:</strong> {form.city || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Interests:</strong> {form.interests.join(', ') || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Specifics:</strong> {form.subInterests.join(', ') || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Priority:</strong> {form.priority ? LEAD_PRIORITY_META[form.priority].label : '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Follow-up:</strong> {form.followUpActions.join(', ') || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Budget:</strong> {form.budget || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Notes:</strong> {form.notes || '-'}</div>
            </div>
          </>
        )}

        {step > 0 && (
          <div className={historyStyles.wizardNav}>
            <button type="button" className={historyStyles.bigBtnGhost} onClick={goBack}>← Back</button>
            {step < STEPS.length - 1 ? (
              <button type="button" className={historyStyles.bigBtn} onClick={goNext}>Next →</button>
            ) : (
              <button type="button" className={historyStyles.bigBtn} disabled={creating} onClick={handleSubmit}>
                {creating ? 'Saving…' : '✅ Save Lead & Next Person'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
