'use client';

import { DailyReportRecord } from '@/lib/types';
import {
  DailyReportFieldDef,
  TemplateDefinition,
  computeDerivedValues,
  computeMatrixTotals
} from '@/lib/dailyReportTemplates';
import styles from './dailyReport.module.css';

// Reading somebody else's report, as opposed to filling one in.
//
// A manager used to be shown DailyReportForm with `disabled` — the data-entry
// form, greyed out. That is a bad way to read anything, and on the Sales
// template it was close to unreadable: twenty-one disabled number inputs in a
// grid, most of them containing "0", with the handful of figures that actually
// meant something buried among them.
//
// So this is a separate component rather than another flag on the form. The
// two have genuinely different jobs: the form gives every field equal weight
// because any of them might be the one you are about to type in, whereas
// reading wants the opposite — the few things that happened, stated plainly,
// and the silence left silent. Nothing here is editable and nothing here
// writes; the form is still what edits, and the full grid is one click away
// underneath for anyone who wants every cell.

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  return String(value).trim();
}

// Derived values arrive as DerivedEntryValues — a concrete shape, not an
// index signature — but a template addresses them by field key, so the lookup
// needs one cast. Kept here, once, rather than loosening the types of
// everything that touches them.
function pickDerived(source: object | undefined, key: string): unknown {
  return source ? (source as Record<string, unknown>)[key] : undefined;
}

/** Fields worth showing: not hidden, and with something in them. */
function readableFields(
  fields: DailyReportFieldDef[],
  values: Record<string, unknown>,
  derived: object = {}
): { field: DailyReportFieldDef; text: string }[] {
  return fields
    .filter((field) => !field.hidden)
    .map((field) => ({
      field,
      // A computed field's value never comes from the payload — it is derived
      // server-side, which is why it is looked up separately here.
      text: asText(field.type === 'computed' ? pickDerived(derived, field.key) ?? values[field.key] : values[field.key])
    }))
    .filter((entry) => entry.text !== '');
}

/** A long answer reads as prose; a short one reads as a value. */
function FieldBlock({ field, text }: { field: DailyReportFieldDef; text: string }) {
  const isProse = field.type === 'textarea' || text.length > 80 || text.includes('\n');
  return (
    <div className={isProse ? styles.readProseField : styles.readField}>
      <dt className={styles.readLabel}>{field.label}</dt>
      <dd className={isProse ? styles.readProse : styles.readValue}>{text}</dd>
    </div>
  );
}

export default function DailyReportReadView({
  report,
  template,
  today
}: {
  report: DailyReportRecord;
  template: TemplateDefinition;
  today: string;
}) {
  const headerFields = readableFields(template.headerFields, report.payload, report.header_derived);

  // ---------------------------------------------------------------- matrix
  if (template.layout === 'matrix') {
    const totals = computeMatrixTotals(template, report.matrix ?? {});
    const channels = template.channels ?? [];
    const measures = template.measures ?? [];
    const active = measures.filter((m) => (totals.byMeasure[m] ?? 0) > 0);
    const quiet = measures.filter((m) => (totals.byMeasure[m] ?? 0) === 0);

    return (
      <div className={styles.readView}>
        {/* The one number a manager is actually after, and where it came
            from — rather than making them add up a grid themselves. */}
        <div className={styles.readHeadline}>
          <div>
            <span className={styles.readHeadlineNumber}>{totals.overall}</span>
            <span className={styles.readHeadlineUnit}>
              {totals.overall === 1 ? 'activity logged' : 'activities logged'}
            </span>
          </div>
          {totals.overall > 0 && (
            <div className={styles.readChannelSplit}>
              {channels
                .filter((c) => (totals.byChannel[c] ?? 0) > 0)
                .map((c) => (
                  <span key={c} className={styles.readChannelChip}>
                    {c} <strong>{totals.byChannel[c]}</strong>
                  </span>
                ))}
            </div>
          )}
        </div>

        {active.length > 0 ? (
          // Template order, not biggest-first: these measures are a funnel
          // (leads -> calls -> quotations -> orders), and reading them in
          // order is how you see where somebody's day actually went.
          <dl className={styles.readMeasureList}>
            {active.map((measure) => (
              <div key={measure} className={styles.readMeasureRow}>
                <dt className={styles.readMeasureName}>{measure}</dt>
                <dd className={styles.readMeasureValue}>
                  <span className={styles.readMeasureTotal}>{totals.byMeasure[measure]}</span>
                  {/* Only the verticals that contributed. "AI 2 · AV 3" says
                      the same as a row of 2, 3, 0 without the reader having
                      to map columns to headings. */}
                  <span className={styles.readMeasureBreakdown}>
                    {channels
                      .filter((c) => (Number(report.matrix?.[measure]?.[c]) || 0) > 0)
                      .map((c) => `${c} ${Number(report.matrix?.[measure]?.[c]) || 0}`)
                      .join(' · ')}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.readEmptyNote}>
            No activity was logged against any measure for this day.
          </p>
        )}

        {quiet.length > 0 && active.length > 0 && (
          // Stated once, quietly, instead of as a dozen zeros competing with
          // the real figures — but still stated, because "nothing on
          // meetings" is itself worth knowing.
          <p className={styles.readQuietNote}>
            Nothing logged for {quiet.join(', ')}.
          </p>
        )}

        {headerFields.length > 0 && (
          <dl className={styles.readFieldList}>
            {headerFields.map(({ field, text }) => (
              <FieldBlock key={field.key} field={field} text={text} />
            ))}
          </dl>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ rows
  if (template.layout === 'rows') {
    const noun = template.entryNoun ?? 'Entry';
    return (
      <div className={styles.readView}>
        <div className={styles.readHeadline}>
          <div>
            <span className={styles.readHeadlineNumber}>{report.entries.length}</span>
            <span className={styles.readHeadlineUnit}>
              {report.entries.length === 1 ? noun.toLowerCase() : `${noun.toLowerCase()}s`}
            </span>
          </div>
        </div>

        {headerFields.length > 0 && (
          <dl className={styles.readFieldList}>
            {headerFields.map(({ field, text }) => (
              <FieldBlock key={field.key} field={field} text={text} />
            ))}
          </dl>
        )}

        {report.entries.length === 0 ? (
          <p className={styles.readEmptyNote}>No {noun.toLowerCase()}s were recorded for this day.</p>
        ) : (
          <div className={styles.readEntryList}>
            {report.entries.map((entry, index) => {
              const data = (entry.data ?? {}) as Record<string, unknown>;
              // The STORED derived values, not a fresh computation. Days Left
              // and Overdue are both relative to "today", so re-deriving them
              // would make a report from last week read differently now than
              // it did when it was filed — and this view's whole job is to
              // show what was filed. Recomputed only as a fallback for a row
              // saved before derived values were stored.
              const derived = {
                ...computeDerivedValues(template, report.report_date, data, index, today),
                ...((entry.derived ?? {}) as Record<string, unknown>)
              };
              const fields = readableFields(template.rowFields, data, derived);
              const code = asText(derived.task_code);
              return (
                <article key={entry.id ?? index} className={styles.readEntry}>
                  <header className={styles.readEntryHead}>
                    <span className={styles.readEntryIndex}>
                      {noun} {index + 1}
                    </span>
                    {code && <span className={styles.readEntryCode}>{code}</span>}
                  </header>
                  <dl className={styles.readFieldList}>
                    {fields
                      // The code is already in the header above; repeating it
                      // as a field is noise.
                      .filter(({ field }) => field.key !== 'task_code')
                      .map(({ field, text }) => (
                        <FieldBlock key={field.key} field={field} text={text} />
                      ))}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------- narrative
  return (
    <div className={styles.readView}>
      {headerFields.length === 0 ? (
        <p className={styles.readEmptyNote}>This report was filed with nothing written in it.</p>
      ) : (
        <dl className={styles.readFieldList}>
          {headerFields.map(({ field, text }) => (
            <FieldBlock key={field.key} field={field} text={text} />
          ))}
        </dl>
      )}
    </div>
  );
}
