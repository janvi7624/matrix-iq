import { DeliveryChallanRecord } from './types';
import { formatNumberPdf } from './format';

// Demo-dispatch specific — matches the wording on the company's actual
// paper/PDF Delivery Challan (public/DC.pdf), not the sale-oriented
// QUOTATION_TERMS in lib/pdf.ts.
const DC_TERMS = [
  'THIS IS FOR ONLY DEMO PURPOSE — NOT FOR SALES.',
  'WE ARE NOT RESPONSIBLE AFTER DELIVERY OF GOODS.',
  'THIS IS EX SHOP INVOICE.',
  'IF ANY STRETCH OR MISS HANDLING FOUND OR ANY ITEM FOUND MISSING, COMPLETE UNIT WILL BE BILLED AT ITS MRP TO PARTNER.'
];

// Same source as the quotation PDF (AppConfig.companyLegalName, via
// companyOverride) — both should always say the same company name, so
// there's one place an admin corrects it rather than two hardcoded strings
// that can drift apart.
const DC_COMPANY_NAME_FALLBACK = 'NANTA TECH LIMITED';

export interface DeliveryChallanPdfCompanyOverride {
  legalName?: string;
  addressLines: string[];
  contactPhone?: string;
  gstNumber?: string;
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-GB').replace(/\//g, '-');
  } catch {
    return iso;
  }
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

export async function generateDeliveryChallanPdf(
  dc: DeliveryChallanRecord,
  opts?: { companyOverride?: DeliveryChallanPdfCompanyOverride; mode?: 'download' | 'print' }
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const rightX = pageWidth - marginX;

  const companyLegalName = opts?.companyOverride?.legalName || DC_COMPANY_NAME_FALLBACK;
  const companyAddressLines = opts?.companyOverride?.addressLines?.length
    ? opts.companyOverride.addressLines
    : ['205, F Block, Shivalik Sharda Harmony,', 'Panjarapole Cross Rd, Ambawadi,', 'Ahmedabad, Gujarat - 380015'];
  const companyContactPhone = opts?.companyOverride?.contactPhone || '';
  const gstNumber = opts?.companyOverride?.gstNumber || '';

  let logoDataUrl: string | null = null;
  try {
    logoDataUrl = await loadImageAsDataURL('/NANTA.png');
  } catch {
    logoDataUrl = null;
  }

  // Letterhead — logo + company name + address, mirroring the quotation
  // PDF's header block.
  const logoW = 20;
  const logoH = 14;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', marginX, 10, logoW, logoH, undefined, 'FAST');
  }
  const brandX = logoDataUrl ? marginX + logoW + 4 : marginX;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  doc.text(companyLegalName.toUpperCase(), brandX, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(90, 90, 90);
  companyAddressLines.forEach((line, i) => doc.text(line, brandX, 19.5 + i * 3.4));
  // GST number — directly below the company name/address block.
  if (gstNumber) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text(`GSTIN: ${gstNumber}`, brandX, 19.5 + companyAddressLines.length * 3.4);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(220, 38, 38);
  doc.text('RETURNABLE DELIVERY CHALLAN', rightX, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  doc.text(`Challan No: ${dc.dc_number}`, rightX, 20, { align: 'right' });
  doc.text(`Date: ${formatDate(dc.issued_date)}   |   Status: ${dc.status.charAt(0).toUpperCase() + dc.status.slice(1)}`, rightX, 24.5, { align: 'right' });

  const headerContentLines = companyAddressLines.length + (gstNumber ? 1 : 0);
  let y = Math.max(30, 19.5 + headerContentLines * 3.4 + 3);
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, rightX, y);
  y += 5;

  if (dc.custom_project_name) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(17, 24, 39);
    doc.text(`Project: ${dc.custom_project_name}`, marginX, y);
    y += 6;
  }

  // Plain text, no box/border, side by side — Delivery Challan To on the
  // left, Requested By / Created By on the right.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const leftColWidth = (pageWidth - marginX * 2) / 2 - 6;
  const rightColX = marginX + (pageWidth - marginX * 2) / 2 + 6;
  const clientAddressWrapped = dc.client_address ? doc.splitTextToSize(dc.client_address, leftColWidth) : [];
  const toLines = [dc.client_name || 'N/A', ...clientAddressWrapped, dc.client_phone ? `Contact: ${dc.client_phone}` : ''].filter(Boolean);
  const lineHeight = 4.4;
  const rowY = y;

  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Delivery Challan To', marginX, rowY);
  doc.setFontSize(9);
  doc.text(toLines[0], marginX, rowY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  toLines.slice(1).forEach((line, i) => doc.text(line, marginX, rowY + 6 + (i + 1) * lineHeight));

  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Requested By', rightColX, rowY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(dc.assigned_engineer || '-', rightColX, rowY + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Created By', rightColX, rowY + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(dc.issued_by || '-', rightColX, rowY + 19);

  const leftColLines = 6 + (toLines.length > 1 ? (toLines.length - 1) * lineHeight : 0);
  y = rowY + Math.max(leftColLines, 19) + 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  doc.text(`Expected Return Date: ${formatDate(dc.expected_return_date)}`, rightX, y, { align: 'right' });

  y += 7;

  // Line items — Price is Back-Office-entered only (enforced in the
  // updateItems route), shown here whenever it's set.
  const rows = dc.items.map((item, i) => [
    String(i + 1),
    item.product,
    item.hsnCode || '-',
    item.serialNumber || '-',
    String(item.quantity),
    formatNumberPdf(item.price || 0)
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    startY: y,
    head: [['Sr.No', 'Description', 'HSN Code', 'Serial Number', 'Qty', 'Price']],
    body: rows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3, textColor: [17, 24, 39], valign: 'middle', lineColor: [0, 0, 0], lineWidth: 0.2 },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineColor: [0, 0, 0], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 28, halign: 'center' },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 26, halign: 'right', font: 'courier', fontSize: 9 }
    },
    margin: { left: marginX, right: marginX }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 4;

  const total = dc.items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
  if (total > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(17, 24, 39);
    doc.text('Total:', rightX - 40, y + 5);
    doc.setFont('courier', 'bold');
    doc.text(formatNumberPdf(total), rightX, y + 5, { align: 'right' });
    y += 10;
  } else {
    y += 4;
  }

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text('Terms & condition:', marginX, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
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
  doc.setTextColor(17, 24, 39);
  doc.text(`For: ${companyLegalName.toUpperCase()}`, rightX - 2, y, { align: 'right' });
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('(Authorised Signatory)', rightX - 2, y, { align: 'right' });

  if (opts?.mode === 'print') {
    // Opens the actual generated PDF in a new tab and asks the browser's
    // built-in PDF viewer to print it — this is what makes "Print" print the
    // Delivery Challan document itself, instead of window.print() printing
    // whatever's currently on screen (the app's own page chrome, buttons,
    // etc., not the DC).
    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
    return;
  }

  doc.save(`${dc.dc_number}.pdf`);
}
