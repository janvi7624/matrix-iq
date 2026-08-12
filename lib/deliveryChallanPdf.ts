import { DeliveryChallanRecord } from './types';

// Demo-dispatch specific — matches the wording on the company's actual
// paper/PDF Delivery Challan (public/DC.pdf), not the sale-oriented
// QUOTATION_TERMS in lib/pdf.ts.
const DC_TERMS = [
  'THIS IS FOR ONLY DEMO PURPOSE — NOT FOR SALES.',
  'WE ARE NOT RESPONSIBLE AFTER DELIVERY OF GOODS.',
  'THIS IS EX SHOP INVOICE.',
  'IF ANY STRETCH OR MISS HANDLING FOUND OR ANY ITEM FOUND MISSING, COMPLETE UNIT WILL BE BILLED AT ITS MRP TO PARTNER.'
];

export interface DeliveryChallanPdfCompanyOverride {
  legalName: string;
  addressLines: string[];
  contactPhone?: string;
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-GB').replace(/\//g, '-');
  } catch {
    return iso;
  }
}

export async function generateDeliveryChallanPdf(dc: DeliveryChallanRecord, opts?: { companyOverride?: DeliveryChallanPdfCompanyOverride }): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const rightX = pageWidth - marginX;

  const companyLegalName = opts?.companyOverride?.legalName || 'NANTA Technology Limited';
  const companyAddressLines = opts?.companyOverride?.addressLines?.length
    ? opts.companyOverride.addressLines
    : ['205, F Block, Shivalik Sharda Harmony,', 'Panjarapole Cross Rd, Ambawadi,', 'Ahmedabad, Gujarat - 380015'];
  const companyContactPhone = opts?.companyOverride?.contactPhone || '';

  // Header banner
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(marginX, 12, rightX - marginX, 8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text('RETURNABLE DELIVERY CHALLAN', pageWidth / 2, 17.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Original', rightX - 2, 24, { align: 'right' });

  // From / recipient block
  let y = 27;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(companyLegalName.toUpperCase(), marginX + 1, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  companyAddressLines.forEach((line, i) => doc.text(line, marginX + 1, y + 8.5 + i * 4));
  if (companyContactPhone) doc.text(`Mo: ${companyContactPhone}`, marginX + 1, y + 8.5 + companyAddressLines.length * 4);

  const infoBoxX = pageWidth - 70;
  doc.text(`Challan :- ${dc.dc_number}`, infoBoxX, y + 4);
  doc.text(`DATE :- ${formatDate(dc.issued_date)}`, infoBoxX, y + 8.5);
  doc.text(`Dispatch Throught :- ${dc.assigned_engineer || '-'}`, infoBoxX, y + 13);
  doc.text(`Return date :- ${formatDate(dc.expected_return_date)}`, infoBoxX, y + 17.5);

  y += 24;
  doc.setDrawColor(150, 150, 150);
  doc.line(marginX, y, rightX, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Name -', marginX + 1, y);
  doc.setFont('helvetica', 'normal');
  doc.text(dc.client_name || 'N/A', marginX + 16, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Status -', marginX + 1, y);
  doc.setFont('helvetica', 'normal');
  doc.text(dc.status.charAt(0).toUpperCase() + dc.status.slice(1), marginX + 16, y);

  y += 6;
  doc.setDrawColor(150, 150, 150);
  doc.line(marginX, y, rightX, y);
  y += 6;

  // Line items
  const rows = dc.items.map((item, i) => [String(i + 1), item.product, item.serialNumber || '-', String(item.quantity)]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    startY: y,
    head: [['Sr.No', 'Description', 'Serial Number', 'Qty']],
    body: rows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3, textColor: [17, 24, 39], valign: 'middle', lineColor: [0, 0, 0], lineWidth: 0.2 },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineColor: [0, 0, 0], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 40, halign: 'center' },
      3: { cellWidth: 20, halign: 'center' }
    },
    margin: { left: marginX, right: marginX }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Terms & condition:', marginX, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  DC_TERMS.forEach((term, i) => {
    const wrapped = doc.splitTextToSize(`${i + 1}. ${term}`, rightX - marginX);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 4;
  });

  y += 10;
  doc.setDrawColor(0, 0, 0);
  doc.line(marginX, y, rightX, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`For: ${companyLegalName.toUpperCase()}`, rightX - 2, y, { align: 'right' });
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('(Authorised Signatory)', rightX - 2, y, { align: 'right' });

  doc.save(`${dc.dc_number}.pdf`);
}
