import { PDFDocument } from 'pdf-lib';

// Accounts asked to download every bill attached to a reimbursement sheet as
// ONE file instead of opening each attachment separately. Bills are a mix of
// PDFs and photos (JPG/PNG) — see db/models/reimbursement.js's
// attachment_urls and the upload picker's accept="image/*,.pdf" — so a PDF
// page for an image and a real page-copy for an existing PDF both need
// handling. No existing PDF-merge utility exists in this codebase (jsPDF,
// used everywhere else here, can only draw new content — it can't import an
// existing PDF's pages), hence the new pdf-lib dependency, used client-side
// only, same as every other PDF export in this app.
export interface MergeBillsResult {
  bytes: Uint8Array;
  succeeded: number;
  failed: number;
}

// Each url is fetched through this app's own authenticated proxy
// (/api/uploads/file/...), so the browser's session cookie already covers
// it — no separate auth handling needed here.
export async function mergeBillsIntoPdf(urls: string[]): Promise<MergeBillsResult> {
  const merged = await PDFDocument.create();
  let succeeded = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        failed += 1;
        continue;
      }
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const bytes = new Uint8Array(await res.arrayBuffer());

      if (contentType.includes('pdf')) {
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } else if (contentType.includes('png')) {
        const img = await merged.embedPng(bytes);
        const page = merged.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        const img = await merged.embedJpg(bytes);
        const page = merged.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      } else {
        // Not a type the upload picker allows today (image/*,.pdf) — skip
        // rather than fail the whole merge over one unexpected file.
        failed += 1;
        continue;
      }
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  return { bytes: await merged.save(), succeeded, failed };
}

export function downloadMergedPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
