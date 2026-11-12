'use client';

import calcStyles from '../calculator.module.css';
import { INDIA_STATES, OTHER_LOCATION, citiesForState } from '@/lib/indiaLocations';

// The State + City pair, as one control.
//
// Extracted from components/ui/ProjectIntakeFields.tsx so New Project and Add
// Partner offer the identical pair of dropdowns rather than two forms that
// drift apart — the same list, the same "changing state clears the city" rule,
// and the same Other-means-free-text escape hatch. Both are places where a
// mistyped city quietly splits one city into three in every report that groups
// by it, which is the reason these are dropdowns at all.
//
// Renders two fields and no wrapper, so the caller decides the row it sits in.

interface Props {
  state: string;
  city: string;
  /** Receives both keys together when the state changes, so the city clears. */
  onChange: (patch: { state?: string; city?: string }) => void;
  /** Makes the ids unique when two of these appear on one page. */
  idPrefix: string;
  /** Marks both labels required. The fields are never enforced here. */
  required?: boolean;
}

export default function StateCitySelect({ state, city, onChange, idPrefix, required = false }: Props) {
  // "Other" state means nowhere in the list — including outside India — so the
  // city becomes free text rather than a dropdown with nothing useful in it.
  //
  // A value already saved as free text — anything typed before these were
  // dropdowns, or recorded by an import — is kept as its own option. Without
  // that, editing an existing record would show an empty select and saving
  // the form would silently erase a city nobody meant to touch.
  const stateOptions = state && !INDIA_STATES.includes(state) ? [state, ...INDIA_STATES] : INDIA_STATES;
  const known = citiesForState(state);
  const cityIsFreeText = state === OTHER_LOCATION || city === OTHER_LOCATION;
  const cityOptions = city && !known.includes(city) ? [city, ...known] : known;
  const star = required ? ' *' : '';

  return (
    <>
      <div className={calcStyles.field}>
        <label className={calcStyles.label} htmlFor={`${idPrefix}State`}>{`State${star}`}</label>
        <select
          id={`${idPrefix}State`}
          className={calcStyles.formControl}
          value={state}
          required={required}
          // Changing state clears the city: a city from the previous state
          // would otherwise stay selected and be quietly wrong.
          onChange={(e) => onChange({ state: e.target.value, city: '' })}
        >
          <option value="">— Select state —</option>
          {stateOptions.map((s) => (
            <option key={s} value={s}>{s === OTHER_LOCATION ? 'Other / Outside India' : s}</option>
          ))}
        </select>
      </div>

      <div className={calcStyles.field}>
        <label className={calcStyles.label} htmlFor={`${idPrefix}City`}>{`City${star}`}</label>
        {cityIsFreeText ? (
          <input
            id={`${idPrefix}City`}
            className={calcStyles.formControl}
            placeholder="City"
            required={required}
            value={city === OTHER_LOCATION ? '' : city}
            onChange={(e) => onChange({ city: e.target.value })}
          />
        ) : (
          <select
            id={`${idPrefix}City`}
            className={calcStyles.formControl}
            value={city}
            required={required}
            disabled={!state}
            onChange={(e) => onChange({ city: e.target.value })}
          >
            <option value="">{state ? '— Select city —' : 'Pick a state first'}</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>{c === OTHER_LOCATION ? 'Other (type it)' : c}</option>
            ))}
          </select>
        )}
        {cityIsFreeText && <span className={calcStyles.small}>Type the city — anywhere, including outside India.</span>}
      </div>
    </>
  );
}
