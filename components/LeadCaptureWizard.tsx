'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DomainKey, LeadHandoverOutcome, LeadHandoverRecipient, LeadPriority, LeadRecord } from '@/lib/types';
import { LEAD_DOMAIN_TILES, LEAD_SUB_INTERESTS, LEAD_FOLLOW_UP_ACTIONS, LEAD_BUDGET_OPTIONS, LEAD_PRIORITY_META } from '@/lib/leadInterestOptions';
import { preprocessCardImage, scanBusinessCard } from '@/lib/cardOcr';
import { Camera, User, Target, Flame, StickyNote, CheckCircle2, RefreshCw, Images, PenLine, Send, UserCheck } from 'lucide-react';
import PhoneInput from '@/components/ui/PhoneInput';
import Select from '@/components/ui/Select';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './leadCaptureWizard.module.css';

interface LeadForm {
  name: string;
  mobile: string;
  // Some cards list two numbers — this one's never OCR-filled, only typed in
  // by hand, since lib/cardOcr.ts's phone regex only ever captures the first.
  altMobile: string;
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
  // The colleague this card belongs to, when the person scanning it isn't
  // that colleague. '' = Unassigned (a sales manager routes it).
  handoverToId: string;
}

function emptyForm(): LeadForm {
  return { name: '', mobile: '', altMobile: '', email: '', designation: '', company: '', city: '', cardImageUrl: '', interests: [], subInterests: [], priority: '', followUpActions: [], budget: '', notes: '', handoverToId: '' };
}

const STEPS = [
  { icon: Camera, label: 'Capture' },
  { icon: User, label: 'Confirm Details' },
  { icon: Target, label: 'Area of Interest' },
  { icon: Flame, label: 'Priority & Follow-up' },
  { icon: StickyNote, label: 'Notes' },
  { icon: CheckCircle2, label: 'Review & Submit' }
];

type LeadSubmitResult = LeadRecord & { duplicate?: boolean; duplicateCapturedBy?: string; handover?: LeadHandoverOutcome };

interface LeadCaptureWizardProps {
  creating: boolean;
  onSubmit: (form: LeadForm) => Promise<LeadSubmitResult | null>;
  onViewAllLeads: () => void;
}

export default function LeadCaptureWizard({ creating, onSubmit, onViewAllLeads }: LeadCaptureWizardProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<LeadForm>(emptyForm());
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanNote, setScanNote] = useState('');
  const [successRecord, setSuccessRecord] = useState<LeadSubmitResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<LeadHandoverRecipient[] | null>(null);
  const [recipientsFailed, setRecipientsFailed] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Loaded up front so the dropdown is ready by the time the scan finishes.
  // A failure only costs the hand-over option — the lead still saves as
  // Unassigned.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/leads/handover-recipients')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { recipients: LeadHandoverRecipient[] }) => {
        if (!cancelled) setRecipients(data.recipients);
      })
      .catch(() => {
        if (!cancelled) setRecipientsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Grouped by department so a name is found by team, and two people with
  // the same first name (Yashvi Panchal, Yashvi Shah) are told apart by
  // where they sit as well as their designation.
  const recipientGroups = useMemo(() => {
    const byDepartment = new Map<string, LeadHandoverRecipient[]>();
    for (const r of recipients || []) {
      if (r.self) continue; // pinned to the top of the list on its own, not buried in a department
      const key = r.department || 'Other';
      byDepartment.set(key, [...(byDepartment.get(key) || []), r]);
    }
    return [...byDepartment.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [recipients]);

  // The capturer's own entry. Scanning a card that is yours is at least as
  // common as scanning one for a colleague, and a lead left Unassigned does
  // not appear in anyone's call queue — so this is a first-class choice
  // rather than one name among a hundred in a department group.
  const selfRecipient = recipients?.find((r) => r.self) ?? null;

  const handoverTarget = recipients?.find((r) => r.id === form.handoverToId) ?? null;

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
    setForm(emptyForm());
    setStep(0);
  }

  if (successRecord) {
    const handover = successRecord.handover;
    const keptBySelf = handover?.status === 'kept_by_capturer';
    const handedOver = handover?.status === 'handed_over' || handover?.status === 'already_with_them';
    return (
      <div className={historyStyles.wizardCard}>
        <div className={historyStyles.successPanel}>
          <div className={historyStyles.successIcon}>{successRecord.duplicate ? <RefreshCw size={44} /> : <CheckCircle2 size={44} />}</div>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2NoAccent}`}>
            {successRecord.duplicate ? 'Lead already existed — details merged' : keptBySelf ? 'Lead saved & assigned to you' : handedOver ? 'Lead saved & handed over' : 'Lead saved!'}
          </h2>
          {successRecord.duplicate && (
            <div className={historyStyles.autofillNotice}>
              This contact was already captured{successRecord.duplicateCapturedBy ? ` by ${successRecord.duplicateCapturedBy}` : ''}. We updated the existing record instead of creating a duplicate.
            </div>
          )}
          {handover?.status === 'handed_over' && (
            <div className={historyStyles.autofillNotice}>
              Sent to {handover.toName}. They&apos;ve been emailed and will find it under &ldquo;Assigned To Me&rdquo;.
            </div>
          )}
          {handover?.status === 'kept_by_capturer' && (
            <div className={historyStyles.autofillNotice}>
              It&apos;s yours — you&apos;ll find it under &ldquo;To Call&rdquo; on the Leads list. Ring the contact and record what came of it; only a suitable call becomes a project.
            </div>
          )}
          {handover?.status === 'already_with_them' && (
            <div className={historyStyles.autofillNotice}>This lead is already with {handover.toName}.</div>
          )}
          {handover?.status === 'kept_existing' && (
            <div className={styles.noticeWarn}>This lead is already assigned to {handover.toName}, so it stays with them.</div>
          )}
          {handover?.status === 'failed' && (
            <div className={styles.noticeWarn}>
              Saved, but it couldn&apos;t be handed over to {handover.toName}. It&apos;s waiting as Unassigned for a sales manager to route.
            </div>
          )}
          <div className={calcStyles.small}>
            {successRecord.name || successRecord.company}
            {successRecord.priority && (
              <span className={`${historyStyles.priorityBadge} ${successRecord.priority === 'hot' ? historyStyles.priorityBadgeHot : successRecord.priority === 'warm' ? historyStyles.priorityBadgeWarm : historyStyles.priorityBadgeCool} ${styles.ml8}`}>
                {successRecord.priority.toUpperCase()}
              </span>
            )}
          </div>
          <div className={historyStyles.successActions}>
            <button type="button" className={historyStyles.bigBtn} onClick={handleCaptureNext}>Scan Next Lead</button>
            <button type="button" className={historyStyles.bigBtnGhost} onClick={onViewAllLeads}>View All Leads</button>
            {/* No "Convert to Project" here any more: a lead becomes a project
                only after someone calls it and marks the outcome suitable
                (lib/leadCall.ts), so this button would be refused every time.
                A card just scanned has nobody assigned and no call yet. */}
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
            <h2 className={historyStyles.wizardCardTitle}><Camera size={22} /> Capture the Lead</h2>
            <div className={historyStyles.wizardCardHint}>Scan a business card and we&apos;ll read the details automatically — or enter them by hand.</div>

            {scanning ? (
              <div className={historyStyles.scanProgress}>
                <div className={historyStyles.scanSpinner} />
                <div className={historyStyles.scanProgressPct}>{scanProgress}%</div>
                <div className={historyStyles.scanProgressText}>{scanNote}</div>
              </div>
            ) : (
              <div className={historyStyles.captureChoices}>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className={styles.hiddenInput} onChange={(e) => handleImageSelected(e.target.files?.[0])} />
                <input ref={galleryInputRef} type="file" accept="image/*" className={styles.hiddenInput} onChange={(e) => handleImageSelected(e.target.files?.[0])} />

                <button type="button" className={historyStyles.captureCard} onClick={() => cameraInputRef.current?.click()}>
                  <div className={historyStyles.captureCardIcon}><Camera size={26} /></div>
                  <div>
                    <div className={historyStyles.captureCardTitle}>Scan Business Card</div>
                    <div className={historyStyles.captureCardSub}>Opens your camera — take a photo and we&apos;ll read the details instantly</div>
                  </div>
                </button>

                <button type="button" className={`${historyStyles.captureCard} ${historyStyles.captureCardGhost}`} onClick={() => galleryInputRef.current?.click()}>
                  <div className={historyStyles.captureCardIcon}><Images size={26} /></div>
                  <div>
                    <div className={historyStyles.captureCardTitle}>Upload from Gallery</div>
                    <div className={historyStyles.captureCardSub}>Pick an existing photo of a business card</div>
                  </div>
                </button>

                <button type="button" className={`${historyStyles.captureCard} ${historyStyles.captureCardGhost}`} onClick={manualEntry}>
                  <div className={historyStyles.captureCardIcon}><PenLine size={26} /></div>
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
            <h2 className={historyStyles.wizardCardTitle}><User size={22} /> Confirm Details</h2>
            <div className={historyStyles.wizardCardHint}>{scanNote || 'Correct anything the scan got wrong — every field is editable.'}</div>
            {form.cardImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.cardImageUrl} alt="Business card" className={styles.cardPreviewImg} />
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
                <PhoneInput value={form.mobile} onChange={(v) => setForm((f) => ({ ...f, mobile: v }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Alternate Mobile (optional)</label>
                <PhoneInput value={form.altMobile} onChange={(v) => setForm((f) => ({ ...f, altMobile: v }))} />
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

            <div className={styles.handover}>
              <label htmlFor="lead-handover" className={styles.handoverTitle}><Send size={16} /> Whose lead is this?</label>
              <p className={styles.handoverHint}>
                {recipientsFailed
                  ? 'Couldn’t load your colleagues right now — this lead will be saved as Unassigned.'
                  : 'Keep it yourself, or pick the colleague it belongs to and it goes straight to their list with an email.'}
              </p>
              <Select
                id="lead-handover"
                value={form.handoverToId}
                disabled={!recipients}
                onChange={(e) => setForm((f) => ({ ...f, handoverToId: e.target.value }))}
              >
                <option value="">{recipients || recipientsFailed ? 'Unassigned — a sales manager will route it' : 'Loading colleagues…'}</option>
                {selfRecipient && (
                  <optgroup label="Keep it">
                    <option value={selfRecipient.id}>Assign to me — {selfRecipient.name}</option>
                  </optgroup>
                )}
                {recipientGroups.map(([department, people]) => (
                  <optgroup key={department} label={department}>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.designation ? ` — ${p.designation}` : ''}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              {handoverTarget && (
                <span className={styles.handoverTarget}>
                  <UserCheck size={15} />
                  {handoverTarget.self
                    ? <span>Stays with <strong>you</strong> · it&apos;ll be in your &ldquo;To Call&rdquo; list, no email sent</span>
                    : <span>Goes to <strong>{handoverTarget.name}</strong> · they&apos;ll be emailed when you save</span>}
                </span>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><Target size={22} /> Area of Interest</h2>
            <div className={historyStyles.wizardCardHint}>What is this contact interested in? Select all that apply.</div>
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}
            <div className={historyStyles.tagGrid}>
              {LEAD_DOMAIN_TILES.map((t) => (
                <div
                  key={t.key}
                  className={`${historyStyles.tagTile} ${form.interests.includes(t.key) ? historyStyles.tagTileActive : ''}`}
                  onClick={() => toggleInterest(t.key)}
                >
                  <span className={historyStyles.tagTileEmoji}><t.icon size={22} /></span>
                  <div className={historyStyles.tagTileName}>{t.label}</div>
                  <div className={historyStyles.tagTileHint}>{t.hint}</div>
                </div>
              ))}
            </div>
            {form.interests.map((domain) => {
              const options = LEAD_SUB_INTERESTS[domain];
              if (!options) return null;
              const tile = LEAD_DOMAIN_TILES.find((t) => t.key === domain);
              const TileIcon = tile?.icon;
              return (
                <div key={domain} className={calcStyles.mt14}>
                  <div className={`${calcStyles.label} ${calcStyles.inlineFlexGap6}`}>
                    {TileIcon && <TileIcon size={14} />} Which {tile?.label.toLowerCase()}?
                  </div>
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
            <h2 className={historyStyles.wizardCardTitle}><Flame size={22} /> Priority &amp; Follow-up</h2>
            <div className={historyStyles.wizardCardHint}>How hot is this lead, and what&apos;s the next action?</div>
            {errors.length > 0 && <div className={historyStyles.loginError}>{errors[0]}</div>}
            <div className={historyStyles.stageOptions}>
              {(['hot', 'warm', 'cool'] as const).map((p) => {
                const meta = LEAD_PRIORITY_META[p];
                const Icon = meta.icon;
                return (
                  <div
                    key={p}
                    className={`${historyStyles.stageOption} ${form.priority === p ? historyStyles.stageOptionActive : ''}`}
                    onClick={() => setForm((f) => ({ ...f, priority: p }))}
                  >
                    <strong className={styles.inlineFlexGapInline6}><Icon size={16} /> {meta.label}</strong>
                    <span>{meta.hint}</span>
                  </div>
                );
              })}
            </div>

            <div className={`${calcStyles.label} ${styles.mt16}`}>Follow-up action</div>
            <div className={historyStyles.chipGrid}>
              {LEAD_FOLLOW_UP_ACTIONS.map((a) => (
                <div
                  key={a.tag}
                  className={`${historyStyles.chipBtn} ${form.followUpActions.includes(a.tag) ? historyStyles.chipBtnActive : ''}`}
                  onClick={() => toggleFollowUp(a.tag)}
                >
                  <span className={historyStyles.chipEmoji}><a.icon size={16} /></span>
                  <span className={historyStyles.chipLabel}>{a.tag}</span>
                </div>
              ))}
            </div>

            <div className={`${calcStyles.label} ${styles.mt16}`}>Budget range</div>
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
            <h2 className={historyStyles.wizardCardTitle}><StickyNote size={22} /> Notes</h2>
            <div className={historyStyles.wizardCardHint}>Specific requirement, product discussed, timeline, competitor mentioned…</div>
            <div className={calcStyles.field}>
              <textarea className={calcStyles.formControl} rows={5} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className={historyStyles.wizardCardTitle}><CheckCircle2 size={22} /> Review &amp; Submit</h2>
            <div className={historyStyles.wizardCardHint}>Double-check the details below, then save.</div>
            <div className={historyStyles.reviewGrid}>
              <div className={historyStyles.reviewRow}><strong>Name:</strong> {form.name || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Designation:</strong> {form.designation || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Company:</strong> {form.company || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Mobile:</strong> {form.mobile || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Alternate Mobile:</strong> {form.altMobile || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Email:</strong> {form.email || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>City:</strong> {form.city || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Interests:</strong> {form.interests.join(', ') || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Specifics:</strong> {form.subInterests.join(', ') || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Priority:</strong> {form.priority ? LEAD_PRIORITY_META[form.priority].label : '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Follow-up:</strong> {form.followUpActions.join(', ') || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Budget:</strong> {form.budget || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Notes:</strong> {form.notes || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Handed over to:</strong> {handoverTarget ? handoverTarget.name : 'Unassigned'}</div>
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
                {creating ? 'Saving…' : 'Save Lead & Next Person'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
