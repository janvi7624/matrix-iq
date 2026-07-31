// Generic "export this list as a PDF" helper for the project-pipeline
// modules (Projects, Site Visits, Demo, Customer Response, Negotiation, PO,
// Installation) — same jsPDF + autoTable stack as the full quotation PDF in
// lib/pdf.ts, but a plain title + table instead of a full letterhead layout.
export async function exportListToPdf(title: string, columns: string[], rows: (string | number)[][], filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(220, 38, 38);
  doc.setFontSize(16);
  doc.text(title, 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 114, 128);
  doc.setFontSize(9);
  doc.text(`Exported ${new Date().toLocaleString('en-IN')}`, 14, 22);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    head: [columns],
    body: rows,
    startY: 26,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [220, 38, 38], textColor: [255, 255, 255] },
    margin: { left: 14, right: 14 }
  });

  doc.save(filename);
}
