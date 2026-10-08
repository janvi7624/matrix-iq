'use client';

import calcStyles from '../calculator.module.css';
import { INDIA_STATES, OTHER_LOCATION, citiesForState } from '@/lib/indiaLocations';
import { REFERRAL_SOURCE, TENDER_SOURCE } from '@/lib/projectIntake';

// The intake half of the New Project form: what the deal is called, where the
// client is, and the two blocks that only apply to certain sources.
//
// Shared by the Projects page form and the quick-create dialog rather than
// written twice. That is not only about duplication: the server rejects a
// Referral with no referral name and a GeM / Tender with no reference number,
// so a form that offered those sources without these fields could not be
// submitted at all.

export interface ProjectIntakeValues {
  projectName: string;
  state: string;
  city: string;
  referralName: string;
  tenderCapex: string;
  tenderOpex: string;
  tenderRefNumber: string;
  tenderName: string;
  tenderDeadline: string;
  tenderEstimatedValue: string;
  tenderPbg: string;
  tenderEmd: string;
  paymentTerms: string;
}

export const EMPTY_PROJECT_INTAKE: ProjectIntakeValues = {
  projectName: '', state: '', city: '', referralName: '',
  tenderCapex: '', tenderOpex: '', tenderRefNumber: '', tenderName: '',
  tenderDeadline: '', tenderEstimatedValue: '', tenderPbg: '', tenderEmd: '', paymentTerms: ''
};

interface Props {
  values: ProjectIntakeValues;
  onChange: (patch: Partial<ProjectIntakeValues>) => void;
  /** The project's Source — decides which conditional blocks appear. */
  source: string;
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={calcStyles.field}>
      <label className={calcStyles.label}>{label}</label>
      {children}
      {hint && <span className={calcStyles.small}>{hint}</span>}
    </div>
  );
}

interface LocationProps {
  values: Pick<ProjectIntakeValues, 'projectName' | 'state' | 'city'>;
  onChange: (patch: Partial<ProjectIntakeValues>) => void;
}

// What the deal is called and where the client is — placed right after
// Address in both forms (components/ProjectsView.tsx,
// components/ui/ProjectQuickCreateDialog.tsx), since that's where it reads
// naturally. Split out from the source-conditional fields below (Referral /
// Tender), which stay next to the Source field they depend on instead.
export function ProjectLocationFields({ values, onChange }: LocationProps) {
  // "Other" state means nowhere in the list — including outside India — so the
  // city becomes free text rather than a dropdown with nothing useful in it.
  const cityOptions = citiesForState(values.state);
  const cityIsFreeText = values.state === OTHER_LOCATION || values.city === OTHER_LOCATION;

  return (
    <div className={`${calcStyles.row} ${calcStyles.columns}`}>
      <Labelled label="Project Name" hint="e.g. MeetIQ - Adani">
        <input
          className={calcStyles.formControl}
          placeholder="e.g. MeetIQ - Adani"
          value={values.projectName}
          onChange={(e) => onChange({ projectName: e.target.value })}
        />
      </Labelled>

      <Labelled label="State">
        <select
          className={calcStyles.formControl}
          value={values.state}
          // Changing state clears the city: a city from the previous state
          // would otherwise stay selected and be quietly wrong.
          onChange={(e) => onChange({ state: e.target.value, city: '' })}
        >
          <option value="">— Select state —</option>
          {INDIA_STATES.map((s) => (
            <option key={s} value={s}>{s === OTHER_LOCATION ? 'Other / Outside India' : s}</option>
          ))}
        </select>
      </Labelled>

      <Labelled label="City" hint={cityIsFreeText ? 'Type the city — anywhere, including outside India.' : undefined}>
        {cityIsFreeText ? (
          <input
            className={calcStyles.formControl}
            placeholder="City"
            value={values.city === OTHER_LOCATION ? '' : values.city}
            onChange={(e) => onChange({ city: e.target.value })}
          />
        ) : (
          <select
            className={calcStyles.formControl}
            value={values.city}
            disabled={!values.state}
            onChange={(e) => onChange({ city: e.target.value })}
          >
            <option value="">{values.state ? '— Select city —' : 'Pick a state first'}</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>{c === OTHER_LOCATION ? 'Other (type it)' : c}</option>
            ))}
          </select>
        )}
      </Labelled>
    </div>
  );
}

// The Referral / Tender blocks — only these two depend on Source, so only
// these two still live next to it. ProjectLocationFields above is the
// Project Name / State / City half, placed next to Address instead.
export default function ProjectIntakeFields({ values, onChange, source }: Props) {
  const isReferral = source === REFERRAL_SOURCE;
  const isTender = source === TENDER_SOURCE;

  return (
    <>
      {isReferral && (
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <Labelled label="Referred by *" hint="Who referred this client — so the referral can be credited and followed up.">
            <input
              className={calcStyles.formControl}
              required
              placeholder="Name of the person who referred"
              value={values.referralName}
              onChange={(e) => onChange({ referralName: e.target.value })}
            />
          </Labelled>
        </div>
      )}

      {isTender && (
        <>
          <div className={calcStyles.sectionTitle ?? ''} style={{ marginTop: 8, fontWeight: 600 }}>Tender details</div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <Labelled label="Tender Ref Number *">
              <input className={calcStyles.formControl} required value={values.tenderRefNumber} onChange={(e) => onChange({ tenderRefNumber: e.target.value })} />
            </Labelled>
            <Labelled label="Tender Name">
              <input className={calcStyles.formControl} value={values.tenderName} onChange={(e) => onChange({ tenderName: e.target.value })} />
            </Labelled>
            <Labelled label="Deadline">
              <input type="date" className={calcStyles.formControl} value={values.tenderDeadline} onChange={(e) => onChange({ tenderDeadline: e.target.value })} />
            </Labelled>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <Labelled label="CapEx (₹)">
              <input type="text" inputMode="decimal" className={calcStyles.formControl} placeholder="e.g. 1500000" value={values.tenderCapex} onChange={(e) => onChange({ tenderCapex: e.target.value })} />
            </Labelled>
            <Labelled label="OpEx (₹)">
              <input type="text" inputMode="decimal" className={calcStyles.formControl} placeholder="e.g. 250000" value={values.tenderOpex} onChange={(e) => onChange({ tenderOpex: e.target.value })} />
            </Labelled>
            <Labelled label="Tender Estimated Value (₹)">
              <input type="text" inputMode="decimal" className={calcStyles.formControl} value={values.tenderEstimatedValue} onChange={(e) => onChange({ tenderEstimatedValue: e.target.value })} />
            </Labelled>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <Labelled label="EMD (₹)" hint="Earnest Money Deposit.">
              <input type="text" inputMode="decimal" className={calcStyles.formControl} value={values.tenderEmd} onChange={(e) => onChange({ tenderEmd: e.target.value })} />
            </Labelled>
            <Labelled label="PBG" hint="Performance Bank Guarantee, e.g. 10% for 3 years.">
              <input className={calcStyles.formControl} placeholder="e.g. 10% for 3 years" value={values.tenderPbg} onChange={(e) => onChange({ tenderPbg: e.target.value })} />
            </Labelled>
          </div>
          <Labelled label="Payment Terms">
            <textarea className={calcStyles.formControl} rows={2} value={values.paymentTerms} onChange={(e) => onChange({ paymentTerms: e.target.value })} />
          </Labelled>
        </>
      )}
    </>
  );
}
