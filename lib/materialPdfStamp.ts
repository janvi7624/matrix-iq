import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { MATERIAL_CONFIDENTIALITY_NOTICE, recipientLine } from './materialConfidentiality';

// Stamps the confidentiality footer into a Marketing Material PDF as it is
// served.
//
// WHY AT SERVE TIME, not on upload: the stored file stays pristine. Marketing
// can replace the wording, correct the company name or turn the stamp off and
// every existing document picks the change up on its next download — no
// re-upload of 16 brochures, and no risk of a double stamp when a file is
// uploaded twice. It also means the recipient line can name whoever is
// actually downloading, which a stamp burned in at upload time cannot do.
//
// The cost is doing this per request. It is bounded: PDFs only, Marketing
// Materials only, and the response still carries the same private cache
// headers, so a reader paging through a brochure does not re-stamp it.

export interface StampOptions {
  /** Who is downloading — shown in the traceability line. '' omits the name. */
  recipient?: string;
  /** Injected so a test can assert a fixed date. */
  now?: Date;
  /** A faint diagonal CONFIDENTIAL across each page, for partner copies. */
  diagonal?: boolean;
}

const FOOTER_SIZE = 7.5;
const MARGIN = 18;

/**
 * Returns the stamped PDF, or null when the bytes are not a PDF this can
 * safely rewrite.
 *
 * Deliberately null rather than throwing: the caller serves the original
 * instead. A document that fails to stamp must still open — refusing to serve
 * a brochure because a footer could not be drawn would turn a cosmetic
 * problem into an outage, and these are sales materials people need in front
 * of a customer.
 */
export async function stampConfidentialFooter(bytes: Uint8Array, options: StampOptions = {}): Promise<Uint8Array | null> {
  try {
    // ignoreEncryption: a password-protected or permission-flagged PDF would
    // otherwise throw. We can still usually draw on it; if we cannot, the
    // catch below hands back the original untouched.
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = pdf.getPages();
    if (!pages.length) return null;

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const servedOn = options.now ?? new Date();
    const second = recipientLine(options.recipient ?? '', servedOn);

    for (const page of pages) {
      const { width, height } = page.getSize();

      // A white band behind the text. Without it the footer lands on top of
      // whatever artwork reaches the page edge and becomes unreadable on
      // exactly the dark, full-bleed brochure pages that most need it.
      const bandHeight = MARGIN + FOOTER_SIZE * 2.4;
      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height: bandHeight,
        color: rgb(1, 1, 1),
        opacity: 0.86
      });

      const noticeWidth = bold.widthOfTextAtSize(MATERIAL_CONFIDENTIALITY_NOTICE, FOOTER_SIZE);
      page.drawText(MATERIAL_CONFIDENTIALITY_NOTICE, {
        x: Math.max(MARGIN, (width - noticeWidth) / 2),
        y: MARGIN + FOOTER_SIZE + 3,
        size: FOOTER_SIZE,
        font: bold,
        color: rgb(0.62, 0.09, 0.09)
      });

      const secondWidth = font.widthOfTextAtSize(second, FOOTER_SIZE - 0.5);
      page.drawText(second, {
        x: Math.max(MARGIN, (width - secondWidth) / 2),
        y: MARGIN,
        size: FOOTER_SIZE - 0.5,
        font,
        color: rgb(0.35, 0.35, 0.35)
      });

      if (options.diagonal) {
        const text = 'CONFIDENTIAL';
        const size = Math.min(width, height) / 7;
        // Drawn last but at low opacity so it reads as a watermark rather
        // than obscuring the content underneath.
        page.drawText(text, {
          x: width / 2 - bold.widthOfTextAtSize(text, size) / 2.6,
          y: height / 2 - size / 2,
          size,
          font: bold,
          color: rgb(0.78, 0.14, 0.14),
          opacity: 0.1,
          rotate: degrees(32)
        });
      }
    }

    return await pdf.save();
  } catch {
    return null;
  }
}
