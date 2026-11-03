import { SopDocument, SopModulePage } from './sopDocument';

// Rendering a role's SoP to a PDF.
//
// jsPDF, the same stack as lib/deliveryChallanPdf.ts, lib/expenseVoucherPdf.ts
// and lib/pdf.ts — already a dependency, and the one the rest of this app's
// documents are drawn with.
//
// Unlike those three this is a PROSE document, not a table, so it is laid out
// by a small cursor that knows how to wrap, how to measure, and when to break
// a page. The one rule worth stating: nothing is drawn without first asking
// whether it fits, because a heading stranded at the foot of a page with its
// steps overleaf is the specific ugliness that makes a generated document
// look generated.
//
// Returns the bytes rather than triggering a download, so the same function
// serves the generator script (which uploads them) and any future
// download-from-the-browser path.

const PAGE = { width: 210, height: 297 };
const MARGIN = { left: 18, right: 18, top: 20, bottom: 20 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const FOOT_Y = PAGE.height - 12;

const INK = { strong: [17, 24, 39], body: [55, 65, 81], muted: [120, 120, 128], rule: [220, 38, 38], accent: [37, 99, 235] } as const;

type Doc = import('jspdf').jsPDF;

interface Cursor {
  y: number;
  page: number;
}

export interface SopPdfMeta {
  /** Printed on the cover and in the footer, so a stale copy is identifiable. */
  generatedOn: string;
  /** The company name on the cover. */
  organisation: string;
}

function setInk(doc: Doc, colour: readonly number[]): void {
  doc.setTextColor(colour[0], colour[1], colour[2]);
}

/** Draws the footer on the page that is currently current. */
function footer(doc: Doc, cursor: Cursor, meta: SopPdfMeta, roleLabel: string): void {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setInk(doc, INK.muted);
  doc.text(`MatrixIQ SoP — ${roleLabel}`, MARGIN.left, FOOT_Y);
  doc.text(`Generated ${meta.generatedOn}`, PAGE.width / 2, FOOT_Y, { align: 'center' });
  doc.text(String(cursor.page), PAGE.width - MARGIN.right, FOOT_Y, { align: 'right' });
}

function newPage(doc: Doc, cursor: Cursor, meta: SopPdfMeta, roleLabel: string): void {
  footer(doc, cursor, meta, roleLabel);
  doc.addPage();
  cursor.page += 1;
  cursor.y = MARGIN.top;
}

/**
 * Will `height` fit on this page? If not, turn it.
 *
 * Every draw goes through this, which is what stops a heading from being
 * orphaned from the text beneath it: the caller asks for the height of the
 * whole block, not of the next line.
 */
function ensure(doc: Doc, cursor: Cursor, height: number, meta: SopPdfMeta, roleLabel: string): void {
  if (cursor.y + height > PAGE.height - MARGIN.bottom) newPage(doc, cursor, meta, roleLabel);
}

/** Wrapped text, returning the height it occupied. */
function paragraph(
  doc: Doc,
  cursor: Cursor,
  text: string,
  opts: { size: number; style: 'normal' | 'bold' | 'italic'; colour: readonly number[]; indent?: number; lead?: number; gap?: number },
  meta: SopPdfMeta,
  roleLabel: string
): void {
  const indent = opts.indent ?? 0;
  const lead = opts.lead ?? opts.size * 0.52;
  doc.setFont('helvetica', opts.style);
  doc.setFontSize(opts.size);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent) as string[];
  // Measured before anything is drawn, so a three-line paragraph is never
  // split one line before the break.
  ensure(doc, cursor, lines.length * lead, meta, roleLabel);
  setInk(doc, opts.colour);
  // Re-set after a possible page turn: addPage resets nothing, but the font
  // state is shared and a future edit here would be easy to get wrong.
  doc.setFont('helvetica', opts.style);
  doc.setFontSize(opts.size);
  for (const line of lines) {
    doc.text(line, MARGIN.left + indent, cursor.y);
    cursor.y += lead;
  }
  cursor.y += opts.gap ?? 0;
}

/** A numbered or bulleted list item, hanging-indented under its marker. */
function listItem(
  doc: Doc,
  cursor: Cursor,
  marker: string,
  text: string,
  opts: { size: number; colour: readonly number[] },
  meta: SopPdfMeta,
  roleLabel: string
): void {
  const markerWidth = 7;
  const lead = opts.size * 0.55;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(opts.size);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - markerWidth) as string[];
  ensure(doc, cursor, lines.length * lead + 1.2, meta, roleLabel);

  doc.setFont('helvetica', 'bold');
  setInk(doc, INK.accent);
  doc.text(marker, MARGIN.left, cursor.y);

  doc.setFont('helvetica', 'normal');
  setInk(doc, opts.colour);
  lines.forEach((line, i) => doc.text(line, MARGIN.left + markerWidth, cursor.y + i * lead));
  cursor.y += lines.length * lead + 1.2;
}

function rule(doc: Doc, cursor: Cursor, colour: readonly number[], weight = 0.4): void {
  doc.setDrawColor(colour[0], colour[1], colour[2]);
  doc.setLineWidth(weight);
  doc.line(MARGIN.left, cursor.y, PAGE.width - MARGIN.right, cursor.y);
  cursor.y += 4;
}

function modulePage(doc: Doc, cursor: Cursor, page: SopModulePage, meta: SopPdfMeta, roleLabel: string): void {
  // The module's name and its first line of substance are kept together:
  // a title alone at the foot of a page is the thing that reads as broken.
  ensure(doc, cursor, 26, meta, roleLabel);

  paragraph(doc, cursor, page.label, { size: 12.5, style: 'bold', colour: INK.strong, gap: 0.6 }, meta, roleLabel);
  paragraph(doc, cursor, page.purpose, { size: 9, style: 'normal', colour: INK.body, gap: 1.4 }, meta, roleLabel);

  paragraph(doc, cursor, `Where: ${page.location}`, { size: 8.5, style: 'italic', colour: INK.muted, gap: 0.8 }, meta, roleLabel);

  if (page.departments.length) {
    paragraph(
      doc,
      cursor,
      `Only for these departments: ${page.departments.join(', ')}.`,
      { size: 8.5, style: 'italic', colour: INK.muted, gap: 0.8 },
      meta,
      roleLabel
    );
  }

  // Generated from the role's real permission matrix, which is the whole
  // reason this document is per-role rather than one manual for everybody.
  // Granted and refused are printed only when the matrix actually says so —
  // see rightsNote for why "not mentioned" must not read as "not allowed".
  if (page.can.length) {
    paragraph(doc, cursor, `You can: ${page.can.join('; ')}.`, { size: 8.5, style: 'normal', colour: INK.body, gap: 0.6 }, meta, roleLabel);
  }
  if (page.cannot.length) {
    paragraph(doc, cursor, `You cannot: ${page.cannot.join('; ')}.`, { size: 8.5, style: 'normal', colour: INK.body, gap: 0.6 }, meta, roleLabel);
  }
  paragraph(doc, cursor, page.rightsNote, { size: 8, style: 'italic', colour: INK.muted, gap: 1.2 }, meta, roleLabel);

  // Two screens disagreeing about one module. Said in red, at the top of the
  // page, because somebody following the steps below will hit a wall and
  // should know why before they start rather than after.
  if (page.viewDenied) {
    paragraph(
      doc,
      cursor,
      'Note — this module appears on your dashboard, but your role is explicitly refused "view" on it in Role Management. Those two settings disagree. Expect to be refused, and ask an administrator to settle it before following the steps below.',
      { size: 8.5, style: 'bold', colour: INK.rule, gap: 1.6 },
      meta,
      roleLabel
    );
  }

  if (page.steps.length) {
    paragraph(doc, cursor, 'How to use it', { size: 9.5, style: 'bold', colour: INK.strong, gap: 1 }, meta, roleLabel);
    page.steps.forEach((step, i) => listItem(doc, cursor, `${i + 1}.`, step, { size: 9, colour: INK.body }, meta, roleLabel));
    cursor.y += 1.5;
  }

  if (page.rules.length) {
    paragraph(doc, cursor, 'Rules that bite', { size: 9.5, style: 'bold', colour: INK.rule, gap: 1 }, meta, roleLabel);
    page.rules.forEach((item) => listItem(doc, cursor, '!', item, { size: 9, colour: INK.body }, meta, roleLabel));
    cursor.y += 1.5;
  }

  // Said plainly rather than padded with a plausible-sounding procedure. A
  // confidently wrong step is worse than an admitted gap, because somebody
  // will follow it.
  if (page.procedurePending) {
    paragraph(
      doc,
      cursor,
      'No step-by-step procedure has been written for this module yet. What is above is generated from the app itself and is accurate; the working steps still need to come from whoever owns this module.',
      { size: 8.5, style: 'italic', colour: INK.muted, gap: 1.5 },
      meta,
      roleLabel
    );
  }

  cursor.y += 2.5;
}

export async function renderSopPdf(document: SopDocument, meta: SopPdfMeta): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' }) as Doc;
  const cursor: Cursor = { y: MARGIN.top, page: 1 };
  const roleLabel = document.roleLabel;

  // ---------------------------------------------------------------- cover
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setInk(doc, INK.rule);
  doc.text(meta.organisation.toUpperCase(), MARGIN.left, cursor.y);
  cursor.y += 3;
  rule(doc, cursor, INK.rule, 0.8);
  cursor.y += 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  setInk(doc, INK.strong);
  doc.text('Standard Operating', MARGIN.left, cursor.y);
  cursor.y += 11;
  doc.text('Procedure', MARGIN.left, cursor.y);
  cursor.y += 14;

  doc.setFontSize(15);
  setInk(doc, INK.accent);
  doc.text(roleLabel, MARGIN.left, cursor.y);
  cursor.y += 10;

  if (document.roleDescription) {
    paragraph(doc, cursor, document.roleDescription, { size: 10, style: 'normal', colour: INK.body, gap: 3 }, meta, roleLabel);
  }

  paragraph(
    doc,
    cursor,
    `${document.moduleCount} modules are available to this role, across ${document.sections.length} sections of MatrixIQ.`,
    { size: 9.5, style: 'normal', colour: INK.body, gap: 1 },
    meta,
    roleLabel
  );
  paragraph(doc, cursor, `Data you can see — ${document.dataScope}`, { size: 9.5, style: 'normal', colour: INK.body, gap: 1 }, meta, roleLabel);

  if (document.capabilities.length) {
    paragraph(
      doc,
      cursor,
      `Administrative rights — you can ${document.capabilities.join(', ')}.`,
      { size: 9.5, style: 'normal', colour: INK.body, gap: 1 },
      meta,
      roleLabel
    );
  }

  cursor.y += 4;
  paragraph(
    doc,
    cursor,
    `Generated from MatrixIQ on ${meta.generatedOn}. The permissions stated in this document are read from the live configuration, so regenerate it after any change in Role Management or Module Manager rather than editing it by hand.`,
    { size: 8.5, style: 'italic', colour: INK.muted },
    meta,
    roleLabel
  );

  // ------------------------------------------------------------- preamble
  newPage(doc, cursor, meta, roleLabel);
  for (const block of document.preamble) {
    paragraph(doc, cursor, block.heading, { size: 12, style: 'bold', colour: INK.strong, gap: 1.2 }, meta, roleLabel);
    for (const line of block.body) {
      paragraph(doc, cursor, line, { size: 9, style: 'normal', colour: INK.body, gap: 1.6 }, meta, roleLabel);
    }
    cursor.y += 3;
  }

  // -------------------------------------------------------------- modules
  for (const section of document.sections) {
    newPage(doc, cursor, meta, roleLabel);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    setInk(doc, INK.strong);
    doc.text(section.name, MARGIN.left, cursor.y);
    cursor.y += 3.5;
    rule(doc, cursor, INK.rule, 0.6);
    paragraph(
      doc,
      cursor,
      `${section.modules.length} ${section.modules.length === 1 ? 'module' : 'modules'} in this section.`,
      { size: 8.5, style: 'italic', colour: INK.muted, gap: 3 },
      meta,
      roleLabel
    );

    for (const page of section.modules) modulePage(doc, cursor, page, meta, roleLabel);
  }

  footer(doc, cursor, meta, roleLabel);
  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}
