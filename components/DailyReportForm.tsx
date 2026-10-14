'use client';

import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  DailyReportFieldDef,
  DailyReportPayloadInput,
  TemplateDefinition,
  computeDerivedValues,
  computeMatrixTotals
} from '@/lib/dailyReportTemplates';
import calcStyles from './calculator.module.css';
import styles from './dailyReport.module.css';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import Button from './ui/Button';

// The renderer half of the form engine. One component for all eight
// department formats, driven by the TemplateDefinition the server sends —
// the counterpart to validateReportPayload, which checks the same schema on
// the way back in.
//
// Three layouts, matching the three in lib/dailyReportTemplates.ts:
//   'rows'      repeatable entry cards with add / remove / reorder
//   'narrative' one set of fields for the whole day
//   'matrix'    the sales measure × vertical numeric grid, with live totals
//
// Fully controlled: the parent owns the payload and this component only ever
// calls onChange. That is what lets the employee page, the manager's "File
// for Them" dialog and the manager's edit dialog all reuse it without any of
// them needing its own copy of the field logic.

export interface DailyReportFormProps {
  template: TemplateDefinition;
  value: DailyReportPayloadInput;
  onChange: (next: DailyReportPayloadInput) => void;
  /** Server validation issues keyed by path ('entries.0.status'). */
  issues?: Record<string, string>;
  disabled?: boolean;
  /** Needed to compute Task ID and Days Left exactly as the server will. */
  reportDate: string;
}

const WIDTH_CLASS: Record<NonNullable<DailyReportFieldDef['width']>, string> = {
  sm: styles.fieldSm,
  md: styles.fieldMd,
  lg: styles.fieldLg,
  xl: styles.fieldXl
};

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Options for a plain or dependent select. Empty when the parent is unset. */
function optionsFor(field: DailyReportFieldDef, row: Record<string, unknown>): string[] {
  if (field.dependsOn && field.linkedOptions) {
    const parent = asString(row[field.dependsOn]);
    return parent ? field.linkedOptions[parent] ?? [] : [];
  }
  return field.options ?? [];
}

interface FieldProps {
  field: DailyReportFieldDef;
  row: Record<string, unknown>;
  path: string;
  issues: Record<string, string>;
  disabled: boolean;
  onFieldChange: (key: string, value: string) => void;
  derived?: { task_code?: string; days_left?: number; serial?: number };
}

function FieldControl({ field, row, path, issues, disabled, onFieldChange, derived }: FieldProps) {
  const error = issues[path];
  const id = `${path}.${field.key}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const value = asString(row[field.key]);

  // Read-only columns. Rendered as text, not a disabled input, because a
  // disabled input invites the reader to wonder what would happen if it
  // weren't — these are server-computed and never submitted.
  if (field.type === 'computed') {
    const text =
      field.computed === 'entry_code'
        ? derived?.task_code ?? '—'
        : field.computed === 'serial'
          ? String(derived?.serial ?? '—')
          : typeof derived?.days_left === 'number'
            ? `${derived.days_left} day${Math.abs(derived.days_left) === 1 ? '' : 's'}`
            : '—';
    const overdue = field.computed === 'days_left' && typeof derived?.days_left === 'number' && derived.days_left < 0;
    return (
      <div className={`${calcStyles.field} ${WIDTH_CLASS[field.width ?? 'md']}`}>
        <label className={calcStyles.label} htmlFor={id}>{field.label}</label>
        <div className={`${styles.computedValue} ${overdue ? styles.computedOverdue : ''}`} id={id}>
          {overdue ? `${text} overdue` : text}
        </div>
        {field.help && <div className={calcStyles.small}>{field.help}</div>}
      </div>
    );
  }

  const control = (() => {
    switch (field.type) {
      case 'textarea':
        return (
          <Textarea
            id={id}
            rows={2}
            value={value}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
          />
        );
      case 'select': {
        const options = optionsFor(field, row);
        const parentUnset = !!field.dependsOn && !asString(row[field.dependsOn]);
        return (
          <Select
            id={id}
            value={value}
            disabled={disabled || parentUnset}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
          >
            {/* A dependent select says WHY it is empty rather than just
                being an empty dropdown the user has to guess about. */}
            <option value="">{parentUnset ? `Choose a ${field.dependsOn?.replace(/_/g, ' ')} first` : '— Select —'}</option>
            {options.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        );
      }
      case 'number':
        return (
          <Input
            id={id}
            type="number"
            min={0}
            step={field.integer === false ? '0.5' : '1'}
            value={value}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
          />
        );
      case 'date':
        return (
          <Input
            id={id}
            type="date"
            value={value}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
          />
        );
      default:
        return (
          <Input
            id={id}
            type="text"
            value={value}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
          />
        );
    }
  })();

  return (
    <div className={`${calcStyles.field} ${WIDTH_CLASS[field.width ?? 'md']} ${error ? styles.fieldError : ''}`}>
      <label className={calcStyles.label} htmlFor={id}>
        {field.label}
        {field.required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {error && <div className={styles.errorText} id={`${id}-error`}>{error}</div>}
      {!error && field.help && <div className={calcStyles.small}>{field.help}</div>}
    </div>
  );
}

export default function DailyReportForm({ template, value, onChange, issues = {}, disabled = false, reportDate }: DailyReportFormProps) {
  const entries = value.entries ?? [];
  const totals = useMemo(
    () => (template.layout === 'matrix' ? computeMatrixTotals(template, (value.matrix ?? {}) as Record<string, Record<string, number>>) : null),
    [template, value.matrix]
  );

  function setHeader(key: string, next: string) {
    onChange({ ...value, header: { ...value.header, [key]: next } });
  }

  function setEntry(index: number, key: string, next: string) {
    const updated = entries.map((entry, i) => {
      if (i !== index) return entry;
      const patched = { ...entry, [key]: next };
      // Changing a parent clears its dependent, so a stale
      // "Recruitment + Payroll input" pairing can never be submitted — the
      // server rejects exactly that combination, so silently keeping it
      // would produce a validation error the user can't see the cause of.
      for (const field of template.rowFields) {
        if (field.dependsOn === key) patched[field.key] = '';
      }
      return patched;
    });
    onChange({ ...value, entries: updated });
  }

  function addEntry() {
    onChange({ ...value, entries: [...entries, {}] });
  }

  function removeEntry(index: number) {
    onChange({ ...value, entries: entries.filter((_, i) => i !== index) });
  }

  function moveEntry(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...value, entries: next });
  }

  function setMatrixCell(measure: string, channel: string, next: string) {
    const matrix = { ...(value.matrix ?? {}) };
    matrix[measure] = { ...(matrix[measure] ?? {}), [channel]: next };
    onChange({ ...value, matrix });
  }

  return (
    <div>
      {template.headerFields.length > 0 && (
        <div className={styles.formGrid}>
          {template.headerFields.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              row={value.header ?? {}}
              path="header"
              issues={issues}
              disabled={disabled}
              onFieldChange={setHeader}
            />
          ))}
        </div>
      )}

      {template.layout === 'matrix' && totals && (
        <div className={styles.matrixWrap}>
          <table className={styles.matrixTable}>
            <caption className="mx-sr-only">
              Today&apos;s activity counts by measure and product vertical, with calculated totals
            </caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                {(template.channels ?? []).map((channel) => (
                  <th scope="col" key={channel} className={styles.numCol}>{channel}</th>
                ))}
                <th scope="col" className={styles.numCol}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(template.measures ?? []).map((measure) => (
                <tr key={measure}>
                  <th scope="row" className={styles.measureCell}>{measure}</th>
                  {(template.channels ?? []).map((channel) => {
                    const cellIssue = issues[`matrix.${measure}.${channel}`];
                    return (
                      <td key={channel} className={styles.numCol}>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          className={`${styles.matrixInput} ${cellIssue ? styles.matrixInputError : ''}`}
                          value={asString(value.matrix?.[measure]?.[channel])}
                          disabled={disabled}
                          placeholder="0"
                          aria-label={`${measure}, ${channel}`}
                          aria-invalid={cellIssue ? true : undefined}
                          onChange={(e) => setMatrixCell(measure, channel, e.target.value)}
                        />
                      </td>
                    );
                  })}
                  <td className={styles.totalCell}>{totals.byMeasure[measure] ?? 0}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={styles.measureCell}>Total</td>
                {(template.channels ?? []).map((channel) => (
                  <td key={channel} className={styles.totalCell}>{totals.byChannel[channel] ?? 0}</td>
                ))}
                <td className={`${styles.totalCell} ${styles.grandTotal}`}>{totals.overall}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {template.layout === 'rows' && (
        <>
          {issues.entries && <div className={styles.errorText} role="alert">{issues.entries}</div>}
          <div className={styles.entryList}>
            {entries.map((entry, index) => {
              const derived = computeDerivedValues(template, reportDate, entry, index);
              return (
                <div className={styles.entryCard} key={index}>
                  <div className={styles.entryHead}>
                    <span className={styles.entryIndex}>
                      {template.entryNoun ?? 'Entry'} {index + 1}
                      {derived.task_code && <span className={styles.entryCode}>{derived.task_code}</span>}
                    </span>
                    {!disabled && (
                      <div className={styles.entryTools}>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => moveEntry(index, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${template.entryNoun ?? 'entry'} ${index + 1} up`}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => moveEntry(index, 1)}
                          disabled={index === entries.length - 1}
                          aria-label={`Move ${template.entryNoun ?? 'entry'} ${index + 1} down`}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          onClick={() => removeEntry(index)}
                          aria-label={`Remove ${template.entryNoun ?? 'entry'} ${index + 1}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className={styles.entryGrid}>
                    {template.rowFields.map((field) => (
                      <FieldControl
                        key={field.key}
                        field={field}
                        row={entry}
                        path={`entries.${index}`}
                        issues={issues}
                        disabled={disabled}
                        derived={derived}
                        onFieldChange={(key, next) => setEntry(index, key, next)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {!disabled && (
            <div className={styles.footerActions}>
              <Button
                variant="secondary"
                icon={<Plus size={15} />}
                onClick={addEntry}
                disabled={!!template.maxEntries && entries.length >= template.maxEntries}
              >
                Add {template.entryNoun ?? 'Entry'}
              </Button>
              {entries.length === 0 && (
                <span className={styles.savedHint}>
                  Add at least {template.minEntries ?? 1} {(template.entryNoun ?? 'entry').toLowerCase()} before submitting.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
