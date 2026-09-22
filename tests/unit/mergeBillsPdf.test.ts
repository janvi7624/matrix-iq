import { describe, it, expect } from 'vitest';
import { detectBillFormat } from '../../lib/mergeBillsPdf';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('detectBillFormat', () => {
  it('recognises a PDF by its %PDF- header', () => {
    expect(detectBillFormat(bytes('%PDF-1.7\n%âãÏÓ'))).toBe('pdf');
  });

  it('recognises a PDF whose header follows a few junk bytes', () => {
    expect(detectBillFormat(bytes([0xef, 0xbb, 0xbf], '\r\n%PDF-1.4'))).toBe('pdf');
  });

  it('recognises PNG and JPEG signatures', () => {
    expect(detectBillFormat(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBe('png');
    expect(detectBillFormat(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF'))).toBe('jpeg');
  });

  it('treats the WebP the live CDN serves for a .jpg bill as "other", so it gets redrawn, not dropped', () => {
    expect(detectBillFormat(bytes('RIFF', [0x66, 0x65, 0x01, 0x00], 'WEBPVP8 '))).toBe('other');
  });

  it('goes by the bytes, not the name — a JPEG is a JPEG whatever the URL or header says', () => {
    // Regression: the merge used to branch on Content-Type, which the CDN rewrites.
    expect(detectBillFormat(bytes([0xff, 0xd8, 0xff, 0xdb]))).toBe('jpeg');
  });

  it('returns "other" for empty or unrecognised content', () => {
    expect(detectBillFormat(new Uint8Array())).toBe('other');
    expect(detectBillFormat(bytes('{"error":"Unauthorized"}'))).toBe('other');
  });
});
