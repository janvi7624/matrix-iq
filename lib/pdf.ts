import { LineItem, ProductGroup, Totals } from './types';
import { GST_RATE_PERCENT, formatMoneyPdf, formatNumberPdf } from './format';

const QUOTATION_TERMS = [
  '1. Any items other than mentioned in the above BOQ will be charged additional as per the feasibility of the solution.',
  '2. Standard delivery period: 20-25 working days approx from the date of order. Installation after delivery.',
  '3. Payment - 100% advance or as mutually agreed.',
  "4. Above charges are only for supply of components. Installation is in the partner's scope; commissioning, if required, will be provided by NANTA Technology on a chargeable basis.",
  '5. Any drawings / layout / placement details / DB level / modular reports will be charged additional under documentation charges.',
  '6. All post-sales support and installation support is virtual (telephonic and remote support).',
  '7. Onsite support charges will be extra after complete handover of the project.',
  '8. Payment needs to be done as per agreed terms and cannot be put on hold for any performance-related issues.',
  '9. NANTA Technology reserves the right to change the above quote at any given point of time.',
  '10. Warranty will be guided by the OEM warranty terms for the items listed above and is void if not installed / operated per OEM guidelines.',
  '11. Taxes will be charged as per applicable government terms.',
  '12. The scope of supply includes only the items listed above. Prices are for the complete bill of material and are not valid for partial purchases.',
  '13. SITC (Supply, Installation, Testing & Commissioning) is included in the above scope unless mentioned otherwise.'
];

function buildPdfTableRows(lineItems: LineItem[], productGroups: ProductGroup[]) {
  const groups = (productGroups || []).filter((g) => g.end > g.start);
  const rows: (string | { content: string; colSpan: number; styles: Record<string, unknown> })[][] = [];
  let sr = 1;
  const asRow = (item: LineItem) => [String(sr++), item.description, item.unit, String(item.qty), formatNumberPdf(item.rate), formatNumberPdf(item.amount)];

  if (groups.length <= 1) {
    lineItems.forEach((item) => rows.push(asRow(item)));
    return rows;
  }

  groups.forEach((group, gi) => {
    rows.push([
      {
        content: `Product ${gi + 1}: ${group.label}`,
        colSpan: 6,
        styles: { fillColor: [243, 244, 246], fontStyle: 'bold', textColor: [17, 24, 39], halign: 'left' }
      }
    ]);
    for (let i = group.start; i < group.end; i++) {
      rows.push(asRow(lineItems[i]));
    }
  });
  return rows;
}

function loadImageAsDataURL(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d context unavailable');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}

export interface QuotationPdfInput {
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
  customTerms?: string;
  lineItems: LineItem[];
  productGroups: ProductGroup[];
  totals: Totals;
}

export async function generateQuotationPdf(input: QuotationPdfInput): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  // jspdf-autotable only self-attaches to a global `window.jsPDF`; since jsPDF is
  // imported as a local ES module binding here, it must be applied explicitly.
  applyPlugin(jsPDF);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const rightX = pageWidth - marginX;

  let logoDataUrl: string | null = null;
  try {
    logoDataUrl = await loadImageAsDataURL('/NANTA.jpeg');
  } catch {
    logoDataUrl = null;
  }

  const quotationNumber = input.quotationNumber;
  const dateStr = new Date().toLocaleDateString('en-IN');

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', marginX, 9, 26, 18, undefined, 'FAST');
  }

  doc.setFont('times', 'bold');
  doc.setTextColor(220, 38, 38);
  doc.setFontSize(24);
  doc.text('QUOTATION', rightX, 18, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(`Quotation No: ${quotationNumber}   |   Version-1`, rightX, 26, { align: 'right' });
  doc.text(`Quotation Date: ${dateStr}`, rightX, 31, { align: 'right' });

  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(0.6);
  doc.line(marginX, 35, rightX, 35);

  const boxY = 40;
  const boxWidth = (pageWidth - marginX * 2 - 6) / 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const fromLines = [
    'NANTA Technology Limited',
    '205, F Block, Shivalik Sharda Harmony,',
    'Panjarapole Cross Rd, Ambawadi,',
    'Ahmedabad, Gujarat - 380015',
    `Prepared by: ${input.preparedBy || '-'}`,
    input.preparedByPhone ? `Mobile number: ${input.preparedByPhone}` : '',
    input.preparedByEmail ? `Email ID: ${input.preparedByEmail}` : 'Email ID: sales@nantatech.com'
  ].filter(Boolean);

  const toLines = [
    input.clientCompany || 'N/A',
    input.clientName ? `Attn: ${input.clientName}` : '',
    input.clientEmail ? `Email: ${input.clientEmail}` : '',
    input.clientPhone ? `Phone: ${input.clientPhone}` : '',
    input.projectVertical ? `Vertical: ${input.projectVertical}` : ''
  ].filter(Boolean);
  if (input.clientAddress) {
    const wrappedAddress = doc.splitTextToSize(input.clientAddress, boxWidth - 8);
    toLines.splice(1, 0, ...wrappedAddress);
  }

  // Size the box to whichever side has more lines, so content never spills
  // past the bottom edge (fromLines alone can run to 7 lines).
  const boxLineHeight = 4.4;
  const boxTopPadding = 12;
  const boxBottomPadding = 6;
  const maxLines = Math.max(fromLines.length, toLines.length);
  const boxHeight = Math.max(36, boxTopPadding + maxLines * boxLineHeight + boxBottomPadding);

  doc.setDrawColor(210, 200, 200);
  doc.setFillColor(249, 245, 245);
  doc.roundedRect(marginX, boxY, boxWidth, boxHeight, 2, 2, 'FD');
  doc.roundedRect(marginX + boxWidth + 6, boxY, boxWidth, boxHeight, 2, 2, 'FD');

  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Quotation From', marginX + 4, boxY + 6);
  doc.text('Quotation For', marginX + boxWidth + 10, boxY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  fromLines.forEach((line, i) => doc.text(line, marginX + 4, boxY + boxTopPadding + i * boxLineHeight));
  toLines.forEach((line, i) => doc.text(line, marginX + boxWidth + 10, boxY + boxTopPadding + i * boxLineHeight));

  const tableBody = buildPdfTableRows(input.lineItems, input.productGroups);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    startY: boxY + boxHeight + 8,
    head: [['Sr.No', 'Description', 'Unit', 'Qty', 'Unit Rate', 'Amount']],
    body: tableBody,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3, textColor: [31, 41, 55], valign: 'middle', lineColor: [209, 213, 219], lineWidth: 0.2 },
    headStyles: { fillColor: [17, 24, 39], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9.5, halign: 'center' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 30, halign: 'right', font: 'courier', fontSize: 9 },
      5: { cellWidth: 32, halign: 'right', font: 'courier', fontSize: 9, fontStyle: 'bold' }
    },
    margin: { left: marginX, right: marginX }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = (doc as any).lastAutoTable.finalY + 6;
  if (y > pageHeight - 40) {
    doc.addPage();
    y = 20;
  }

  const totalsX = rightX - 80;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(31, 41, 55);
  doc.text('Subtotal', totalsX, y);
  doc.setFont('courier', 'normal');
  doc.text(formatNumberPdf(input.totals.subtotal), rightX, y, { align: 'right' });
  y += 6.5;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(31, 41, 55);
  doc.text(`Markup (${input.totals.markup}%)`, totalsX, y);
  doc.setFont('courier', 'normal');
  doc.text(formatNumberPdf(input.totals.markupAmount), rightX, y, { align: 'right' });
  y += 6.5;

  if (input.totals.discountTotal) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(21, 128, 61);
    doc.text('Discount', totalsX, y);
    doc.setFont('courier', 'normal');
    doc.text(`- ${formatNumberPdf(input.totals.discountTotal)}`, rightX, y, { align: 'right' });
    doc.setTextColor(31, 41, 55);
    y += 6.5;
  }

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(31, 41, 55);
  doc.text(`GST (${GST_RATE_PERCENT}%)`, totalsX, y);
  doc.setFont('courier', 'normal');
  doc.text(formatNumberPdf(input.totals.gstAmount), rightX, y, { align: 'right' });
  y += 6.5;

  y -= 2.5;

  doc.setFillColor(254, 226, 226);
  doc.rect(totalsX - 4, y, rightX - totalsX + 4, 10.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(185, 28, 28);
  doc.text('Grand Total', totalsX, y + 7.2);
  doc.setFont('courier', 'bold');
  doc.text(formatMoneyPdf(input.totals.total), rightX, y + 7.2, { align: 'right' });
  y += 18;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + input.validityDays);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(107, 114, 128);
  const noteText = `Prices valid till ${validUntil.toLocaleDateString('en-IN')} (${input.validityDays} days from quotation date). Freight/transportation charges, if applicable, will be extra.`;
  const wrappedNote = doc.splitTextToSize(noteText, rightX - marginX);
  doc.text(wrappedNote, marginX, y);
  y += wrappedNote.length * 4 + 4;

  if (y > pageHeight - 30) {
    doc.addPage();
    y = 20;
  }

  const customTermLines = (input.customTerms || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const allTerms = [...QUOTATION_TERMS, ...customTermLines.map((line, i) => `${QUOTATION_TERMS.length + i + 1}. ${line}`)];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    startY: y,
    head: [['Terms and Conditions']],
    body: allTerms.map((term) => [term]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 7.8, cellPadding: 1.2, textColor: [55, 65, 81] },
    headStyles: { fontStyle: 'bold', fontSize: 9.5, textColor: [17, 24, 39] },
    margin: { left: marginX, right: marginX }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10;
  if (y > pageHeight - 20) {
    doc.addPage();
    y = 20;
  }

  doc.setFont('times', 'bolditalic');
  doc.setFontSize(13);
  doc.setTextColor(220, 38, 38);
  doc.text('Thank You', pageWidth / 2, y, { align: 'center' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageCount = (doc.internal as any).getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(156, 163, 175);
    doc.text(`Page ${p} of ${pageCount}`, rightX, pageHeight - 8, { align: 'right' });
  }

  const fileDate = new Date().toISOString().slice(0, 10);
  doc.save(`quotation-${quotationNumber.replace(/[^a-z0-9-]+/gi, '_')}-${fileDate}.pdf`);
}
