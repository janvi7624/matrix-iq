import { readFile } from 'fs/promises';
import path from 'path';
import { DailyReportFieldDef, TemplateDefinition, computeMatrixTotals, isFieldVisible } from './dailyReportTemplates';
import { DailyReportRecord, TeamDailyReportRangeRow } from './dailyReportTypes';
import { formatIstClock, formatIstDate, formatIstDateTime, formatIstWeekday } from './dailyReportTime';

// The CONTENT of daily reports as a formal PDF — what each person actually
// wrote, day by day — as opposed to the compliance count table the Team page's
// "Summary PDF" produces.
//
// Layout (portrait A4, company letterhead on every page):
//   1. Cover      — report particulars, department-wise summary, employee index.
//   2. Department — one section per department, opening with its own summary.
//   3. Employee   — particulars box, then every filed day under a date bar,
//                   then a "Reviewed by" sign-off block.
//
// The caller (app/api/daily-reports/export-pdf) has already decided whose
// reports the viewer may read; this only lays them out.

type Doc = import('jspdf').jsPDF;
type AutoTable = (doc: Doc, options: Record<string, unknown>) => void;
type RGB = [number, number, number];

export interface DailyReportPdfInput {
  title: string;
  /** What the export covers, e.g. "All departments", "AI department", "Priya Shah". */
  scopeLabel?: string;
  from: string;
  to: string;
  generatedBy: string;
  reports: DailyReportRecord[];
  /** Keyed `${department_id}|${template_key}`, as listFiledReportsForExport returns. */
  templates: Map<string, TemplateDefinition>;
  truncated: boolean;
  /**
   * Per-employee compliance for the period, from the same calculation as the
   * Team Daily Reports screen (computeDailyReportRangeSummary) plus active
   * warnings — drives both summary tables so they always match the screen.
   */
  summary: TeamDailyReportRangeRow[];
}

const COMPANY = 'NANTA TECH LIMITED';
const ADDRESS = '205, F Block, Shivalik Sharda Harmony, Panjarapole Cross Rd, Ambawadi, Ahmedabad, Gujarat - 380015';

const INK: RGB = [17, 24, 39];
const BODY: RGB = [55, 65, 81];
const MUTED: RGB = [107, 114, 128];
const RULE: RGB = [209, 213, 219];
const NAVY: RGB = [30, 41, 59];
const BAND: RGB = [241, 245, 249];
const ACCENT: RGB = [185, 28, 28];
const GREEN: RGB = [21, 128, 61];

const M = 15; // side margin, mm
const TOP = 34; // first content line under the letterhead
const BOTTOM = 18; // reserved for the footer

function isLate(r: DailyReportRecord): boolean {
  return r.is_late || r.submission_status === 'SUBMITTED_LATE';
}

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—';
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (typeof value === 'object') return '';
  return String(value).trim();
}

function fieldText(field: DailyReportFieldDef, value: unknown, derived: object | undefined): string {
  if (field.type === 'computed') {
    const d = (derived ?? {}) as Record<string, unknown>;
    if (field.computed === 'entry_code') return asText(d.task_code);
    if (field.computed === 'days_left') return asText(d.days_left);
    return '';
  }
  const text = asText(value);
  if (!text) return '';
  if (field.type === 'date') return formatIstDate(text);
  if (field.type === 'time') return formatIstClock(text);
  return text;
}

async function loadLogo(): Promise<string | null> {
  try {
    const bytes = await readFile(path.join(process.cwd(), 'public', 'NANTA.png'));
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

class Writer {
  y = TOP;
  readonly width: number;
  readonly height: number;

  constructor(
    readonly doc: Doc,
    readonly autoTable: AutoTable
  ) {
    this.width = doc.internal.pageSize.getWidth();
    this.height = doc.internal.pageSize.getHeight();
  }

  get inner(): number {
    return this.width - M * 2;
  }

  newPage(): void {
    this.doc.addPage();
    this.y = TOP;
  }

  ensure(needed: number): void {
    if (this.y + needed > this.height - BOTTOM) this.newPage();
  }

  afterTable(gap = 4): void {
    const last = (this.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    if (last) this.y = last.finalY + gap;
  }

  font(style: 'normal' | 'bold' | 'italic', size: number, color: RGB = BODY): void {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  /** Small-caps style section heading with a rule under it. */
  heading(text: string): void {
    this.ensure(14);
    this.font('bold', 10, NAVY);
    this.doc.text(text.toUpperCase(), M, this.y);
    this.doc.setDrawColor(...NAVY);
    this.doc.setLineWidth(0.4);
    this.doc.line(M, this.y + 1.8, this.width - M, this.y + 1.8);
    this.y += 6;
  }

  table(options: Record<string, unknown>, gap = 4): void {
    const columnStyles = (options.columnStyles ?? {}) as Record<number, { halign?: string }>;
    this.autoTable(this.doc, {
      startY: this.y,
      margin: { left: M, right: M, top: TOP, bottom: BOTTOM },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: BODY, lineColor: RULE, lineWidth: 0.2, valign: 'top', overflow: 'linebreak' },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', lineColor: NAVY },
      didParseCell: (data: { section: string; column: { index: number }; cell: { styles: Record<string, unknown> } }) => {
        // Header and footer cells follow the body column alignment, so a
        // centred number column has a centred heading.
        const halign = columnStyles[data.column.index]?.halign;
        if (halign && data.section !== 'body') data.cell.styles.halign = halign;
      },
      ...options
    });
    this.afterTable(gap);
  }

  /** Two-column "particulars" box: label | value, label | value. */
  particulars(pairs: [string, string][]): void {
    const rows: string[][] = [];
    for (let i = 0; i < pairs.length; i += 2) {
      const a = pairs[i];
      const b = pairs[i + 1] ?? ['', ''];
      rows.push([a[0], a[1], b[0], b[1]]);
    }
    const labelW = 32;
    const valueW = this.inner / 2 - labelW;
    this.table({
      body: rows,
      styles: { fontSize: 8.5, cellPadding: 2, textColor: INK, lineColor: RULE, lineWidth: 0.2 },
      columnStyles: {
        0: { cellWidth: labelW, fontStyle: 'bold', fillColor: BAND, textColor: NAVY },
        1: { cellWidth: valueW },
        2: { cellWidth: labelW, fontStyle: 'bold', fillColor: BAND, textColor: NAVY },
        3: { cellWidth: valueW }
      }
    });
  }
}

function drawLetterheads(doc: Doc, logo: string | null, period: string, stamp: string): void {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);

    // Header: logo + company block left, document title right.
    let textX = M;
    if (logo) {
      doc.addImage(logo, 'PNG', M, 8, 22, 15, undefined, 'FAST');
      textX = M + 25;
    }
    doc.setFont('times', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(COMPANY, textX, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(ADDRESS, 95), textX, 18.5);

    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...ACCENT);
    doc.text('DAILY WORK REPORT', w - M, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(period, w - M, 18.5, { align: 'right' });

    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.7);
    doc.line(M, 25.5, w - M, 25.5);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(M, 26.6, w - M, 26.6);

    // Footer.
    doc.setDrawColor(...RULE);
    doc.line(M, h - 12, w - M, h - 12);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`Confidential — for internal use only  |  ${stamp}`, M, h - 7.5);
    doc.text(`Page ${i} of ${pages}`, w - M, h - 7.5, { align: 'right' });
  }
}

function drawReport(wr: Writer, report: DailyReportRecord, template: TemplateDefinition | undefined): void {
  const { doc } = wr;
  wr.ensure(22);

  // Date bar: shaded band, date on the left, status on the right.
  doc.setFillColor(...BAND);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.rect(M, wr.y - 4.2, wr.inner, 6.6, 'FD');
  doc.setFillColor(...(isLate(report) ? ACCENT : GREEN));
  doc.rect(M, wr.y - 4.2, 1.2, 6.6, 'F');
  wr.font('bold', 9.5, INK);
  doc.text(`${formatIstWeekday(report.report_date)}, ${formatIstDate(report.report_date)}`, M + 3.5, wr.y);
  const status: string[] = [isLate(report) ? 'SUBMITTED LATE' : 'SUBMITTED ON TIME'];
  if (report.submitted_at) status.push(formatIstDateTime(new Date(report.submitted_at)));
  if (report.filed_by_name) status.push(`Filed by ${report.filed_by_name}`);
  wr.font('bold', 7.5, isLate(report) ? ACCENT : GREEN);
  doc.text(status.join('  ·  '), wr.width - M - 2.5, wr.y, { align: 'right' });
  wr.y += 5;

  if (!template) {
    wr.font('italic', 8.5, MUTED);
    doc.text('The template for this report could not be resolved.', M, wr.y + 3);
    wr.y += 9;
    return;
  }

  // Whole-day fields as label / value. Blank ones are left out — a printed
  // report states what happened, not every empty box on the form.
  const headerRows = template.headerFields
    .filter((f) => !f.hidden && isFieldVisible(f, report.payload))
    .map((f) => [f.label, fieldText(f, report.payload[f.key], report.header_derived)])
    .filter(([, v]) => v !== '');
  if (headerRows.length) {
    wr.table({
      body: headerRows,
      columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold', fillColor: [250, 250, 251], textColor: NAVY } }
    }, 3);
  }

  let wroteContent = headerRows.length > 0;

  if (template.layout === 'rows') {
    // Task ID (the auto entry code) is left out of the PDF for every
    // department — it is an internal reference nobody reading the report uses.
    const fields = template.rowFields.filter((f) => !f.hidden && !(f.type === 'computed' && f.computed === 'entry_code'));
    if (report.entries.length && fields.length) {
      // Columns every entry left blank are dropped, so a wide template does
      // not print as a page of empty columns.
      const body = report.entries.map((entry, i) => [
        String(i + 1),
        ...fields.map((f) => (isFieldVisible(f, entry.data) ? fieldText(f, entry.data[f.key], entry.derived) : ''))
      ]);
      const keep = [true, ...fields.map((_, i) => body.some((row) => row[i + 1] !== ''))];
      const head = ['#', ...fields.map((f) => f.label)].filter((_, i) => keep[i]);
      // Fixed widths for short, predictable columns so dates and codes stay
      // on one line; free text columns share whatever is left.
      const keptFields = fields.filter((_, i) => keep[i + 1]);
      const widthFor = (f: DailyReportFieldDef): Record<string, unknown> | null => {
        if (f.type === 'computed' && f.computed === 'entry_code') return { cellWidth: 27 };
        if (f.type === 'computed' && f.computed === 'days_left') return { cellWidth: 11, halign: 'center' };
        if (f.type === 'date') return { cellWidth: 19 };
        if (f.type === 'time') return { cellWidth: 15 };
        if (f.type === 'number') return { cellWidth: 14, halign: 'center' };
        if (f.type === 'select' && !f.multiple) return { cellWidth: 17 };
        return null;
      };
      // Helvetica has no ₹ glyph (it prints as "¹") — spell it out.
      const clean = (t: string) => t.replace(/₹/g, 'Rs.');

      // Too many columns for a portrait page squeezes text into one-letter
      // strips (GEM-Sales has 11). Past 7 columns, print each entry as its own
      // card instead: a header bar with the entry number, then label | value
      // pairs two per row, so every field stays readable.
      if (head.length > 7) {
        const shown = keptFields;
        report.entries.forEach((entry, idx) => {
          const pairs = shown
            .map((f) => [clean(f.label), clean(isFieldVisible(f, entry.data) ? fieldText(f, entry.data[f.key], entry.derived) : '')] as [string, string])
            .filter(([, v]) => v !== '');
          const rows: string[][] = [];
          for (let i = 0; i < pairs.length; i += 2) rows.push([...pairs[i], ...(pairs[i + 1] ?? ['', ''])]);
          const labelW = 30;
          const valueW = (wr.inner - labelW * 2) / 2;
          wr.table(
            {
              head: [[{ content: `Entry ${idx + 1} of ${report.entries.length}`, colSpan: 4 }]],
              body: rows,
              styles: { fontSize: 8, cellPadding: 1.8, textColor: BODY, lineColor: RULE, lineWidth: 0.2, valign: 'top', overflow: 'linebreak' },
              headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
              rowPageBreak: 'avoid',
              columnStyles: {
                0: { cellWidth: labelW, fontStyle: 'bold', fillColor: BAND, textColor: NAVY },
                1: { cellWidth: valueW },
                2: { cellWidth: labelW, fontStyle: 'bold', fillColor: BAND, textColor: NAVY },
                3: { cellWidth: valueW }
              }
            },
            2.5
          );
        });
        wr.y += 4;
        return;
      }

      const rowColumnStyles: Record<number, Record<string, unknown>> = { 0: { cellWidth: 7, halign: 'center', textColor: MUTED } };
      keptFields.forEach((f, i) => {
        const style = widthFor(f);
        if (style) rowColumnStyles[i + 1] = style;
      });
      wr.table({
        head: [head.map(clean)],
        body: body.map((row) => row.filter((_, i) => keep[i]).map(clean)),
        styles: { fontSize: 7.8, cellPadding: 1.6, textColor: BODY, lineColor: RULE, lineWidth: 0.2, valign: 'top', overflow: 'linebreak' },
        headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.8 },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        rowPageBreak: 'avoid',
        columnStyles: rowColumnStyles
      }, 3);
      wroteContent = true;
    }
  } else if (template.layout === 'matrix') {
    const measures = template.measures ?? [];
    const channels = template.channels ?? [];
    if (measures.length && channels.length) {
      const totals = computeMatrixTotals(template, report.matrix);
      const body = measures
        .filter((m) => totals.byMeasure[m] > 0)
        .map((m) => [m, ...channels.map((c) => String(Number(report.matrix?.[m]?.[c]) || 0)), String(totals.byMeasure[m])]);
      if (body.length) {
        wr.table({
          head: [['Activity', ...channels, 'Total']],
          body,
          foot: [['Total', ...channels.map((c) => String(totals.byChannel[c])), String(totals.overall)]],
          footStyles: { fillColor: BAND, textColor: INK, fontStyle: 'bold' },
          showFoot: 'lastPage',
          columnStyles: Object.fromEntries([
            ...channels.map((_, i): [number, Record<string, unknown>] => [i + 1, { halign: 'center', cellWidth: 24 }]),
            [channels.length + 1, { halign: 'center', cellWidth: 24, fontStyle: 'bold' }] as [number, Record<string, unknown>]
          ])
        }, 3);
        wroteContent = true;
      }
    }
  }

  if (!wroteContent) {
    wr.font('italic', 8.5, MUTED);
    doc.text('No details were entered for this day.', M + 3.5, wr.y + 1);
    wr.y += 5;
  }
  wr.y += 4;
}

function drawSignOff(wr: Writer, employeeName: string): void {
  const { doc } = wr;
  if (wr.y + 30 > wr.height - BOTTOM) {
    // Never leave the sign-off on a page with nothing saying whose it is.
    wr.newPage();
    wr.font('bold', 9, NAVY);
    doc.text(`Employee: ${employeeName} (continued) — Acknowledgement`, M, wr.y);
    wr.y += 4;
  } else {
    wr.y += 6;
  }
  wr.font('italic', 7.5, MUTED);
  doc.text('I confirm the above is a true record of the work reported for this period.', M, wr.y);
  wr.y += 2;
  const colW = wr.inner / 3;
  const labels = ['Employee Signature', 'Reviewed by (Manager)', 'Date'];
  doc.setDrawColor(...BODY);
  doc.setLineWidth(0.3);
  labels.forEach((label, i) => {
    const x = M + i * colW;
    doc.line(x + 4, wr.y + 8, x + colW - 6, wr.y + 8);
    wr.font('normal', 7.5, MUTED);
    doc.text(label, x + 4, wr.y + 12);
  });
  wr.y += 18;
}

export async function buildDailyReportPdf(input: DailyReportPdfInput): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = (await import('jspdf-autotable')) as unknown as { autoTable: AutoTable };
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const wr = new Writer(doc, autoTable);
  const logo = await loadLogo();

  const period = `${formatIstDate(input.from)} to ${formatIstDate(input.to)}`;
  const generatedAt = formatIstDateTime(new Date());

  // Department -> employee -> reports (reports already in date order).
  const departments = new Map<string, { name: string; people: Map<string, DailyReportRecord[]> }>();
  for (const r of input.reports) {
    const dept = departments.get(r.department_id) ?? { name: r.department_name || 'Unassigned', people: new Map() };
    const list = dept.people.get(r.employee_id) ?? [];
    list.push(r);
    dept.people.set(r.employee_id, list);
    departments.set(r.department_id, dept);
  }
  const deptList = [...departments.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({
      name: d.name,
      people: [...d.people.values()].sort((a, b) => a[0].employee_name.localeCompare(b[0].employee_name))
    }));
  // Every number below comes from input.summary — the SAME calculation as the
  // Team Daily Reports screen and its Summary PDF (computeDailyReportRangeSummary)
  // — so the three can never disagree. See TeamDailyReportRangeRow for what
  // each field means. Per employee, always:
  //   filed + missing + on leave + before joining = report days.
  const sumRows = input.summary ?? [];
  const S = (k: 'submitted' | 'submitted_late' | 'missing' | 'leave_covered' | 'leave_pending' | 'before_joining' | 'filed_on_off_day' | 'warnings_missed' | 'warnings_zero_activity' | 'expected', rows = sumRows) =>
    rows.reduce((n, r) => n + r[k], 0);
  const periodReportDays = sumRows[0]?.report_days ?? 0;
  const totalPeople = sumRows.length || deptList.reduce((n, d) => n + d.people.length, 0);
  const totalFiled = sumRows.length ? S('submitted') : input.reports.length;
  const totalLate = sumRows.length ? S('submitted_late') : input.reports.filter(isLate).length;
  // On-time % = filed on time ÷ days actually owed (owed = report days minus
  // leave minus before-joining). Leave and pre-joining days neither help nor hurt.
  // Every report slot in the period: people × report days. Filed + Missing +
  // On leave + Before joining add up to exactly this, so a reader can check a
  // row by adding it across.
  const toFill = (rows: typeof sumRows) => rows.length * periodReportDays;
  const owed = (rows: typeof sumRows) => Math.max(0, S('expected', rows) - S('leave_covered', rows));

  // ---- Cover ---------------------------------------------------------------
  wr.y = TOP + 6;
  wr.font('bold', 17, INK);
  doc.setFont('times', 'bold');
  doc.text(input.title, M, wr.y);
  wr.y += 9;

  wr.heading('Report Particulars');
  wr.particulars([
    ['Report', 'Daily Work Report'],
    ['Coverage', input.scopeLabel || '—'],
    ['Period', period],
    ['Departments', String(deptList.length)],
    ['Employees', String(totalPeople)],
    ['Reports to fill', `${toFill(sumRows)} in total (${totalPeople} employees × ${periodReportDays} working days)`],
    ['Reports filed', `${totalFiled}${S('filed_on_off_day') ? ` (+${S('filed_on_off_day')} filed on a holiday/off day, not counted)` : ''}`],
    ['On time', `${totalFiled - totalLate} (${pct(totalFiled - totalLate, owed(sumRows))} of owed days)`],
    ['Late', String(totalLate)],
    ['Missing', String(S('missing'))],
    ['On leave', `${S('leave_covered')}${S('leave_pending') ? ` (${S('leave_pending')} awaiting HR decision)` : ''}`],
    ['Before joining', String(S('before_joining'))],
    ['Active warnings', `${S('warnings_missed') + S('warnings_zero_activity')} (${S('warnings_missed')} missed deadline, ${S('warnings_zero_activity')} zero activity)`],
    ['Prepared by', input.generatedBy],
    ['Prepared on', generatedAt]
  ]);
  wr.font('italic', 7.5, MUTED);
  doc.text('Only filed reports are included; drafts are excluded. Times are in IST.', M, wr.y);
  wr.y += 7;

  if (input.truncated) {
    wr.font('bold', 8.5, ACCENT);
    doc.text('Note: this export reached its size limit and is incomplete. Choose a shorter period, one department or one employee.', M, wr.y, { maxWidth: wr.inner });
    wr.y += 9;
  }

  const blank = (n: number) => (n ? String(n) : '');
  const summary = sumRows;

  if (!summary.length && !deptList.length) {
    wr.font('normal', 11, INK);
    doc.text('No filed reports were found for this period.', M, wr.y + 4);
  } else {
    const byDept = new Map<string, typeof summary>();
    for (const r of summary) byDept.set(r.department_name || 'Unassigned', [...(byDept.get(r.department_name || 'Unassigned') ?? []), r]);
    const deptRows = [...byDept.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    // Filed shows "+N" for reports filed on a holiday/off day: they are real
    // reports (they appear in the pages below) but were not owed, so they are
    // not in Filed and cannot push anyone over 100%.
    const filedCell = (rows: typeof summary) => `${S('submitted', rows)}${S('filed_on_off_day', rows) ? ` (+${S('filed_on_off_day', rows)})` : ''}`;
    // Leave shows "*" when part of it is still awaiting HR's decision.
    const leaveCell = (rows: typeof summary) => (S('leave_covered', rows) ? `${S('leave_covered', rows)}${S('leave_pending', rows) ? '*' : ''}` : '');
    const line = (name: string, rows: typeof summary) => {
      const filed = S('submitted', rows), late = S('submitted_late', rows);
      return [name, String(rows.length), String(toFill(rows)), filedCell(rows), String(filed - late), blank(late), blank(S('missing', rows)), leaveCell(rows), blank(S('before_joining', rows)), pct(filed - late, owed(rows))];
    };
    const center = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [i, { halign: 'center' }]));

    wr.heading('Department-wise Summary');
    wr.table({
      head: [['Department', 'No. of Employees', 'Reports to fill', 'Reports filed', 'On time', 'Late', 'Missing', 'On leave', 'Before joining', 'On-time %']],
      body: deptRows.map(([name, rows]) => line(name, rows)),
      foot: [line('Total', summary)],
      footStyles: { fillColor: BAND, textColor: INK, fontStyle: 'bold' },
      showFoot: 'lastPage',
      styles: { fontSize: 8, cellPadding: 1.6, textColor: BODY, lineColor: RULE, lineWidth: 0.2 },
      columnStyles: center
    }, 7);

    // Plain caption right under the table — the full notes sit at the very
    // end of the report and nobody reading this table scrolls down to them.
    wr.font('normal', 8, BODY);
    for (const c of [
      'How to read:  48 (+3) = 48 reports on working days + 3 extra reports filed on a holiday/Sunday (shown, but not counted in On-time %).',
      '5* = 5 leave days, some still waiting for HR approval.   Blank = 0.',
      'Check any row:  Reports filed + Missing + On leave + Before joining = Reports to fill.   On-time % leaves out leave days.'
    ]) {
      wr.ensure(6);
      const lines = doc.splitTextToSize(c, wr.inner) as string[];
      doc.text(lines, M, wr.y + 2);
      wr.y += lines.length * 3.6 + 1;
    }
    wr.y += 2;

    wr.heading('Employee-wise Summary');
    wr.table({
      head: [['Department', 'Employee', 'Reports to fill', 'Reports filed', 'On time', 'Late', 'Missing', 'On leave', 'Before joining', 'Warnings']],
      body: deptRows.flatMap(([name, rows]) =>
        rows.map((r) => {
          const w = r.warnings_missed + r.warnings_zero_activity;
          return [
            name, r.employee_name, String(periodReportDays), filedCell([r]), String(r.submitted - r.submitted_late),
            blank(r.submitted_late), blank(r.missing), leaveCell([r]), blank(r.before_joining),
            w ? `${w}${r.warnings_zero_activity ? ` (${r.warnings_zero_activity} Z)` : ''}` : ''
          ];
        })
      ),
      styles: { fontSize: 8, cellPadding: 1.6, textColor: BODY, lineColor: RULE, lineWidth: 0.2 },
      columnStyles: center
    });

    // How to read the tables — so nobody has to guess why two columns differ.
    wr.font('italic', 7.5, MUTED);
    const notes = [
      `Reports to fill: how many reports each person had to file — working days already due (${periodReportDays}; holidays, Sundays and off-Saturdays excluded) for every employee.`,
      'Reports filed + Missing + On leave + Before joining = Reports to fill. Department rows are totals across their employees.',
      'On time + Late = Reports filed. On-time % = on time ÷ owed days (report days minus leave minus days before joining).',
      '(+N) in Reports filed: reports also filed on a holiday/off day — shown in the pages below but not counted, as no report was owed that day.',
      '* in On leave: some of that leave is still awaiting HR approval; it is excused meanwhile and becomes Missing if HR rejects it.',
      'Warnings: active (not waived) warnings in the period. A late report keeps its warning — it missed the deadline — so Warnings can exceed Missing. (N Z) = raised because a report was filed with zero activity.'
    ];
    for (const n of notes) {
      wr.ensure(6);
      const lines = doc.splitTextToSize(n, wr.inner) as string[];
      doc.text(lines, M, wr.y);
      wr.y += lines.length * 3.4 + 1;
    }
    wr.y += 3;
  }

  // ---- Departments & employees ----------------------------------------------
  for (const dept of deptList) {
    wr.newPage();
    const all = dept.people.flat();
    const late = all.filter(isLate).length;

    // Department title band.
    doc.setFillColor(...NAVY);
    doc.rect(M, wr.y - 5, wr.inner, 10, 'F');
    wr.font('bold', 12, [255, 255, 255]);
    doc.text(`DEPARTMENT: ${dept.name.toUpperCase()}`, M + 4, wr.y + 1.5);
    wr.font('normal', 8, [226, 232, 240]);
    // Same per-employee numbers as the summary tables (input.summary), so a
    // department page can't contradict the summary at the front.
    const deptSummary = sumRows.filter((r) => (r.department_name || 'Unassigned') === dept.name);
    const dReq = deptSummary.reduce((n, r) => n + r.expected, 0);
    const dLeave = deptSummary.reduce((n, r) => n + r.leave_covered, 0);
    const dFiled = deptSummary.length ? deptSummary.reduce((n, r) => n + r.submitted, 0) : all.length;
    const dLate = deptSummary.length ? deptSummary.reduce((n, r) => n + r.submitted_late, 0) : late;
    const dCount = deptSummary.length || dept.people.length;
    doc.text(`${dCount} employee${dCount === 1 ? '' : 's'} · ${dCount * periodReportDays} reports to fill · ${dFiled} filed · ${pct(dFiled - dLate, Math.max(0, (dReq || dFiled) - dLeave))} on time`, wr.width - M - 4, wr.y + 1.5, { align: 'right' });
    wr.y += 12;

    wr.table({
      head: [['Employee', 'Reports to fill', 'Reports filed', 'On time', 'Late', 'Missing', 'On leave', 'Before joining', 'On-time %']],
      body: (deptSummary.length ? deptSummary : []).map((r) => [
        r.employee_name, String(periodReportDays), `${r.submitted}${r.filed_on_off_day ? ` (+${r.filed_on_off_day})` : ''}`, String(r.submitted - r.submitted_late),
        r.submitted_late ? String(r.submitted_late) : '', r.missing ? String(r.missing) : '', r.leave_covered ? `${r.leave_covered}${r.leave_pending ? '*' : ''}` : '',
        r.before_joining ? String(r.before_joining) : '',
        pct(r.submitted - r.submitted_late, Math.max(0, r.expected - r.leave_covered))
      ]),
      columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, { halign: 'center' }]))
    }, 8);

    dept.people.forEach((list, index) => {
      if (index > 0) wr.newPage();
      else wr.ensure(60);
      const first = list[0];
      const l = list.filter(isLate).length;

      wr.heading(`Employee: ${first.employee_name || first.employee_username}`);
      wr.particulars([
        ['Employee', first.employee_name || '—'],
        ['Username', first.employee_username || '—'],
        ['Department', dept.name],
        ['Period', period],
        ['Reports filed', String(list.length)],
        ['On time / Late', `${list.length - l} / ${l}`]
      ]);
      wr.y += 2;

      for (const report of list) {
        drawReport(wr, report, input.templates.get(`${report.department_id}|${report.template_key}`));
      }
      drawSignOff(wr, first.employee_name || first.employee_username);
    });
  }

  drawLetterheads(doc, logo, `Period: ${period}`, `Generated ${generatedAt}`);
  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}
