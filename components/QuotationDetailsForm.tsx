'use client';

import { QuotationDetails } from '@/lib/types';
import styles from './calculator.module.css';

interface QuotationDetailsFormProps {
  details: QuotationDetails;
  onChange: (patch: Partial<QuotationDetails>) => void;
}

export default function QuotationDetailsForm({ details, onChange }: QuotationDetailsFormProps) {
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
            <label className={styles.label} htmlFor="preparedBy">Prepared by</label>
            <input id="preparedBy" className={`${styles.formControl} ${styles.formControlLocked}`} type="text" value={details.preparedBy} readOnly tabIndex={-1} />
            <span className={styles.lockedHint}>Your logged-in name.</span>
          </div>
        </div>
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="preparedByPhone">Mobile Number</label>
            <input id="preparedByPhone" className={`${styles.formControl} ${styles.formControlLocked}`} type="tel" value={details.preparedByPhone} readOnly tabIndex={-1} />
            <span className={styles.lockedHint}>From your account.</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="preparedByEmail">Email ID</label>
            <input id="preparedByEmail" className={`${styles.formControl} ${styles.formControlLocked}`} type="email" value={details.preparedByEmail} readOnly tabIndex={-1} />
            <span className={styles.lockedHint}>From your account.</span>
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
            <input id="clientPhone" className={styles.formControl} type="tel" value={details.clientPhone} onChange={(e) => onChange({ clientPhone: e.target.value })} />
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
              onChange={(e) => onChange({ validityDays: Math.max(1, parseInt(e.target.value, 10) || 1) })}
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
