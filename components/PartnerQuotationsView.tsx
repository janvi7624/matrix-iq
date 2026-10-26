'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { generateQuotationPdf } from '@/lib/pdf';
import type { LineItem as PdfLineItem, ProductGroup } from '@/lib/types';
import { PartnerRecord } from '@/lib/types';
import PartnerQuotationRequestsPanel from './PartnerQuotationRequestsPanel';
import PartnerShell from './PartnerShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface SharedQuotation {
  id: string;
  quotation_number: string;
  revision_number: number;
  status: string;
  created_at: string;
  validity_days: number;
  total: number;
  subtotal: number;
  gst_amount: number;
  discount_total: number;
  client_company: string;
  shared_at: string;
  note: string;
}

interface LineItem {
  description: string;
  qty: string;
  unit: string;
  rate: number;
  amount: number;
}

// Exactly what the server sends for a download — no markup, no internal ids.
interface PdfPayload {
  quotationNumber: string;
  preparedBy: string;
  preparedByPhone: string;
  preparedByEmail: string;
  clientCompany: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  projectVertical: string;
  validityDays: number;
  freightIncluded: boolean;
  installationIncluded: boolean;
  deliveryPeriod: string;
  warrantyTerms: string;
  // Flattened server-side — see toPdfPayload in lib/partnerQuotationStore.ts.
  lineItems: PdfLineItem[];
  productGroups: ProductGroup[];
  totals: { subtotal: number; markup: number; discountTotal: number; preGstTotal: number; gstAmount: number; total: number };
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Not accepted',
  expired: 'Expired',
  draft: 'Draft'
};

function money(n: number): string {
  return `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function PartnerQuotationsView({ partner }: { partner: PartnerRecord }) {
  const [quotations, setQuotations] = useState<SharedQuotation[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [openId, setOpenId] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [detailError, setDetailError] = useState('');
  const [pdf, setPdf] = useState<PdfPayload | null>(null);
  const [isProposal, setIsProposal] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/partner/quotations');
      if (!response.ok) throw new Error(String(response.status));
      const data: SharedQuotation[] = await response.json();
      setQuotations(data);
      setStatus(data.length ? '' : 'No quotations have been shared with you yet.');
    } catch {
      setStatus('Could not load your quotations. Refresh to try again.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openQuotation(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setDetailError('');
    setOpenId(id);
    setLineItems([]);
    setPdf(null);
    setIsProposal(false);
    try {
      const response = await fetch(`/api/partner/quotations/${id}`);
      if (!response.ok) {
        setDetailError('Could not load this quotation.');
        return;
      }
      const data = await response.json();
      setLineItems(data.line_items || []);
      setPdf(data.pdf ?? null);
      setIsProposal(data.is_proposal === true);
    } catch {
      setDetailError('Could not reach the server.');
    }
  }

  // Built in the browser from the payload the server allow-listed, using the
  // same generator the internal Download button uses — so the partner's copy
  // is byte-for-byte the document our sales team would send.
  async function download() {
    if (!pdf) return;
    setDownloading(true);
    try {
      if (!pdf.lineItems.length) {
        setDetailError('This quotation has no line items to download.');
        return;
      }
      // Same shape the internal download builds (lib/quotationPdfFromRecord.ts).
      // A failure here is not fatal: generateQuotationPdf falls back to its
      // built-in company details.
      const config = await fetch('/api/config/public').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      await generateQuotationPdf({
        quotationNumber: pdf.quotationNumber,
        preparedBy: pdf.preparedBy,
        preparedByPhone: pdf.preparedByPhone,
        preparedByEmail: pdf.preparedByEmail,
        clientCompany: pdf.clientCompany,
        clientName: pdf.clientName,
        clientEmail: pdf.clientEmail,
        clientPhone: pdf.clientPhone,
        clientAddress: pdf.clientAddress,
        projectVertical: pdf.projectVertical,
        validityDays: pdf.validityDays,
        freightIncluded: pdf.freightIncluded,
        installationIncluded: pdf.installationIncluded,
        deliveryPeriod: pdf.deliveryPeriod,
        warrantyTerms: pdf.warrantyTerms,
        lineItems: pdf.lineItems,
        productGroups: pdf.productGroups,
        totals: pdf.totals,
        companyOverride: config
          ? {
              legalName: config.companyLegalName,
              addressLines: [config.addressLine1, config.addressLine2, config.addressLine3].filter(Boolean),
              contactEmail: config.contactEmail
            }
          : undefined,
        termsOverride: config?.quotationTerms
      });
    } catch {
      setDetailError('Could not build the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <PartnerShell
      title="Quotations"
      subtitle="Quotations our team has shared with you"
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      {/* Asks first, documents second: a partner arriving here usually wants
          to chase or raise a request, and the shared list is what they
          already have. */}
      <PartnerQuotationRequestsPanel onQuoted={load} />

      <section className={styles.intro}>
        <h2 className={styles.introTitle}>Shared with you</h2>
        <p className={styles.introSub}>
          These are read-only. Pricing, revisions and approvals are handled by your contact in our sales team — if
          something needs to change, speak to them and a new version will appear here.
        </p>
      </section>

      {status && <div className={historyStyles.status}>{status}</div>}

      {quotations.length > 0 && (
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Quotation</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Total</th>
                <th>Shared</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                // Fragment carries the key: a keyed child inside an unkeyed
                // fragment does not give React a stable identity for the pair,
                // so expanding one row could reconcile onto another.
                <Fragment key={q.id}>
                  <tr>
                    <td>
                      {q.quotation_number}
                      {q.revision_number > 0 && <div className={calcStyles.small}>Revision {q.revision_number}</div>}
                    </td>
                    <td>{q.client_company || '-'}</td>
                    <td><span className={historyStyles.statusPill}>{STATUS_LABEL[q.status] ?? q.status}</span></td>
                    <td>{money(q.total)}</td>
                    <td>{q.shared_at ? new Date(q.shared_at).toLocaleDateString() : '-'}</td>
                    <td>
                      <button type="button" className={historyStyles.button} onClick={() => openQuotation(q.id)}>
                        {openId === q.id ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                  {openId === q.id && (
                    <tr>
                      <td colSpan={6}>
                        {q.note && <p className={calcStyles.small}><strong>Note from our team:</strong> {q.note}</p>}
                        {detailError && <div className={historyStyles.loginError}>{detailError}</div>}
                        {lineItems.length > 0 ? (
                          <table className={historyStyles.table}>
                            <thead>
                              <tr>
                                <th>Description</th>
                                <th>Qty</th>
                                <th>Rate</th>
                                <th>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lineItems.map((li, i) => (
                                <tr key={i}>
                                  <td>{li.description}</td>
                                  <td>{li.qty} {li.unit}</td>
                                  <td>{money(li.rate)}</td>
                                  <td>{money(li.amount)}</td>
                                </tr>
                              ))}
                              <tr>
                                <td colSpan={3}><strong>Subtotal</strong></td>
                                <td><strong>{money(q.subtotal)}</strong></td>
                              </tr>
                              {q.discount_total > 0 && (
                                <tr>
                                  <td colSpan={3}>Discount</td>
                                  <td>-{money(q.discount_total)}</td>
                                </tr>
                              )}
                              <tr>
                                <td colSpan={3}>GST</td>
                                <td>{money(q.gst_amount)}</td>
                              </tr>
                              <tr>
                                <td colSpan={3}><strong>Total</strong></td>
                                <td><strong>{money(q.total)}</strong></td>
                              </tr>
                            </tbody>
                          </table>
                        ) : (
                          !detailError && <p className={calcStyles.small}>Loading line items…</p>
                        )}
                        <p className={calcStyles.small}>
                          Valid for {q.validity_days} days from {q.created_at ? new Date(q.created_at).toLocaleDateString() : '-'}.
                        </p>
                        {pdf && (
                          <button type="button" className={calcStyles.btn} disabled={downloading} onClick={download}>
                            {downloading ? <Loader2 size={14} aria-hidden /> : <Download size={14} aria-hidden />}{' '}
                            {downloading ? 'Building PDF…' : 'Download PDF'}
                          </button>
                        )}
                        {isProposal && (
                          /* A proposal quotation is an uploaded document, not
                             a generated one, and its file sits outside what a
                             partner may read. Saying so beats a dead button. */
                          <p className={calcStyles.small}>
                            This quotation was issued as an attached document — ask your contact for a copy.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PartnerShell>
  );
}
