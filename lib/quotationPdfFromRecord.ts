import { generateQuotationPdf } from './pdf';
import type { PublicAppConfig, QuotationRecord } from './types';

// Re-downloading a quotation that was saved earlier.
//
// The PDF was never stored — components/QuotationCalculator.tsx builds it in
// the browser at save time and hands it straight to the user, so the only way
// to produce it again is to rebuild it from the saved record. Everything the
// document needs IS in that record, which is what makes this faithful rather
// than an approximation:
//   products_json  one entry per product group, each carrying its own line
//                  items (see buildQuotationPayload) — the nested form of the
//                  flat list + offsets the PDF wants
//   subtotal / markup_percent / discount_total / gst_amount / total
//                  every figure in Totals except preGstTotal, which is just
//                  total - gstAmount and so is derived rather than stored twice
//
// A Project/Tender Proposal is the exception: it has no line items because the
// uploaded commercial document IS the quotation, so "download" there means
// handing back that file.

// The saved-products shape and its flattening now live in
// lib/quotationProductGroups.ts — pure, with no dependency on lib/pdf.ts — so
// server code (the partner portal's download payload) can use them without
// pulling jsPDF and browser APIs into the server bundle. Re-exported here so
// every existing caller keeps importing from the same place.
export { parseStoredProductGroups, flattenStoredProductGroups } from './quotationProductGroups';
export type { StoredProductGroup } from './quotationProductGroups';

// Also imported for use below — a re-export alone does not bring the names
// into this module's own scope.
import { flattenStoredProductGroups, parseStoredProductGroups } from './quotationProductGroups';

export function isProposalQuotation(record: Pick<QuotationRecord, 'proposal_kind'>): boolean {
  return record.proposal_kind === 'project' || record.proposal_kind === 'tender';
}

/** The uploaded commercial for a proposal, or '' when nothing was attached. */
export function proposalAttachmentUrl(record: Pick<QuotationRecord, 'proposal'>): string {
  const urls = record.proposal?.attachmentUrls;
  return Array.isArray(urls) && urls.length ? urls[0] : '';
}

// Fetched once per page load rather than per row: it is the same company
// header for every quotation, and a table of twenty would otherwise ask for it
// twenty times. A failure is not fatal — generateQuotationPdf falls back to
// its own built-in company details when no override is passed.
let configPromise: Promise<PublicAppConfig | null> | null = null;

function loadPublicConfig(): Promise<PublicAppConfig | null> {
  if (!configPromise) {
    configPromise = fetch('/api/config/public')
      .then((response) => (response.ok ? (response.json() as Promise<PublicAppConfig>) : null))
      .catch(() => null);
  }
  return configPromise;
}

export type DownloadOutcome = 'pdf' | 'attachment' | 'nothing-to-download';

// One entry point for "give me this quotation again", so the Quotation list
// and anywhere else that offers it cannot drift apart on what a download means
// for each kind.
export async function downloadQuotationFromRecord(record: QuotationRecord): Promise<DownloadOutcome> {
  if (isProposalQuotation(record)) {
    const url = proposalAttachmentUrl(record);
    if (!url) return 'nothing-to-download';
    window.open(url, '_blank', 'noopener,noreferrer');
    return 'attachment';
  }

  const { lineItems, productGroups } = flattenStoredProductGroups(parseStoredProductGroups(record.products_json));
  if (!lineItems.length) return 'nothing-to-download';

  const config = await loadPublicConfig();
  await generateQuotationPdf({
    quotationNumber: record.quotation_number,
    preparedBy: record.prepared_by,
    preparedByPhone: record.prepared_by_phone,
    preparedByEmail: record.prepared_by_email,
    clientCompany: record.client_company,
    clientName: record.client_name,
    clientEmail: record.client_email,
    clientPhone: record.client_phone,
    clientAddress: record.client_address,
    projectVertical: record.project_vertical,
    validityDays: record.validity_days,
    freightIncluded: record.freight_included,
    installationIncluded: record.installation_included,
    deliveryPeriod: record.delivery_period,
    warrantyTerms: record.warranty_terms,
    lineItems,
    productGroups,
    totals: {
      subtotal: record.subtotal,
      markup: record.markup_percent,
      discountTotal: record.discount_total,
      // Never stored: it is total minus tax by definition, and keeping a
      // second copy would only give it somewhere to go stale.
      preGstTotal: record.total - record.gst_amount,
      gstAmount: record.gst_amount,
      total: record.total
    },
    companyOverride: config
      ? {
          legalName: config.companyLegalName,
          addressLines: [config.addressLine1, config.addressLine2, config.addressLine3].filter(Boolean),
          contactEmail: config.contactEmail
        }
      : undefined,
    termsOverride: config?.quotationTerms
  });
  return 'pdf';
}
