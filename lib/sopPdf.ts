import { CLAUSE, SopDocument, SopModulePage } from './sopDocument';

// Rendering a role's SoP as a controlled document.
//
// jsPDF, the same stack as lib/deliveryChallanPdf.ts, lib/expenseVoucherPdf.ts
// and lib/pdf.ts — already a dependency, and the one the rest of this app's
// documents are drawn with.
//
// The layout is the conventional one for a procedure document, because the
// conventions carry information: a reader who has seen one SOP knows to look
// at the top right for the revision, at the foot for whether the copy in
// their hand is controlled, and in the contents for a clause number to quote.
// So:
//
//   page 1        title page — document control block and approval block
//   page 2..n     table of contents, with clause numbers and page numbers
//   then          clauses 1 to 11, the procedure itself being clause 8
//
// Every page after the title carries a running header (document number,
// title, revision, page x of y) and a footer (classification, the
// uncontrolled-when-printed notice, effective date). Both are stamped at the
// end, once the total page count is known.
//
// Two rules the body obeys throughout. Nothing is drawn without first asking
// whether the whole block fits, so a heading is never stranded at the foot of
// a page with its text overleaf. And a table that breaks across a page
// reprints its header row, because a column of values under no headings is
// not a table.
//
// Returns the bytes rather than triggering a download, so the same function
// serves the generator script (which uploads them) and any future
// download-from-the-browser path.

const PAGE = { width: 210, height: 297 };
const MARGIN = { left: 20, right: 18, top: 28, bottom: 22 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const RIGHT_EDGE = PAGE.width - MARGIN.right;

const HEADER_RULE_Y = 22;
const FOOTER_RULE_Y = PAGE.height - 17;
const FOOTER_TEXT_Y = PAGE.height - 12.5;

// Greyscale with one dark accent, which is what a controlled document looks
// like. Colour is reserved for the caution notices, where it carries meaning.
const INK = {
  strong: [17, 24, 39],
  body: [31, 41, 55],
  muted: [107, 114, 128],
  line: [148, 155, 165],
  hairline: [205, 210, 218],
  fill: [237, 240, 244],
  caution: [153, 27, 27]
} as const;

type Doc = import('jspdf').jsPDF;

interface Cursor {
  y: number;
}

interface TocEntry {
  level: 0 | 1 | 2;
  number: string;
  title: string;
  page: number;
}

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'center';
}

export interface SopPdfMeta {
  /** Printed on the title page, so a stale copy is identifiable. */
  generatedOn: string;
  /** The company name on the title page and in the header. */
  organisation: string;
}

function setInk(doc: Doc, colour: readonly number[]): void {
  doc.setTextColor(colour[0], colour[1], colour[2]);
}

function setLine(doc: Doc, colour: readonly number[], weight: number): void {
  doc.setDrawColor(colour[0], colour[1], colour[2]);
  doc.setLineWidth(weight);
}

function newPage(doc: Doc, cursor: Cursor): void {
  doc.addPage();
  cursor.y = MARGIN.top;
}

/**
 * Will `height` fit on this page? If not, turn it.
 *
 * Every draw goes through this, which is what stops a heading from being
 * orphaned from the text beneath it: the caller asks for the height of the
 * whole block, not of the next line.
 */
function ensure(doc: Doc, cursor: Cursor, height: number): void {
  if (cursor.y + height > PAGE.height - MARGIN.bottom) newPage(doc, cursor);
}

/** Wrapped text. Returns nothing; the cursor carries the position. */
function paragraph(
  doc: Doc,
  cursor: Cursor,
  text: string,
  opts: {
    size?: number;
    style?: 'normal' | 'bold' | 'italic';
    colour?: readonly number[];
    indent?: number;
    lead?: number;
    gap?: number;
    align?: 'left' | 'justify';
  } = {}
): void {
  const size = opts.size ?? 9;
  const style = opts.style ?? 'normal';
  const colour = opts.colour ?? INK.body;
  const indent = opts.indent ?? 0;
  const lead = opts.lead ?? size * 0.52;

  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent) as string[];
  // Measured before anything is drawn, so a three-line paragraph is never
  // split one line before the break.
  ensure(doc, cursor, lines.length * lead);
  setInk(doc, colour);
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  for (const line of lines) {
    doc.text(line, MARGIN.left + indent, cursor.y);
    cursor.y += lead;
  }
  cursor.y += opts.gap ?? 0;
}

/** A list item hanging-indented under its marker. */
function listItem(
  doc: Doc,
  cursor: Cursor,
  marker: string,
  text: string,
  opts: { size?: number; colour?: readonly number[]; indent?: number; markerWidth?: number } = {}
): void {
  const size = opts.size ?? 9;
  const colour = opts.colour ?? INK.body;
  const indent = opts.indent ?? 0;
  const markerWidth = opts.markerWidth ?? 8;
  const lead = size * 0.52;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent - markerWidth) as string[];
  ensure(doc, cursor, lines.length * lead + 0.8);

  setInk(doc, colour);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  doc.text(marker, MARGIN.left + indent, cursor.y);
  lines.forEach((line, i) => doc.text(line, MARGIN.left + indent + markerWidth, cursor.y + i * lead));
  cursor.y += lines.length * lead + 0.8;
}

/**
 * A run-in label and its text — "Purpose. Every sales project."
 *
 * Preferred over a sub-heading for the fields of a module clause: six
 * sub-headings per module, times sixty modules, would turn the procedure into
 * an index of headings with text between them.
 */
function runIn(doc: Doc, cursor: Cursor, label: string, text: string, opts: { size?: number; colour?: readonly number[] } = {}): void {
  const size = opts.size ?? 8.8;
  const lead = size * 0.52;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  const labelText = `${label} `;
  const labelWidth = doc.getTextWidth(labelText);

  doc.setFont('helvetica', 'normal');
  // The first line is short by the width of the label; the rest are full.
  const firstLine = doc.splitTextToSize(text, CONTENT_WIDTH - labelWidth) as string[];
  const head = firstLine[0] ?? '';
  const restText = text.slice(head.length).trim();
  const rest = restText ? (doc.splitTextToSize(restText, CONTENT_WIDTH) as string[]) : [];
  ensure(doc, cursor, (1 + rest.length) * lead + 0.6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  setInk(doc, INK.strong);
  doc.text(labelText, MARGIN.left, cursor.y);

  doc.setFont('helvetica', 'normal');
  setInk(doc, opts.colour ?? INK.body);
  doc.text(head, MARGIN.left + labelWidth, cursor.y);
  cursor.y += lead;
  for (const line of rest) {
    doc.text(line, MARGIN.left, cursor.y);
    cursor.y += lead;
  }
  cursor.y += 0.6;
}

/**
 * A bordered table whose header row reprints after a page break.
 *
 * Rows are measured cell by cell before anything is drawn, so a row with a
 * long cell is never cut in half.
 */
function table(doc: Doc, cursor: Cursor, columns: Column[], rows: string[][], opts: { size?: number } = {}): void {
  const size = opts.size ?? 8.2;
  const lead = size * 0.48;
  const padX = 1.8;
  const padY = 1.7;
  const headerHeight = lead + padY * 2 + 0.4;

  const xs: number[] = [];
  let x = MARGIN.left;
  for (const column of columns) {
    xs.push(x);
    x += column.width;
  }
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

  const drawHeader = (): void => {
    doc.setFillColor(INK.fill[0], INK.fill[1], INK.fill[2]);
    doc.rect(MARGIN.left, cursor.y, totalWidth, headerHeight, 'F');
    setLine(doc, INK.line, 0.25);
    doc.rect(MARGIN.left, cursor.y, totalWidth, headerHeight);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    setInk(doc, INK.strong);
    columns.forEach((column, i) => {
      if (i > 0) doc.line(xs[i], cursor.y, xs[i], cursor.y + headerHeight);
      const tx = column.align === 'center' ? xs[i] + column.width / 2 : xs[i] + padX;
      doc.text(column.label, tx, cursor.y + padY + lead * 0.78, column.align === 'center' ? { align: 'center' } : undefined);
    });
    cursor.y += headerHeight;
  };

  ensure(doc, cursor, headerHeight + lead * 2 + padY * 2);
  drawHeader();

  for (const row of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    const cells = columns.map((column, i) => doc.splitTextToSize(row[i] ?? '', column.width - padX * 2) as string[]);
    const height = Math.max(...cells.map((lines) => lines.length)) * lead + padY * 2;

    if (cursor.y + height > PAGE.height - MARGIN.bottom) {
      newPage(doc, cursor);
      drawHeader();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size);
    }

    setLine(doc, INK.hairline, 0.2);
    doc.rect(MARGIN.left, cursor.y, totalWidth, height);
    setInk(doc, INK.body);
    columns.forEach((column, i) => {
      if (i > 0) doc.line(xs[i], cursor.y, xs[i], cursor.y + height);
      const tx = column.align === 'center' ? xs[i] + column.width / 2 : xs[i] + padX;
      cells[i].forEach((line, l) =>
        doc.text(line, tx, cursor.y + padY + lead * 0.78 + l * lead, column.align === 'center' ? { align: 'center' } : undefined)
      );
    });
    cursor.y += height;
  }

  cursor.y += 3.5;
}

/** A boxed notice. Used where the document has to warn rather than instruct. */
function notice(doc: Doc, cursor: Cursor, heading: string, text: string, colour: readonly number[]): void {
  const size = 8.2;
  const lead = size * 0.52;
  const padX = 2.6;
  const padY = 2.4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - padX * 2 - 1) as string[];
  const height = (lines.length + 1) * lead + padY * 2;
  ensure(doc, cursor, height + 2);

  setLine(doc, colour, 0.3);
  doc.rect(MARGIN.left, cursor.y, CONTENT_WIDTH, height);
  // A heavier bar on the binding edge, so the box reads as a notice at a
  // glance rather than as another table.
  setLine(doc, colour, 1.1);
  doc.line(MARGIN.left + 0.55, cursor.y + 0.3, MARGIN.left + 0.55, cursor.y + height - 0.3);

  doc.setFont('helvetica', 'bold');
  setInk(doc, colour);
  doc.text(heading, MARGIN.left + padX, cursor.y + padY + lead * 0.78);
  doc.setFont('helvetica', 'normal');
  setInk(doc, INK.body);
  lines.forEach((line, i) => doc.text(line, MARGIN.left + padX, cursor.y + padY + lead * 0.78 + (i + 1) * lead));

  cursor.y += height + 3;
}

/** A top-level clause heading — "1.0  PURPOSE". */
function clauseHeading(doc: Doc, cursor: Cursor, number: string, title: string, toc: TocEntry[], startOnNewPage: boolean): void {
  if (startOnNewPage) newPage(doc, cursor);
  else ensure(doc, cursor, 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setInk(doc, INK.strong);
  doc.text(`${number}    ${title.toUpperCase()}`, MARGIN.left, cursor.y);
  cursor.y += 2.2;
  setLine(doc, INK.strong, 0.5);
  doc.line(MARGIN.left, cursor.y, RIGHT_EDGE, cursor.y);
  cursor.y += 5.2;

  toc.push({ level: 0, number, title, page: doc.getNumberOfPages() });
}

/** A second-level heading — "7.1  Account and attribution". */
function subHeading(doc: Doc, cursor: Cursor, number: string, title: string, toc: TocEntry[] | null, level: 1 | 2 = 1): void {
  const size = level === 1 ? 9.6 : 9.2;
  ensure(doc, cursor, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  setInk(doc, INK.strong);
  doc.text(`${number}    ${title}`, MARGIN.left, cursor.y);
  cursor.y += size * 0.52 + 1.4;
  if (toc) toc.push({ level, number, title, page: doc.getNumberOfPages() });
}

function clauseBlocks(doc: Doc, cursor: Cursor, parent: string, blocks: { index: string; title: string; body: string[] }[]): void {
  for (const block of blocks) {
    subHeading(doc, cursor, `${parent}.${block.index}`, block.title, null);
    block.body.forEach((line, i) => paragraph(doc, cursor, line, { gap: i === block.body.length - 1 ? 3.6 : 1.8 }));
  }
}

/** One module, as a sub-clause of clause 8. */
function moduleClause(doc: Doc, cursor: Cursor, page: SopModulePage, toc: TocEntry[]): void {
  // The clause number, its name and its first line of substance are kept
  // together: a heading alone at the foot of a page is what reads as broken.
  ensure(doc, cursor, 30);
  subHeading(doc, cursor, page.clause, page.label, toc, 2);

  runIn(doc, cursor, 'Purpose.', page.purpose);
  runIn(doc, cursor, 'System location.', page.location);

  if (page.departments.length) {
    runIn(doc, cursor, 'Departmental restriction.', `Available only to the following departments: ${page.departments.join(', ')}.`);
  }

  // Generated from the role's real permission matrix, which is the whole
  // reason this document is per-role rather than one manual for everybody.
  // Granted and refused are printed only where the matrix actually says so —
  // see rightsNote for why "not mentioned" must not read as "not allowed".
  if (page.can.length) runIn(doc, cursor, 'Authorised actions.', `The role may ${page.can.join('; ')}.`);
  if (page.cannot.length) runIn(doc, cursor, 'Restricted actions.', `The role may not ${page.cannot.join('; ')}.`);
  runIn(doc, cursor, 'Permission basis.', page.rightsNote, { colour: INK.muted });

  // Two screens disagreeing about one module. Stated before the procedure,
  // because somebody following the steps will hit a wall and should know why
  // beforehand rather than afterwards.
  if (page.viewDenied) {
    notice(
      doc,
      cursor,
      'CAUTION — CONFLICTING CONFIGURATION',
      'This module is shown to the role in Module Manager (R2), while the permission matrix (R1) explicitly refuses the role "view" on it. The two settings disagree. The role holder shall expect to be refused access and shall raise the conflict under clause ' +
        CLAUSE.nonConformance +
        ' before following the procedure below.',
      INK.caution
    );
  }

  if (page.steps.length) {
    cursor.y += 1.2;
    table(
      doc,
      cursor,
      [
        { label: 'Step', width: 15, align: 'center' },
        { label: 'Action', width: CONTENT_WIDTH - 15 }
      ],
      page.steps.map((step, i) => [String(i + 1), step])
    );
  }

  if (page.rules.length) {
    paragraph(doc, cursor, 'Controls', { size: 8.8, style: 'bold', colour: INK.strong, gap: 1.2 });
    page.rules.forEach((rule, i) => listItem(doc, cursor, `(${String.fromCharCode(97 + i)})`, rule, { size: 8.8, markerWidth: 7 }));
    cursor.y += 2;
  }

  // Stated plainly rather than padded with a plausible-sounding procedure. A
  // confidently wrong step is worse than an admitted gap, because somebody
  // will follow it.
  if (page.procedurePending) {
    notice(
      doc,
      cursor,
      'PROCEDURE NOT YET ISSUED',
      'No step-by-step procedure has been issued for this module. Everything stated above is extracted from the live configuration and is accurate. The working steps are to be supplied by the function that owns this module and will appear at the next reissue of this document.',
      INK.muted
    );
  }

  cursor.y += 2.5;
}

/** How many entries fit on the first contents page, and on each one after. */
const TOC_LEAD = 4.5;
const TOC_FIRST_PAGE = Math.floor((PAGE.height - MARGIN.top - MARGIN.bottom - 12) / TOC_LEAD);
const TOC_LATER_PAGE = Math.floor((PAGE.height - MARGIN.top - MARGIN.bottom) / TOC_LEAD);

/** Split the contents into pages, so the same arithmetic reserves and fills. */
function paginateToc(count: number): number {
  if (count <= TOC_FIRST_PAGE) return 1;
  return 1 + Math.ceil((count - TOC_FIRST_PAGE) / TOC_LATER_PAGE);
}

function drawToc(doc: Doc, entries: TocEntry[], firstPage: number): void {
  let page = firstPage;
  doc.setPage(page);
  let y = MARGIN.top;
  let room = TOC_FIRST_PAGE;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setInk(doc, INK.strong);
  doc.text('CONTENTS', MARGIN.left, y);
  y += 2.2;
  setLine(doc, INK.strong, 0.5);
  doc.line(MARGIN.left, y, RIGHT_EDGE, y);
  y += 6.6;

  for (const entry of entries) {
    if (room <= 0) {
      page += 1;
      doc.setPage(page);
      y = MARGIN.top;
      room = TOC_LATER_PAGE;
    }

    const indent = entry.level === 0 ? 0 : entry.level === 1 ? 7 : 14;
    const size = entry.level === 0 ? 8.8 : 8.3;
    doc.setFont('helvetica', entry.level === 0 ? 'bold' : 'normal');
    doc.setFontSize(size);
    setInk(doc, entry.level === 0 ? INK.strong : INK.body);

    const numberX = MARGIN.left + indent;
    doc.text(entry.number, numberX, y);
    const titleX = numberX + (entry.level === 0 ? 13 : entry.level === 1 ? 13 : 16);
    const pageLabel = String(entry.page);
    const pageWidth = doc.getTextWidth(pageLabel);
    const titleRoom = RIGHT_EDGE - titleX - pageWidth - 4;
    const title = (doc.splitTextToSize(entry.title, titleRoom) as string[])[0] ?? entry.title;
    doc.text(title, titleX, y);

    // Dot leaders, which are what makes a long contents list readable.
    const titleWidth = doc.getTextWidth(title);
    const leaderStart = titleX + titleWidth + 1.6;
    const leaderEnd = RIGHT_EDGE - pageWidth - 1.6;
    if (leaderEnd > leaderStart) {
      setLine(doc, INK.hairline, 0.2);
      doc.setLineDashPattern([0.3, 1.1], 0);
      doc.line(leaderStart, y - 0.8, leaderEnd, y - 0.8);
      doc.setLineDashPattern([], 0);
    }

    setInk(doc, entry.level === 0 ? INK.strong : INK.body);
    doc.text(pageLabel, RIGHT_EDGE, y, { align: 'right' });

    y += TOC_LEAD;
    room -= 1;
  }
}

function titlePage(doc: Doc, cursor: Cursor, document: SopDocument, meta: SopPdfMeta): void {
  const control = document.control;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setInk(doc, INK.strong);
  doc.text(meta.organisation.toUpperCase(), MARGIN.left, cursor.y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  setInk(doc, INK.muted);
  doc.text('MatrixIQ — Internal Business Application', RIGHT_EDGE, cursor.y, { align: 'right' });
  cursor.y += 2.6;
  setLine(doc, INK.strong, 0.8);
  doc.line(MARGIN.left, cursor.y, RIGHT_EDGE, cursor.y);
  cursor.y += 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setInk(doc, INK.muted);
  doc.text('STANDARD OPERATING PROCEDURE', MARGIN.left, cursor.y);
  cursor.y += 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(23);
  setInk(doc, INK.strong);
  const titleLines = doc.splitTextToSize(document.roleLabel, CONTENT_WIDTH) as string[];
  for (const line of titleLines) {
    doc.text(line, MARGIN.left, cursor.y);
    cursor.y += 10.5;
  }
  cursor.y += 1.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setInk(doc, INK.body);
  doc.text(`Role-specific procedure for users of MatrixIQ holding the ${document.roleLabel} role`, MARGIN.left, cursor.y);
  cursor.y += 6;

  if (document.roleDescription) {
    paragraph(doc, cursor, document.roleDescription, { size: 9, colour: INK.muted, gap: 4 });
  }

  cursor.y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.6);
  setInk(doc, INK.strong);
  doc.text('DOCUMENT CONTROL', MARGIN.left, cursor.y);
  cursor.y += 3.4;

  table(
    doc,
    cursor,
    [
      { label: 'Field', width: 48 },
      { label: 'Particulars', width: CONTENT_WIDTH - 48 }
    ],
    [
      ['Document number', control.documentNumber],
      ['Document title', control.documentTitle],
      ['Revision number', control.revision],
      ['Effective date', control.effectiveDate || '—'],
      ['Next review due', control.nextReviewDate || '—'],
      ['Supersedes', control.supersedes],
      ['Applies to', control.functionalOwner],
      ['Classification', control.classification],
      ['Issued by', `${control.issuedBy}, from the live MatrixIQ configuration on ${meta.generatedOn}`]
    ]
  );

  cursor.y += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.6);
  setInk(doc, INK.strong);
  doc.text('APPROVAL', MARGIN.left, cursor.y);
  cursor.y += 3.4;

  const quarter = (CONTENT_WIDTH - 28) / 3;
  table(
    doc,
    cursor,
    [
      { label: '', width: 28 },
      { label: 'Prepared by', width: quarter },
      { label: 'Reviewed by', width: quarter },
      { label: 'Approved by', width: quarter }
    ],
    [
      ['Name', control.issuedBy, '', ''],
      ['Designation', 'Automated issue', '', ''],
      ['Signature', 'Not applicable', '', ''],
      ['Date', control.effectiveDate || '—', '', '']
    ]
  );

  paragraph(
    doc,
    cursor,
    `This document is confidential to ${meta.organisation} and is issued for internal use only. It is generated from the live MatrixIQ configuration and shall not be amended by hand; a change to the role permission matrix or the module register renders this revision void and requires reissue. Printed copies are uncontrolled.`,
    { size: 7.8, style: 'italic', colour: INK.muted }
  );
}

function runningHeader(doc: Doc, document: SopDocument, pageNumber: number, total: number): void {
  const control = document.control;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  setInk(doc, INK.muted);
  doc.text(control.documentNumber, MARGIN.left, HEADER_RULE_Y - 4);
  doc.text(control.documentTitle, PAGE.width / 2, HEADER_RULE_Y - 4, { align: 'center' });
  doc.text(`Rev. ${control.revision}  |  Page ${pageNumber} of ${total}`, RIGHT_EDGE, HEADER_RULE_Y - 4, { align: 'right' });
  setLine(doc, INK.hairline, 0.3);
  doc.line(MARGIN.left, HEADER_RULE_Y, RIGHT_EDGE, HEADER_RULE_Y);
}

function runningFooter(doc: Doc, document: SopDocument, meta: SopPdfMeta, pageNumber: number, total: number): void {
  const control = document.control;
  setLine(doc, INK.hairline, 0.3);
  doc.line(MARGIN.left, FOOTER_RULE_Y, RIGHT_EDGE, FOOTER_RULE_Y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  setInk(doc, INK.muted);
  doc.text(control.classification, MARGIN.left, FOOTER_TEXT_Y);
  doc.text('Uncontrolled when printed', PAGE.width / 2, FOOTER_TEXT_Y, { align: 'center' });
  const right =
    pageNumber === 1
      ? `Issued ${control.effectiveDate || meta.generatedOn}  |  Page ${pageNumber} of ${total}`
      : `Effective ${control.effectiveDate || meta.generatedOn}`;
  doc.text(right, RIGHT_EDGE, FOOTER_TEXT_Y, { align: 'right' });
}

export async function renderSopPdf(document: SopDocument, meta: SopPdfMeta): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' }) as Doc;
  doc.setProperties({
    title: `${document.control.documentNumber} — ${document.control.documentTitle}`,
    subject: `MatrixIQ Standard Operating Procedure, revision ${document.control.revision}`,
    author: meta.organisation,
    creator: 'MatrixIQ'
  });

  const cursor: Cursor = { y: MARGIN.top };
  const toc: TocEntry[] = [];

  // --------------------------------------------------------------- page 1
  titlePage(doc, cursor, document, meta);

  // ------------------------------------------------------------- contents
  // Reserved now and filled at the end, when the page numbers it cites are
  // known. The count is exact — one entry per clause, per procedure section
  // and per module — so the same arithmetic that reserves the pages fills
  // them.
  const tocEntryCount =
    Object.keys(CLAUSE).length + document.sections.length + document.sections.reduce((sum, section) => sum + section.modules.length, 0);
  const tocPageCount = paginateToc(tocEntryCount);
  const tocFirstPage = doc.getNumberOfPages() + 1;
  for (let i = 0; i < tocPageCount; i += 1) doc.addPage();

  // Content starts on a fresh page after the reserved ones. addPage appends
  // here because the reserved pages are the last in the document — which is
  // why the contents are filled only after everything else is drawn.
  newPage(doc, cursor);

  // ------------------------------------------------------- 1.0 and 2.0
  clauseHeading(doc, cursor, CLAUSE.purpose, 'Purpose', toc, false);
  document.purpose.forEach((line) => paragraph(doc, cursor, line, { gap: 2 }));
  cursor.y += 2;

  clauseHeading(doc, cursor, CLAUSE.scope, 'Scope', toc, false);
  document.scope.body.forEach((line) => paragraph(doc, cursor, line, { gap: 2.4 }));
  paragraph(doc, cursor, 'Within scope:', { size: 8.8, style: 'bold', colour: INK.strong, gap: 1.2 });
  document.scope.inScope.forEach((line, i) => listItem(doc, cursor, `${CLAUSE.scope.replace('.0', '')}.1.${i + 1}`, line, { markerWidth: 14 }));
  cursor.y += 2.2;
  paragraph(doc, cursor, 'Outside scope:', { size: 8.8, style: 'bold', colour: INK.strong, gap: 1.2 });
  document.scope.outOfScope.forEach((line, i) => listItem(doc, cursor, `${CLAUSE.scope.replace('.0', '')}.2.${i + 1}`, line, { markerWidth: 14 }));
  cursor.y += 3;

  // --------------------------------------------------------------- 3.0
  clauseHeading(doc, cursor, CLAUSE.references, 'Reference documents', toc, false);
  paragraph(doc, cursor, 'The following are the controlled sources from which this document is derived. They are cited in the clauses below by reference code.', {
    gap: 2.6
  });
  table(
    doc,
    cursor,
    [
      { label: 'Ref.', width: 14, align: 'center' },
      { label: 'Controlled source', width: 76 },
      { label: 'Held in', width: CONTENT_WIDTH - 90 }
    ],
    document.references.map((reference) => [reference.ref, reference.source, reference.heldIn])
  );

  // --------------------------------------------------------------- 4.0
  clauseHeading(doc, cursor, CLAUSE.definitions, 'Definitions and abbreviations', toc, false);
  table(
    doc,
    cursor,
    [
      { label: 'Term', width: 42 },
      { label: 'Meaning in MatrixIQ', width: CONTENT_WIDTH - 42 }
    ],
    document.definitions.map((definition) => [definition.term, definition.meaning])
  );

  // --------------------------------------------------------------- 5.0
  clauseHeading(doc, cursor, CLAUSE.responsibility, 'Responsibility and authority', toc, false);
  table(
    doc,
    cursor,
    [
      { label: 'Party', width: 48 },
      { label: 'Responsibility', width: CONTENT_WIDTH - 48 }
    ],
    document.responsibilities.map((row) => [row.party, row.responsibility])
  );

  // --------------------------------------------------------------- 6.0
  clauseHeading(doc, cursor, CLAUSE.access, 'System access and data visibility', toc, false);
  paragraph(doc, cursor, 'The following is extracted from the live configuration at the time of issue and states the access actually held by this role.', {
    gap: 2.6
  });
  table(
    doc,
    cursor,
    [
      { label: 'Attribute', width: 44 },
      { label: 'Provision', width: CONTENT_WIDTH - 44 }
    ],
    document.accessRows.map((row) => [row.attribute, row.provision])
  );

  // --------------------------------------------------------------- 7.0
  clauseHeading(doc, cursor, CLAUSE.general, 'General requirements', toc, true);
  paragraph(doc, cursor, 'The requirements of this clause apply to the account holder at all times and are not repeated in the procedure.', { gap: 3.2 });
  clauseBlocks(doc, cursor, CLAUSE.general.replace('.0', ''), document.generalRequirements);

  // --------------------------------------------------------------- 8.0
  clauseHeading(doc, cursor, CLAUSE.procedure, 'Procedure', toc, true);
  paragraph(
    doc,
    cursor,
    `This clause covers the ${document.moduleCount} modules available to this role, in the order in which they appear in the MatrixIQ navigation. Each sub-clause states the purpose of the module, where it is found, what the role is authorised to do in it, the steps to be followed, and the controls that apply.`,
    { gap: 3.4 }
  );

  for (const section of document.sections) {
    // Each functional group starts its own page: it is the unit a reader
    // looks something up in, and a procedure that starts halfway down the
    // page under the tail of another one is hard to find again.
    newPage(doc, cursor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.4);
    setInk(doc, INK.strong);
    doc.text(`${section.clause}    ${section.name.toUpperCase()}`, MARGIN.left, cursor.y);
    cursor.y += 2.2;
    setLine(doc, INK.line, 0.4);
    doc.line(MARGIN.left, cursor.y, RIGHT_EDGE, cursor.y);
    cursor.y += 4.6;
    toc.push({ level: 1, number: section.clause, title: section.name, page: doc.getNumberOfPages() });

    paragraph(
      doc,
      cursor,
      section.modules.length === 1
        ? `This group comprises one module, at clause ${section.modules[0].clause}.`
        : `This group comprises ${section.modules.length} modules, at clauses ${section.modules[0].clause} to ${
            section.modules[section.modules.length - 1].clause
          }.`,
      { size: 8, style: 'italic', colour: INK.muted, gap: 3.2 }
    );

    for (const page of section.modules) moduleClause(doc, cursor, page, toc);
  }

  // -------------------------------------------------------- 9.0 to 11.0
  clauseHeading(doc, cursor, CLAUSE.records, 'Records', toc, true);
  paragraph(doc, cursor, 'The following records are generated under this procedure. All are held within the application; none is to be maintained separately.', {
    gap: 2.6
  });
  table(
    doc,
    cursor,
    [
      { label: 'Record', width: 62 },
      { label: 'System location', width: 44 },
      { label: 'Retention', width: CONTENT_WIDTH - 106 }
    ],
    document.records.map((record) => [record.record, record.location, record.retention])
  );

  clauseHeading(doc, cursor, CLAUSE.nonConformance, 'Non-conformance and escalation', toc, false);
  clauseBlocks(doc, cursor, CLAUSE.nonConformance.replace('.0', ''), document.nonConformance);

  clauseHeading(doc, cursor, CLAUSE.revision, 'Revision history', toc, false);
  table(
    doc,
    cursor,
    [
      { label: 'Rev.', width: 14, align: 'center' },
      { label: 'Date', width: 26 },
      { label: 'Description of change', width: CONTENT_WIDTH - 40 - 32 },
      { label: 'Issued by', width: 32 }
    ],
    document.revisionHistory.map((entry) => [entry.revision, entry.date || '—', entry.summary, entry.issuedBy])
  );
  paragraph(
    doc,
    cursor,
    'This document is reissued in full on each revision. Revisions are produced from the live MatrixIQ configuration; where the configuration has changed, the superseded revision is void from the effective date above.',
    { size: 7.8, style: 'italic', colour: INK.muted }
  );

  // --------------------------------------------------- contents, then furniture
  drawToc(doc, toc, tocFirstPage);

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    // The title page carries the control block instead of a running header,
    // which is the convention — repeating the document number above a block
    // that states it would be noise.
    if (page > 1) runningHeader(doc, document, page, total);
    runningFooter(doc, document, meta, page, total);
  }

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}
