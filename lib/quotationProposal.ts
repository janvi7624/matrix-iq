// Project / Tender Proposal — the third way of making a quotation, alongside
// the Standard and Custom estimators (components/QuotationCalculator.tsx's
// quotationMode). Those two build a price from line items; a Proposal records
// the commercial terms of a bid instead, and carries the prepared commercial
// document as an attachment.
//
// Two shapes behind one choice:
//   'project'  a proposal against a project we are pitching directly
//   'tender'   a bid into a tender, which adds the tender's own instruments
//              (EMD, PBG, SD) and its deadline
//
// Kept dependency-free so the form component can import it directly.

export const PROPOSAL_KINDS = ['project', 'tender'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_KIND_LABEL: Record<ProposalKind, string> = {
  project: 'Project Proposal',
  tender: 'Tender Proposal'
};

// Margin is deliberately excluded from the generated/attached document — it is
// what we add, not what the client is told. Either form can be used, and which
// one was chosen is stored so the figure is never reinterpreted later as the
// other kind.
export const MARGIN_MODES = ['percent', 'amount'] as const;
export type MarginMode = (typeof MARGIN_MODES)[number];

// The uploaded commercial. 100 KB is a deliberate, explicit choice — it will
// refuse most PDF quotations, which is understood and intended.
export const PROPOSAL_UPLOAD_MAX_BYTES = 100 * 1024;
export const PROPOSAL_UPLOAD_EXTENSIONS = ['.pdf', '.xlsx'] as const;
export const PROPOSAL_UPLOAD_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
];

export interface ProposalDetails {
  kind: ProposalKind | '';

  // Shared by both kinds.
  projectName: string;
  clientIndustry: string;
  paymentTerms: string;
  deliveryLocation: string;
  implementationTime: string;
  amcTime: string;
  otherTerms: string;
  submittedDate: string;
  /** Days after submittedDate that the quote lapses; expiry is derived, never stored twice. */
  expiryDays: string;
  marginMode: MarginMode;
  marginValue: string;
  /** Storage keys of the uploaded commercial(s) — see lib/fileStorage.ts. */
  attachmentUrls: string[];

  // Tender only.
  tenderRefNumber: string;
  tenderDeadline: string;
  emd: string;
  pbg: string;
  securityDeposit: string;
  estimatedValue: string;
  quoteValue: string;
}

export const EMPTY_PROPOSAL: ProposalDetails = {
  kind: '',
  projectName: '', clientIndustry: '', paymentTerms: '', deliveryLocation: '',
  implementationTime: '', amcTime: '', otherTerms: '', submittedDate: '', expiryDays: '',
  marginMode: 'percent', marginValue: '', attachmentUrls: [],
  tenderRefNumber: '', tenderDeadline: '', emd: '', pbg: '', securityDeposit: '',
  estimatedValue: '', quoteValue: ''
};

// Durations are typed freely ("6 months", "1.5 years", "18") because tender
// paperwork is not consistent. This reads a number of YEARS out of whatever
// was written, so the contract length can be totalled; it returns null rather
// than guessing when there is nothing numeric to read.
export function durationToYears(value: string): number | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  const num = Number.parseFloat(text.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num)) return null;
  if (/month/.test(text)) return num / 12;
  if (/day/.test(text)) return num / 365;
  if (/week/.test(text)) return num / 52;
  // Bare numbers are read as years, which is how these fields are filled in
  // practice ("3" meaning three years).
  return num;
}

// Total contract length = implementation + AMC, as a decimal number of years.
// null when neither part can be read, so the field can stay blank instead of
// showing a confident 0.
export function totalContractYears(implementationTime: string, amcTime: string): number | null {
  const impl = durationToYears(implementationTime);
  const amc = durationToYears(amcTime);
  if (impl === null && amc === null) return null;
  return Number((((impl ?? 0) + (amc ?? 0))).toFixed(2));
}

export function formatContractYears(years: number | null): string {
  if (years === null) return '';
  return years === 1 ? '1 year' : `${years} years`;
}

// submittedDate + expiryDays, as a plain YYYY-MM-DD. '' when either is
// missing — an expiry with nothing to count from would be meaningless.
export function proposalExpiryDate(submittedDate: string, expiryDays: string): string {
  const days = Number.parseInt(expiryDays, 10);
  if (!submittedDate || !Number.isFinite(days)) return '';
  const date = new Date(`${submittedDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isProposalUploadAllowed(file: { name: string; size: number; type: string }): string {
  const name = file.name.toLowerCase();
  if (!PROPOSAL_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return 'Only PDF or XLSX files can be attached.';
  }
  if (file.size > PROPOSAL_UPLOAD_MAX_BYTES) {
    return `${file.name} is ${(file.size / 1024).toFixed(0)} KB — the limit is 100 KB.`;
  }
  return '';
}
