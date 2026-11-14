import { readFile } from 'fs/promises';
import path from 'path';
import { DailyReportFieldDef, TemplateDefinition, computeMatrixTotals, isFieldVisible } from './dailyReportTemplates';
import { DailyReportRecord } from './dailyReportTypes';
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
    const fields = template.rowFields.filter((f) => !f.hidden);
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
      const rowColumnStyles: Record<number, Record<string, unknown>> = { 0: { cellWidth: 7, halign: 'center', textColor: MUTED } };
      keptFields.forEach((f, i) => {
        const style = widthFor(f);
        if (style) rowColumnStyles[i + 1] = style;
      });
      wr.table({
        head: [head],
        body: body.map((row) => row.filter((_, i) => keep[i])),
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
  const totalPeople = deptList.reduce((n, d) => n + d.people.length, 0);
  const totalLate = input.reports.filter(isLate).length;

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
    ['Reports filed', String(input.reports.length)],
    ['On time', `${input.reports.length - totalLate} (${pct(input.reports.length - totalLate, input.reports.length)})`],
    ['Late', String(totalLate)],
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

  if (!deptList.length) {
    wr.font('normal', 11, INK);
    doc.text('No filed reports were found for this period.', M, wr.y + 4);
  } else {
    wr.heading('Department-wise Summary');
    wr.table({
      head: [['Department', 'Employees', 'Reports filed', 'On time', 'Late', 'On-time %']],
      body: deptList.map((d) => {
        const all = d.people.flat();
        const late = all.filter(isLate).length;
        return [d.name, String(d.people.length), String(all.length), String(all.length - late), String(late), pct(all.length - late, all.length)];
      }),
      foot: [['Total', String(totalPeople), String(input.reports.length), String(input.reports.length - totalLate), String(totalLate), pct(input.reports.length - totalLate, input.reports.length)]],
      footStyles: { fillColor: BAND, textColor: INK, fontStyle: 'bold' },
      showFoot: 'lastPage',
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } }
    }, 7);

    wr.heading('Employee Index');
    wr.table({
      head: [['Department', 'Employee', 'Reports', 'On time', 'Late', 'First report', 'Last report']],
      body: deptList.flatMap((d) =>
        d.people.map((list) => {
          const late = list.filter(isLate).length;
          return [d.name, list[0].employee_name, String(list.length), String(list.length - late), String(late), formatIstDate(list[0].report_date), formatIstDate(list[list.length - 1].report_date)];
        })
      ),
      styles: { fontSize: 8, cellPadding: 1.6, textColor: BODY, lineColor: RULE, lineWidth: 0.2 },
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' } }
    });
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
    doc.text(`${dept.people.length} employee${dept.people.length === 1 ? '' : 's'} · ${all.length} report${all.length === 1 ? '' : 's'} · ${pct(all.length - late, all.length)} on time`, wr.width - M - 4, wr.y + 1.5, { align: 'right' });
    wr.y += 12;

    wr.table({
      head: [['Employee', 'Reports filed', 'On time', 'Late', 'On-time %']],
      body: dept.people.map((list) => {
        const l = list.filter(isLate).length;
        return [list[0].employee_name, String(list.length), String(list.length - l), String(l), pct(list.length - l, list.length)];
      }),
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' } }
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
