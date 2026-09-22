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

export type BillFormat = 'pdf' | 'png' | 'jpeg' | 'other';

// A bill is identified by its own bytes, never by the response's
// Content-Type. On the live site Hostinger's CDN rewrites images whose URL
// ends in .jpg/.png into WebP — same URL, Content-Type: image/webp — for any
// request whose Accept header allows it (opening "View Bill" in a tab does),
// and the browser can then reuse that cached WebP for the fetch below.
// Trusting Content-Type there silently dropped every photo bill on live
// while local (no CDN) merged them fine.
export function detectBillFormat(bytes: Uint8Array): BillFormat {
  const startsWith = (signature: number[]) => signature.every((b, i) => bytes[i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith([0xff, 0xd8, 0xff])) return 'jpeg';
  // "%PDF-" — the PDF spec tolerates a few junk bytes before the header, so
  // look through the first 1KB rather than only at offset 0.
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return 'pdf';
  }
  return 'other';
}

// pdf-lib can only embed PNG and JPEG. Anything else the browser can decode
// (the CDN's WebP, or a GIF/AVIF photo) is redrawn onto a canvas and
// re-encoded as JPEG, over white since a bill has no meaningful transparency.
// Throws when the browser can't decode it either, which the caller counts as
// a failed bill.
async function rasterizeToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Could not re-encode image');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
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
      // no-store: skip a WebP copy cached by an earlier "View Bill" so the
      // original file is what gets merged, not a lossy re-encode of it.
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        failed += 1;
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const format = detectBillFormat(bytes);

      if (format === 'pdf') {
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } else {
        const img =
          format === 'png' ? await merged.embedPng(bytes)
          : format === 'jpeg' ? await merged.embedJpg(bytes)
          : await merged.embedJpg(await rasterizeToJpeg(bytes));
        const page = merged.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      succeeded += 1;
    } catch {
      // One unreadable file is skipped rather than failing the whole merge.
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
