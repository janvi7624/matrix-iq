'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import { useToast } from './ui/ToastProvider';
import {
  MARGIN_MODES, PROPOSAL_KINDS, PROPOSAL_KIND_LABEL,
  ProposalDetails, ProposalKind, formatContractYears, isProposalUploadAllowed,
  proposalExpiryDate, totalContractYears
} from '@/lib/quotationProposal';
import { ProjectRecord } from '@/lib/types';

// The Project / Tender Proposal form — the third quotation mode.
//
// Two rules run through it:
//
//  1. Anything the project already knows is pre-filled from it, so the same
//     detail is not typed twice and cannot disagree between the two records.
//  2. Anything the project does NOT know, but is filled in here, is written
//     back to the project. Deliberately only into EMPTY project fields: a
//     quotation is one bid among several, so it may add missing facts but must
//     never quietly overwrite what the project already states.

interface Props {
  project: ProjectRecord | null;
  value: ProposalDetails;
  onChange: (next: ProposalDetails) => void;
  /** Fields written back to the project — the parent persists them. */
  onFillProject: (patch: Record<string, string | number>) => void;
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className={`${styles.row} ${styles.columns}`}>{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      {children}
      {hint && <span className={styles.small}>{hint}</span>}
    </div>
  );
}

export default function QuotationProposalForm({ project, value, onChange, onFillProject }: Props) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  // Which project we have already pre-filled from, so re-renders don't keep
  // overwriting what the user has since typed.
  const prefilledFor = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<ProposalDetails>) => onChange({ ...value, ...patch });

  // Pull across whatever the project already knows, without touching anything
  // already entered here.
  useEffect(() => {
    if (!project || prefilledFor.current === project.id) return;
    prefilledFor.current = project.id;
    const fromProject: Partial<ProposalDetails> = {};
    const take = (key: keyof ProposalDetails, projectValue: unknown) => {
      const text = projectValue === null || projectValue === undefined ? '' : String(projectValue);
      if (text && !value[key]) (fromProject as Record<string, unknown>)[key] = text;
    };
    take('projectName', project.project_name);
    take('deliveryLocation', [project.city, project.state].filter(Boolean).join(', ') || project.address);
    take('paymentTerms', project.payment_terms);
    take('tenderRefNumber', project.tender_ref_number);
    take('tenderDeadline', project.tender_deadline);
    take('emd', project.tender_emd);
    take('pbg', project.tender_pbg);
    take('estimatedValue', project.tender_estimated_value);
    if (Object.keys(fromProject).length) onChange({ ...value, ...fromProject });
    // Only when the selected project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Push back anything the project is missing. Runs when the field is left, not
  // on every keystroke, so a half-typed value is never what gets stored.
  const fillBack = (projectField: string, current: unknown, entered: string) => {
    const has = current !== null && current !== undefined && String(current).trim() !== '';
    if (!project || has || !entered.trim()) return;
    onFillProject({ [projectField]: entered.trim() });
  };

  const isTender = value.kind === 'tender';
  const contractYears = useMemo(
    () => totalContractYears(value.implementationTime, value.amcTime),
    [value.implementationTime, value.amcTime]
  );
  const expiry = proposalExpiryDate(value.submittedDate, value.expiryDays);

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const problem = isProposalUploadAllowed(file);
      if (problem) { toast.error(problem); return; }
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('folder', 'quotation-proposal');
      for (const file of Array.from(files)) body.append('files', file);
      const response = await fetch('/api/uploads', { method: 'POST', body });
      const data = await response.json().catch(() => null);
      if (!response.ok) { toast.error(data?.error || 'The file could not be uploaded.'); return; }
      if (data?.urls) set({ attachmentUrls: [...value.attachmentUrls, ...data.urls] });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.sectionPanel}>
      <Field label="Proposal type *">
        <div className={historyStyles.modeToggle} role="radiogroup" aria-label="Proposal type">
          {PROPOSAL_KINDS.map((kind: ProposalKind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={value.kind === kind}
              className={`${historyStyles.modeToggleBtn} ${value.kind === kind ? historyStyles.modeToggleBtnActive : ''}`}
              onClick={() => set({ kind })}
            >
              {PROPOSAL_KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </Field>

      {!value.kind && <div className={styles.small}>Choose whether this is a direct project proposal or a tender bid.</div>}

      {value.kind && (
        <>
          <Row>
            <Field label="Project Name" hint={project ? 'From the selected project — edit to correct it.' : undefined}>
              <input className={styles.formControl} value={value.projectName}
                onChange={(e) => set({ projectName: e.target.value })}
                onBlur={() => fillBack('projectName', project?.project_name, value.projectName)} />
            </Field>
            <Field label="Client's Industry">
              <input className={styles.formControl} value={value.clientIndustry} onChange={(e) => set({ clientIndustry: e.target.value })} />
            </Field>
            <Field label="Delivery Location">
              <input className={styles.formControl} value={value.deliveryLocation} onChange={(e) => set({ deliveryLocation: e.target.value })} />
            </Field>
          </Row>

          <Row>
            <Field label="Implementation Time" hint="e.g. 6 months">
              <input className={styles.formControl} value={value.implementationTime} onChange={(e) => set({ implementationTime: e.target.value })} />
            </Field>
            <Field label="AMC / Warranty Time" hint="e.g. 3 years">
              <input className={styles.formControl} value={value.amcTime} onChange={(e) => set({ amcTime: e.target.value })} />
            </Field>
            <Field label="Total Contract" hint="Implementation + AMC, calculated.">
              <input className={styles.formControl} readOnly value={formatContractYears(contractYears)} placeholder="—" />
            </Field>
          </Row>

          {isTender && (
            <>
              <Row>
                <Field label="Tender Ref Number" hint={project?.tender_ref_number ? 'From the project.' : undefined}>
                  <input className={styles.formControl} value={value.tenderRefNumber}
                    onChange={(e) => set({ tenderRefNumber: e.target.value })}
                    onBlur={() => fillBack('tenderRefNumber', project?.tender_ref_number, value.tenderRefNumber)} />
                </Field>
                <Field label="Deadline">
                  <input type="date" className={styles.formControl} value={value.tenderDeadline}
                    onChange={(e) => set({ tenderDeadline: e.target.value })}
                    onBlur={() => fillBack('tenderDeadline', project?.tender_deadline, value.tenderDeadline)} />
                </Field>
                <Field label="Submission Date">
                  <input type="date" className={styles.formControl} value={value.submittedDate} onChange={(e) => set({ submittedDate: e.target.value })} />
                </Field>
              </Row>
              <Row>
                <Field label="EMD (₹)">
                  <input inputMode="decimal" className={styles.formControl} value={value.emd}
                    onChange={(e) => set({ emd: e.target.value })}
                    onBlur={() => fillBack('tenderEmd', project?.tender_emd, value.emd)} />
                </Field>
                <Field label="PBG">
                  <input className={styles.formControl} value={value.pbg}
                    onChange={(e) => set({ pbg: e.target.value })}
                    onBlur={() => fillBack('tenderPbg', project?.tender_pbg, value.pbg)} />
                </Field>
                <Field label="Security Deposit (SD)">
                  <input className={styles.formControl} value={value.securityDeposit} onChange={(e) => set({ securityDeposit: e.target.value })} />
                </Field>
              </Row>
              <Row>
                <Field label="Estimated Value (₹)" hint="The tender's own published estimate.">
                  <input inputMode="decimal" className={styles.formControl} value={value.estimatedValue}
                    onChange={(e) => set({ estimatedValue: e.target.value })}
                    onBlur={() => fillBack('tenderEstimatedValue', project?.tender_estimated_value, value.estimatedValue)} />
                </Field>
              </Row>
            </>
          )}

          {!isTender && (
            <Row>
              <Field label="Quotation Submitted Date">
                <input type="date" className={styles.formControl} value={value.submittedDate} onChange={(e) => set({ submittedDate: e.target.value })} />
              </Field>
              <Field label="Expires after (days)" hint={expiry ? `Expires ${expiry}` : 'Counted from the submitted date.'}>
                <input inputMode="numeric" className={styles.formControl} value={value.expiryDays} onChange={(e) => set({ expiryDays: e.target.value })} />
              </Field>
            </Row>
          )}

          {/* Asked for on both kinds, and the only place this quotation's
              value comes from — there are no line items here to total up. */}
          <Row>
            <Field
              label={isTender ? 'Quote Value (₹) *' : 'Quotation Value (₹) *'}
              hint="The total price in the document you upload. This is the figure the quotation is logged and reported at."
            >
              <input
                inputMode="decimal"
                className={styles.formControl}
                placeholder="e.g. 1250000"
                value={value.quoteValue}
                onChange={(e) => set({ quoteValue: e.target.value })}
              />
              {value.quoteValue.trim() !== '' && !Number.isFinite(Number(value.quoteValue)) && (
                <span className={styles.small} style={{ color: 'var(--mx-danger)' }}>Enter a number, with no commas or ₹ sign.</span>
              )}
            </Field>
          </Row>

          <Row>
            <Field label="Payment Terms">
              <textarea rows={2} className={styles.formControl} value={value.paymentTerms}
                onChange={(e) => set({ paymentTerms: e.target.value })}
                onBlur={() => fillBack('paymentTerms', project?.payment_terms, value.paymentTerms)} />
            </Field>
            <Field label="Other T&C">
              <textarea rows={2} className={styles.formControl} value={value.otherTerms} onChange={(e) => set({ otherTerms: e.target.value })} />
            </Field>
          </Row>

          {/* Internal only — see lib/quotationProposal.ts. Never rendered into
              the document the client receives. */}
          <Row>
            <Field label="Margin" hint="Ours. Never shown on the quotation given to the client.">
              <div className={styles.row}>
                <select className={styles.formControl} style={{ maxWidth: 130 }} value={value.marginMode}
                  onChange={(e) => set({ marginMode: e.target.value as ProposalDetails['marginMode'] })}>
                  {MARGIN_MODES.map((m) => <option key={m} value={m}>{m === 'percent' ? 'Percent %' : 'Amount ₹'}</option>)}
                </select>
                <input inputMode="decimal" className={styles.formControl}
                  placeholder={value.marginMode === 'percent' ? 'e.g. 12' : 'e.g. 150000'}
                  value={value.marginValue} onChange={(e) => set({ marginValue: e.target.value })} />
              </div>
            </Field>
          </Row>

          <Field
            label={isTender ? 'Upload Commercials (PDF or XLSX)' : 'Upload Proposal (PDF or XLSX)'}
            hint="Maximum 100 KB per file."
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.xlsx"
              className={styles.hiddenInput}
              disabled={uploading}
              onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }}
            />
            <div>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? 'Uploading…' : value.attachmentUrls.length ? '+ Add Another File' : '+ Choose File to Upload'}
              </button>
            </div>
            {value.attachmentUrls.length > 0 && (
              <ul className={styles.small}>
                {value.attachmentUrls.map((url, i) => (
                  <li key={url}>
                    {decodeURIComponent(url.split('/').pop() || url)}{' '}
                    <button type="button" onClick={() => set({ attachmentUrls: value.attachmentUrls.filter((_, j) => j !== i) })}>remove</button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </>
      )}
    </div>
  );
}
