'use client';

import { MODE_OF_TRAVEL_OPTIONS, PURPOSE_OPTIONS, isKnownPurpose } from '@/lib/travelOptions';
import { TravelCoTraveller } from '@/lib/types';
import calcStyles from './calculator.module.css';

// Flat slice of a host form's state that this shared block owns — both
// components/TravelScheduleView.tsx's create form and
// components/TravelScheduleDetailView.tsx's edit form add these same keys
// to their own local form-state object and pass a slice/patch-setter pair
// in, so there's exactly one implementation of Mode of Travel, Purpose
// (dropdown + Others-freeform), Co-Travellers, Hotel Accommodation, and
// Advance Request instead of two independently-maintained copies.
export interface TravelExtraFieldsValue {
  purpose: string;
  purposeOther: string;
  modeOfTravel: string;
  coTravellers: TravelCoTraveller[];
  hotelRequired: boolean;
  hotelPreferredArea: string;
  hotelSuggestedHotel: string;
  hotelLocation: string;
  hotelCheckInDate: string;
  hotelCheckOutDate: string;
  hotelGuests: string;
  hotelAdditionalRequirement: string;
  advanceRequired: boolean;
  advanceAmount: string;
  advanceRemark: string;
}

export const EMPTY_TRAVEL_EXTRA_FIELDS: TravelExtraFieldsValue = {
  purpose: '',
  purposeOther: '',
  modeOfTravel: '',
  coTravellers: [],
  hotelRequired: false,
  hotelPreferredArea: '',
  hotelSuggestedHotel: '',
  hotelLocation: '',
  hotelCheckInDate: '',
  hotelCheckOutDate: '',
  hotelGuests: '',
  hotelAdditionalRequirement: '',
  advanceRequired: false,
  advanceAmount: '',
  advanceRemark: ''
};

const EMPTY_CO_TRAVELLER: TravelCoTraveller = { name: '', contact: '', origin: '', destination: '', travelDate: '' };

function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const inTime = new Date(checkIn).getTime();
  const outTime = new Date(checkOut).getTime();
  if (Number.isNaN(inTime) || Number.isNaN(outTime) || outTime <= inTime) return 0;
  return Math.round((outTime - inTime) / (24 * 60 * 60 * 1000));
}

interface TravelScheduleFormProps {
  value: TravelExtraFieldsValue;
  onChange: (patch: Partial<TravelExtraFieldsValue>) => void;
  // The requester's own trip details, for the co-traveller "Same as Above" prefill.
  requesterOrigin: string;
  requesterDestination: string;
  requesterTravelDate: string;
}

export default function TravelScheduleForm({ value, onChange, requesterOrigin, requesterDestination, requesterTravelDate }: TravelScheduleFormProps) {
  const purposeIsKnown = isKnownPurpose(value.purpose);
  const showSpecifyPurpose = value.purpose === 'Others' || (value.purpose !== '' && !purposeIsKnown);

  function updateCoTraveller(index: number, patch: Partial<TravelCoTraveller>) {
    const next = value.coTravellers.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange({ coTravellers: next });
  }

  function addCoTraveller() {
    onChange({ coTravellers: [...value.coTravellers, { ...EMPTY_CO_TRAVELLER }] });
  }

  function removeCoTraveller(index: number) {
    onChange({ coTravellers: value.coTravellers.filter((_, i) => i !== index) });
  }

  function applySameAsAbove(index: number, checked: boolean) {
    if (!checked) return;
    updateCoTraveller(index, { origin: requesterOrigin, destination: requesterDestination, travelDate: requesterTravelDate });
  }

  const nights = nightsBetween(value.hotelCheckInDate, value.hotelCheckOutDate);

  return (
    <>
      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Mode of Travel</label>
          <select className={calcStyles.formControl} value={value.modeOfTravel} onChange={(e) => onChange({ modeOfTravel: e.target.value })}>
            <option value="">— Select mode —</option>
            {MODE_OF_TRAVEL_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Purpose of Travel</label>
          <select
            className={calcStyles.formControl}
            value={purposeIsKnown ? value.purpose : value.purpose ? 'Others' : ''}
            onChange={(e) => onChange({ purpose: e.target.value })}
          >
            <option value="">— Select purpose —</option>
            {PURPOSE_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>
      {showSpecifyPurpose && (
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Specify Purpose *</label>
          <input
            className={calcStyles.formControl}
            value={value.purposeOther || (purposeIsKnown ? '' : value.purpose)}
            onChange={(e) => onChange({ purposeOther: e.target.value })}
            required
          />
        </div>
      )}

      <div className={calcStyles.field} style={{ marginTop: 12 }}>
        <label className={calcStyles.label}>Add Co-Traveller</label>
        {value.coTravellers.map((c, i) => (
          <div key={i} className={calcStyles.sectionPanel} style={{ marginTop: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.85rem' }}>Co-traveller {i + 1}</strong>
              <button type="button" onClick={() => removeCoTraveller(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mx-danger, #dc2626)', fontSize: '0.85rem' }}>
                Remove
              </button>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Name *</label>
                <input className={calcStyles.formControl} value={c.name} onChange={(e) => updateCoTraveller(i, { name: e.target.value })} required />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Contact</label>
                <input className={calcStyles.formControl} value={c.contact} onChange={(e) => updateCoTraveller(i, { contact: e.target.value })} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', margin: '8px 0' }}>
              <input type="checkbox" onChange={(e) => applySameAsAbove(i, e.target.checked)} />
              Same as Above
            </label>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Origin</label>
                <input className={calcStyles.formControl} value={c.origin} onChange={(e) => updateCoTraveller(i, { origin: e.target.value })} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Destination</label>
                <input className={calcStyles.formControl} value={c.destination} onChange={(e) => updateCoTraveller(i, { destination: e.target.value })} />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Travel Date</label>
              <input type="date" className={calcStyles.formControl} value={c.travelDate} onChange={(e) => updateCoTraveller(i, { travelDate: e.target.value })} />
            </div>
          </div>
        ))}
        <button type="button" className={calcStyles.secondaryButton} style={{ marginTop: 8 }} onClick={addCoTraveller}>
          + Add Co-traveller
        </button>
      </div>

      <div className={calcStyles.sectionPanel} style={{ marginTop: 16, padding: 12 }}>
        <h4 className={calcStyles.label} style={{ marginTop: 0, marginBottom: 8, fontSize: '0.9rem' }}>Hotel Accommodation</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', marginBottom: 8 }}>
          <input type="checkbox" checked={value.hotelRequired} onChange={(e) => onChange({ hotelRequired: e.target.checked })} />
          Accommodation Required
        </label>
        {value.hotelRequired && (
          <>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Preferred Area *</label>
                <input className={calcStyles.formControl} value={value.hotelPreferredArea} onChange={(e) => onChange({ hotelPreferredArea: e.target.value })} required />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Suggested Hotel</label>
                <input className={calcStyles.formControl} placeholder="Optional" value={value.hotelSuggestedHotel} onChange={(e) => onChange({ hotelSuggestedHotel: e.target.value })} />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Location</label>
              <input className={calcStyles.formControl} value={value.hotelLocation} onChange={(e) => onChange({ hotelLocation: e.target.value })} />
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Check-in Date *</label>
                <input type="date" className={calcStyles.formControl} value={value.hotelCheckInDate} onChange={(e) => onChange({ hotelCheckInDate: e.target.value })} required />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Check-out Date *</label>
                <input type="date" className={calcStyles.formControl} value={value.hotelCheckOutDate} onChange={(e) => onChange({ hotelCheckOutDate: e.target.value })} required />
              </div>
            </div>
            {nights > 0 && <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: 8 }}>{nights} night{nights === 1 ? '' : 's'}</div>}
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Guests</label>
              <input type="number" min={1} className={calcStyles.formControl} value={value.hotelGuests} onChange={(e) => onChange({ hotelGuests: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Additional Requirement</label>
              <textarea className={calcStyles.formControl} rows={2} placeholder="Optional" value={value.hotelAdditionalRequirement} onChange={(e) => onChange({ hotelAdditionalRequirement: e.target.value })} />
            </div>
          </>
        )}
      </div>

      <div className={calcStyles.sectionPanel} style={{ marginTop: 16, padding: 12 }}>
        <h4 className={calcStyles.label} style={{ marginTop: 0, marginBottom: 8, fontSize: '0.9rem' }}>Advance Request</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', marginBottom: 8 }}>
          <input type="checkbox" checked={value.advanceRequired} onChange={(e) => onChange({ advanceRequired: e.target.checked })} />
          Advance Required
        </label>
        {value.advanceRequired && (
          <>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Requested Amount (₹) *</label>
              <input type="number" min={0} className={calcStyles.formControl} value={value.advanceAmount} onChange={(e) => onChange({ advanceAmount: e.target.value })} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Reason / Remark</label>
              <textarea className={calcStyles.formControl} rows={2} value={value.advanceRemark} onChange={(e) => onChange({ advanceRemark: e.target.value })} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

// Converts the record as loaded from the API into this component's flat
// form-state shape — used by TravelScheduleDetailView.tsx's startEditing().
export function travelExtraFieldsFromRecord(record: {
  purpose: string;
  purpose_other: string;
  mode_of_travel: string;
  co_travellers: TravelCoTraveller[];
  hotel_accommodation: { required: boolean; preferredArea: string; suggestedHotel: string; location: string; checkInDate: string; checkOutDate: string; numberOfGuests: number; additionalRequirement: string } | null;
  advance_request: { required: boolean; requestedAmount: number; remark: string } | null;
}): TravelExtraFieldsValue {
  const hotel = record.hotel_accommodation;
  const advance = record.advance_request;
  return {
    purpose: record.purpose || '',
    purposeOther: record.purpose_other || '',
    modeOfTravel: record.mode_of_travel || '',
    coTravellers: Array.isArray(record.co_travellers) ? record.co_travellers.map((c) => ({ ...c })) : [],
    hotelRequired: hotel?.required || false,
    hotelPreferredArea: hotel?.preferredArea || '',
    hotelSuggestedHotel: hotel?.suggestedHotel || '',
    hotelLocation: hotel?.location || '',
    hotelCheckInDate: hotel?.checkInDate || '',
    hotelCheckOutDate: hotel?.checkOutDate || '',
    hotelGuests: hotel?.numberOfGuests ? String(hotel.numberOfGuests) : '',
    hotelAdditionalRequirement: hotel?.additionalRequirement || '',
    advanceRequired: advance?.required || false,
    advanceAmount: advance?.requestedAmount ? String(advance.requestedAmount) : '',
    advanceRemark: advance?.remark || ''
  };
}

// Converts this component's flat form-state shape into the API's expected
// request-body shape — used by both host forms' submit handlers.
export function travelExtraFieldsToPayload(value: TravelExtraFieldsValue) {
  return {
    purpose: value.purpose,
    purposeOther: value.purposeOther,
    modeOfTravel: value.modeOfTravel,
    coTravellers: value.coTravellers,
    hotelAccommodation: {
      required: value.hotelRequired,
      preferredArea: value.hotelPreferredArea,
      suggestedHotel: value.hotelSuggestedHotel,
      location: value.hotelLocation,
      checkInDate: value.hotelCheckInDate,
      checkOutDate: value.hotelCheckOutDate,
      numberOfGuests: Number(value.hotelGuests) || 0,
      additionalRequirement: value.hotelAdditionalRequirement
    },
    advanceRequest: {
      required: value.advanceRequired,
      requestedAmount: Number(value.advanceAmount) || 0,
      remark: value.advanceRemark
    }
  };
}
