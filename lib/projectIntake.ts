// Parsing and validation for the New Project intake fields, shared by the
// create route and the PATCH route so a value can never be accepted one way
// and rejected the other.
//
// Two of these blocks are conditional on the project's Source:
//   'Referral'      -> referralName is required (a referral nobody can name is
//                      not a referral anyone can follow up)
//   'GeM / Tender'  -> the tender block is offered; only the reference number
//                      is required, because the rest of a tender's terms are
//                      often unknown when the opportunity is first logged.
// Anything else clears both blocks, so a source changed later cannot leave
// stale tender terms attached to an unrelated deal.

import { isKnownState, OTHER_LOCATION } from './indiaLocations';

export const REFERRAL_SOURCE = 'Referral';
export const TENDER_SOURCE = 'GeM / Tender';

export interface ProjectIntakeInput {
  projectName?: unknown;
  state?: unknown;
  city?: unknown;
  referralName?: unknown;
  tenderCapex?: unknown;
  tenderOpex?: unknown;
  tenderRefNumber?: unknown;
  tenderName?: unknown;
  tenderDeadline?: unknown;
  tenderEstimatedValue?: unknown;
  tenderPbg?: unknown;
  tenderEmd?: unknown;
  paymentTerms?: unknown;
}

export interface ProjectIntakeFields {
  project_name: string;
  state: string;
  city: string;
  referral_name: string;
  tender_capex: number | '';
  tender_opex: number | '';
  tender_ref_number: string;
  tender_name: string;
  tender_deadline: string;
  tender_estimated_value: number | '';
  tender_pbg: string;
  tender_emd: number | '';
  payment_terms: string;
}

const text = (value: unknown, max = 255): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// '' for blank, undefined for "given but not a usable amount" — so a typo is
// rejected rather than silently stored as zero.
function money(value: unknown): number | '' | undefined {
  if (value === '' || value === null || value === undefined) return '';
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN;
  if (!Number.isFinite(num) || num < 0) return undefined;
  return num;
}

export class ProjectIntakeError extends Error {}

export function parseProjectIntake(body: ProjectIntakeInput, source: string): ProjectIntakeFields {
  const state = text(body.state, 120);
  if (state && !isKnownState(state)) {
    throw new ProjectIntakeError('Pick a state from the list, or choose Other.');
  }
  // A city is free text when the state is Other (or the city itself was
  // Other), which is what lets an international address through at all.
  const city = text(body.city, 120);

  const isReferral = source === REFERRAL_SOURCE;
  const isTender = source === TENDER_SOURCE;

  const referralName = text(body.referralName);
  if (isReferral && !referralName) {
    throw new ProjectIntakeError('Who referred this? Please enter the referral name.');
  }

  const amounts: Record<string, number | '' | undefined> = {
    tender_capex: money(body.tenderCapex),
    tender_opex: money(body.tenderOpex),
    tender_estimated_value: money(body.tenderEstimatedValue),
    tender_emd: money(body.tenderEmd)
  };
  const labels: Record<string, string> = {
    tender_capex: 'CapEx',
    tender_opex: 'OpEx',
    tender_estimated_value: 'Tender estimated value',
    tender_emd: 'EMD'
  };
  for (const [key, value] of Object.entries(amounts)) {
    if (value === undefined) throw new ProjectIntakeError(`${labels[key]} must be an amount in rupees, or left blank.`);
  }

  const tenderRefNumber = text(body.tenderRefNumber, 120);
  if (isTender && !tenderRefNumber) {
    throw new ProjectIntakeError('A tender reference number is required for a GeM / Tender project.');
  }

  const deadline = text(body.tenderDeadline, 32);
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    throw new ProjectIntakeError('The tender deadline must be a date.');
  }

  return {
    project_name: text(body.projectName),
    state,
    city,
    // Cleared unless the source actually calls for them, so changing a
    // project's source does not leave contradictory details behind.
    referral_name: isReferral ? referralName : '',
    tender_capex: isTender ? (amounts.tender_capex as number | '') : '',
    tender_opex: isTender ? (amounts.tender_opex as number | '') : '',
    tender_ref_number: isTender ? tenderRefNumber : '',
    tender_name: isTender ? text(body.tenderName) : '',
    tender_deadline: isTender ? deadline : '',
    tender_estimated_value: isTender ? (amounts.tender_estimated_value as number | '') : '',
    tender_pbg: isTender ? text(body.tenderPbg) : '',
    tender_emd: isTender ? (amounts.tender_emd as number | '') : '',
    payment_terms: isTender ? text(body.paymentTerms, 2000) : ''
  };
}

// Every intake field blank — for a project created by automation rather than
// the form (lib/leadProjectAutomation.ts), where none of this is known.
export function emptyProjectIntake(): ProjectIntakeFields {
  return parseProjectIntake({}, '');
}

export { OTHER_LOCATION };
