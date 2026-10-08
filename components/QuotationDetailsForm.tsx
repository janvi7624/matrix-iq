'use client';

import { QuotationDetails } from '@/lib/types';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import styles from './calculator.module.css';
import PhoneInput from '@/components/ui/PhoneInput';
import TeamMemberSelect, { TeamMemberOption } from '@/components/ui/TeamMemberSelect';

interface QuotationDetailsFormProps {
  details: QuotationDetails;
  onChange: (patch: Partial<QuotationDetails>) => void;
  // Only Khushi/Maulik get these (see lib/quotationOnBehalfAccess.ts), plus
  // technical staff quoting on a project owned by a sales person (just
  // themselves + that owner) — everyone else keeps the plain locked-to-self
  // fields below exactly as before.
  onBehalfOptions?: TeamMemberOption[];
  // Replaces the picker's default hint — the technical-staff case above needs
  // to explain why Prepared By starts out as someone else.
  onBehalfHint?: string;
}

export default function QuotationDetailsForm({ details, onChange, onBehalfOptions, onBehalfHint }: QuotationDetailsFormProps) {
  const canActOnBehalf = !!onBehalfOptions;
  return (
    <>
      <h2 className={styles.h2}>Quotation Details</h2>
      <div className={styles.sectionPanel}>
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="quotationNumber">Quotation number</label>
            <input
              id="quotationNumber"
              className={`${styles.formControl} ${styles.formControlLocked}`}
              type="text"
              value={details.quotationNumber}
              readOnly
              tabIndex={-1}
            />
            <span className={styles.lockedHint}>Assigned automatically — a new, unique number every time you save.</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="preparedBy">Prepared by {canActOnBehalf && '*'}</label>
            {canActOnBehalf ? (
              <TeamMemberSelect
                options={onBehalfOptions!}
                value={details.preparedByUserId}
                onChange={(opt) => onChange({ preparedByUserId: opt.id, preparedBy: opt.name, preparedByPhone: opt.phone, preparedByEmail: opt.email })}
              />
            ) : (
              <input id="preparedBy" className={`${styles.formControl} ${styles.formControlLocked}`} type="text" value={details.preparedBy} readOnly tabIndex={-1} />
            )}
            <span className={styles.lockedHint}>{canActOnBehalf ? onBehalfHint || 'Search and select the team member this quotation is for.' : 'Your logged-in name.'}</span>
          </div>
        </div>
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="preparedByPhone">Mobile Number</label>
            <input id="preparedByPhone" className={`${styles.formControl} ${styles.formControlLocked}`} type="tel" value={details.preparedByPhone} readOnly tabIndex={-1} />
            <span className={styles.lockedHint}>{canActOnBehalf ? "From the selected team member's profile." : 'From your account.'}</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="preparedByEmail">Email ID</label>
            <input id="preparedByEmail" className={`${styles.formControl} ${styles.formControlLocked}`} type="email" value={details.preparedByEmail} readOnly tabIndex={-1} />
            <span className={styles.lockedHint}>{canActOnBehalf ? "From the selected team member's profile." : 'From your account.'}</span>
          </div>
        </div>
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="clientName">Client Name</label>
            <input id="clientName" className={styles.formControl} type="text" placeholder="Contact person" value={details.clientName} onChange={(e) => onChange({ clientName: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="clientCompany">Client Company</label>
            <input id="clientCompany" className={styles.formControl} type="text" placeholder="Company / organization" value={details.clientCompany} onChange={(e) => onChange({ clientCompany: e.target.value })} />
          </div>
        </div>
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="clientEmail">Client Email</label>
            <input id="clientEmail" className={styles.formControl} type="email" value={details.clientEmail} onChange={(e) => onChange({ clientEmail: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="clientPhone">Client Phone</label>
            <PhoneInput id="clientPhone" value={details.clientPhone} onChange={(v) => onChange({ clientPhone: v })} />
          </div>
        </div>
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="clientAddress">Client Address</label>
            <textarea id="clientAddress" className={styles.formControl} rows={2} value={details.clientAddress} onChange={(e) => onChange({ clientAddress: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="validityDays">Quote valid for (days)</label>
            <input
              id="validityDays"
              className={styles.formControl}
              type="number"
              step={1}
              min={1}
              value={details.validityDays}
              onFocus={selectAllOnFocus}
              onChange={(e) => onChange({ validityDays: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.label}>Included in the quoted price</span>
            <div className={styles.deptPickRow}>
              <button
                type="button"
                role="checkbox"
                aria-checked={details.freightIncluded}
                className={`${styles.deptPickChip} ${details.freightIncluded ? styles.deptPickChipActive : ''}`}
                onClick={() => onChange({ freightIncluded: !details.freightIncluded })}
              >
                <span className={styles.deptPickChipCheck} aria-hidden="true" />
                Freight / transportation
              </button>
              <button
                type="button"
                role="checkbox"
                aria-checked={details.installationIncluded}
                className={`${styles.deptPickChip} ${details.installationIncluded ? styles.deptPickChipActive : ''}`}
                onClick={() => onChange({ installationIncluded: !details.installationIncluded })}
              >
                <span className={styles.deptPickChipCheck} aria-hidden="true" />
                Installation
              </button>
            </div>
            {/* Shows the exact sentence the client will read, so the two
                boxes never have to be mentally combined into one. */}
            <span className={`${styles.small} ${styles.smallTopPad}`}>
              {details.freightIncluded
                ? details.installationIncluded
                  ? 'PDF: freight/transportation and installation charges are included in the quoted price.'
                  : 'PDF: freight/transportation included; installation, if applicable, extra.'
                : details.installationIncluded
                  ? 'PDF: installation included; freight/transportation, if applicable, extra.'
                  : 'PDF: freight/transportation and installation, if applicable, will be extra.'}
            </span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="deliveryPeriod">Delivery Period (optional)</label>
            <input
              id="deliveryPeriod"
              type="text"
              className={styles.formControl}
              placeholder="Standard: 20-25 working days — leave blank to use this"
              value={details.deliveryPeriod}
              onChange={(e) => onChange({ deliveryPeriod: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="warrantyTerms">Warranty Terms (optional)</label>
            <input
              id="warrantyTerms"
              type="text"
              className={styles.formControl}
              placeholder="Standard: guided by OEM warranty terms — leave blank to use this"
              value={details.warrantyTerms}
              onChange={(e) => onChange({ warrantyTerms: e.target.value })}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="customTerms">Additional Terms &amp; Conditions (optional)</label>
            <textarea
              id="customTerms"
              className={styles.formControl}
              rows={3}
              placeholder={'One term per line — added to the PDF after the standard terms.'}
              value={details.customTerms}
              onChange={(e) => onChange({ customTerms: e.target.value })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
