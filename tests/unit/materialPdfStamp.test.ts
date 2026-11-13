import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFArray } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import { stampConfidentialFooter } from '../../lib/materialPdfStamp';

// The footer is the only part of a Marketing Material that still travels with
// the file once it has been downloaded and forwarded, so what is pinned here
// is that it reaches EVERY page — a notice on page 1 of an 18-page brochure
// is a cover sheet, not a confidentiality notice.
//
// Assertions read the text back out of the page content streams, because
// that is the only way to prove the ink landed on the page rather than that
// the function merely returned without throwing. pdf-lib writes drawn text
// as a hex string in WinAnsi, so the helper decodes it and the expectations
// use the ASCII part of the notice (the en dash becomes a single 0x96 byte
// and is not worth asserting on).

const ASCII_NOTICE = 'Not for distribution without prior written consent of Nanta Tech Limited.';

async function blankPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) pdf.addPage([595, 842]);
  return pdf.save();
}

/** Everything drawn on each page, with hex-encoded show-text decoded. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const ctx = page.node.context;
    const contents = ctx.lookup(page.node.get(PDFName.of('Contents')));
    const items: unknown[] = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
    const raw = items
      .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
      .map((s) => {
        const data = Buffer.from(s.getContents());
        try {
          return inflateSync(data).toString('latin1');
        } catch {
          return data.toString('latin1');
        }
      })
      .join('\n');
    return raw.replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_m, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
  });
}

describe('stamping the confidentiality footer', () => {
  it('puts the notice on every page, not just the first', async () => {
    const stamped = await stampConfidentialFooter(await blankPdf(5), { recipient: 'Test User', now: new Date('2026-11-13T00:00:00Z') });
    expect(stamped).not.toBeNull();
    const texts = await pageTexts(stamped!);
    expect(texts).toHaveLength(5);
    for (const text of texts) {
      expect(text).toContain('Confidential');
      expect(text).toContain(ASCII_NOTICE);
    }
  });

  it('names the recipient and the date so a leaked copy is traceable', async () => {
    const stamped = await stampConfidentialFooter(await blankPdf(1), { recipient: 'Aarav Shah', now: new Date('2026-11-13T09:00:00Z') });
    const [text] = await pageTexts(stamped!);
    expect(text).toContain('Issued to Aarav Shah on 2026-11-13');
  });

  it('falls back to a date-only line when nobody is named', async () => {
    const stamped = await stampConfidentialFooter(await blankPdf(1), { now: new Date('2026-11-13T09:00:00Z') });
    const [text] = await pageTexts(stamped!);
    expect(text).toContain('Issued on 2026-11-13');
    expect(text).not.toContain('Issued to ');
  });

  it('preserves the page count and leaves the caller’s bytes untouched', async () => {
    const original = await blankPdf(9);
    const copy = Uint8Array.from(original);
    const stamped = await stampConfidentialFooter(original);
    expect((await PDFDocument.load(stamped!)).getPageCount()).toBe(9);
    // The stored file must stay pristine — stamping happens on the way out.
    expect(Buffer.compare(Buffer.from(original), Buffer.from(copy))).toBe(0);
  });

  it('adds the diagonal watermark only when asked', async () => {
    const plain = await stampConfidentialFooter(await blankPdf(1), {});
    const marked = await stampConfidentialFooter(await blankPdf(1), { diagonal: true });
    expect((await pageTexts(plain!))[0]).not.toContain('CONFIDENTIAL');
    expect((await pageTexts(marked!))[0]).toContain('CONFIDENTIAL');
  });

  it('returns null for bytes that are not a PDF, so the caller serves the original', async () => {
    // A stamp failure must never become an outage: these are sales materials
    // someone is opening in front of a customer.
    expect(await stampConfidentialFooter(Buffer.from('this is not a pdf'))).toBeNull();
  });
});
