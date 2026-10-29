'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Link2 } from 'lucide-react';
import {
  DailyReportFieldDef,
  DailyReportPayloadInput,
  TemplateDefinition,
  DerivedEntryValues,
  computeDerivedValues,
  computeMatrixTotals,
  isFieldVisible
} from '@/lib/dailyReportTemplates';
import { istDate } from '@/lib/dailyReportTime';
import calcStyles from './calculator.module.css';
import styles from './dailyReport.module.css';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import Button from './ui/Button';
import { useConfirm } from './ui/ConfirmDialog';
import { useSalesAutoDetail } from './useSalesAutoDetail';
import TmsTaskPicker, { TmsLinkableTask } from './TmsTaskPicker';
import TmsLinkedTaskPanel from './TmsLinkedTaskPanel';
import TmsNewTaskProjectSelect, { TmsProjectOption, SalesProjectOption } from './TmsNewTaskProjectSelect';
import { buildEntryPatchFromTmsTask, reverseAiPriority } from '@/lib/aiTmsStatusMapping';

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
  /**
   * Whose auto-filled cells to look behind when one is clicked. Omitted on
   * the employee's own page (the API defaults to the signed-in viewer);
   * TeamDailyReportsView passes the team member's id explicitly, since
   * there the viewer and the report's owner are different people.
   */
  employeeId?: string;
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
  // What a PERSON may choose — narrower than what's a valid stored value
  // when selectableOptions is set (see its own doc comment). The row's OWN
  // current value is always included even if selectableOptions excludes
  // it, so a system-set value (e.g. an auto row's gem_team_activity) still
  // displays correctly as the chosen option instead of rendering blank —
  // selectableOptions keeps it from being PICKED, not from being SHOWN.
  if (field.selectableOptions) {
    const current = asString(row[field.key]);
    return current && !field.selectableOptions.includes(current) ? [...field.selectableOptions, current] : field.selectableOptions;
  }
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
  derived?: DerivedEntryValues;
}

function FieldControl({ field, row, path, issues, disabled, onFieldChange, derived }: FieldProps) {
  // Conditional field: not rendered unless the field it depends on holds a
  // listed value (or, for notEmpty, any value at all). validateField applies
  // the identical rule via the same isFieldVisible, so a hidden field is
  // never required — if these two ever disagree the report becomes
  // unsubmittable, complaining about a box that is not on screen.
  if (!isFieldVisible(field, row)) return null;
  // System bookkeeping (e.g. the quotation id an auto-generated GEM row is
  // linked to) — persisted, but nothing to show a person.
  if (field.hidden) return null;

  const error = issues[path];
  const id = `${path}.${field.key}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const value = asString(row[field.key]);

  // Read-only columns. Rendered as text, not a disabled input, because a
  // disabled input invites the reader to wonder what would happen if it
  // weren't — these are server-computed and never submitted.
  if (field.type === 'computed') {
    // The Days Left cell has three states, because a countdown is only one
    // of them: a finished task shows WHEN it was finished, an open one past
    // its due date reads as overdue, and anything else is a plain countdown.
    //
    // overdue comes from derived, which is the server's own rule rather than
    // a second copy of it here — so what this cell is coloured by can never
    // disagree with what the report records.
    const overdue = field.computed === 'days_left' && derived?.overdue === true;
    // Keyed off the row's own status, not off the stamp, so the cell reads as
    // completed the instant the employee picks Completed. The stamp is
    // written server-side, so an unsaved row has none yet and this would
    // otherwise blank to an em dash until the save round-tripped. The same
    // branch covers rows finished before the stamp existed, which will never
    // have one — hence the bare "Completed" fallback rather than a guess.
    const completed = field.computed === 'days_left' && asString(row.status) === 'Completed';
    const text =
      field.computed === 'entry_code'
        ? derived?.task_code ?? '—'
        : completed
          ? (derived?.completed_on ? `Completed ${derived.completed_on}` : 'Completed')
          : typeof derived?.days_left === 'number'
            ? `${Math.abs(derived.days_left)} day${Math.abs(derived.days_left) === 1 ? '' : 's'}${overdue ? ' overdue' : ''}`
            : '—';
    return (
      <div className={`${calcStyles.field} ${WIDTH_CLASS[field.width ?? 'md']}`}>
        <label className={calcStyles.label} htmlFor={id}>{field.label}</label>
        <div className={`${styles.computedValue} ${overdue ? styles.computedOverdue : ''}`} id={id}>
          {text}
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
        return field.currency ? (
          <div className={styles.currencyField}>
            <span className={styles.currencyPrefix} aria-hidden="true">₹</span>
            <Input
              id={id}
              type="number"
              min={0}
              step={field.integer === false ? '0.01' : '1'}
              value={value}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => onFieldChange(field.key, e.target.value)}
            />
          </div>
        ) : (
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
      case 'time':
        return (
          <Input
            id={id}
            type="time"
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

export default function DailyReportForm({ template, value, onChange, issues = {}, disabled = false, reportDate, employeeId }: DailyReportFormProps) {
  const confirm = useConfirm();
  const entries = value.entries ?? [];

  // The auto-cell detail popup — which records actually made up a clicked
  // "4". Shared with DailyReportReadView, which needs the identical
  // behaviour on its own measure totals — see useSalesAutoDetail's own
  // comment for why this used to be inline here alone.
  const { openAutoDetail, modal: autoDetailModal } = useSalesAutoDetail(reportDate, employeeId);
  // Days-left is relative to now, not to the date being reported on, so the
  // form needs today as well as reportDate: opening a report filed last week
  // has to show the countdown as it stands now, not as it stood when filed.
  //
  // Deliberately NOT memoized on mount. It is an IST date string, so it is
  // already stable within a day and costs nothing to recompute — whereas
  // freezing it meant a page left open across midnight kept yesterday's
  // countdown, which is the same class of staleness this change exists to
  // remove. Being a per-day string, it still keeps the memos below from
  // thrashing.
  const today = istDate(new Date());
  const totals = useMemo(
    () => (template.layout === 'matrix' ? computeMatrixTotals(template, (value.matrix ?? {}) as Record<string, Record<string, number>>) : null),
    [template, value.matrix]
  );
  // Only meaningful for 'narrative'/'matrix' templates (AV, Sales) — their
  // Task ID lives in headerFields rather than on a row, computed at index 0
  // the same way a 'rows' template's first entry would be.
  const headerDerived = useMemo(() => computeDerivedValues(template, reportDate, value.header ?? {}, 0, today), [template, reportDate, value.header, today]);

  // Fetched once for the whole report, not once per standalone row — see
  // TmsNewTaskProjectSelect's own comment on why this lives up here.
  const [tmsProjects, setTmsProjects] = useState<TmsProjectOption[] | null>(null);
  const [salesProjects, setSalesProjects] = useState<SalesProjectOption[] | null>(null);
  const [tmsProjectsError, setTmsProjectsError] = useState('');
  useEffect(() => {
    if (!template.supportsTmsTaskLink) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (employeeId) params.set('employeeId', employeeId);
        const response = await fetch(`/api/daily-reports/tms-projects?${params.toString()}`);
        if (!response.ok) {
          if (!cancelled) setTmsProjectsError('Could not load your TMS projects.');
          return;
        }
        const body: { projects: TmsProjectOption[]; salesProjects: SalesProjectOption[] } = await response.json();
        if (!cancelled) {
          setTmsProjects(body.projects);
          setSalesProjects(body.salesProjects);
        }
      } catch {
        if (!cancelled) setTmsProjectsError('Could not reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template.supportsTmsTaskLink, employeeId]);

  function setHeader(key: string, next: string) {
    onChange({ ...value, header: { ...value.header, [key]: next } });
  }

  /**
   * Blanks every field that is now hidden (showWhen no longer matches) or
   * whose dependsOn parent is now unset, repeating until a pass changes
   * nothing. Transitive on purpose: a field can itself govern another (e.g.
   * GEM Sales' follow_up_required gates comm_next_follow_up_date, and
   * follow_up_required is itself only shown for one activity) — clearing
   * only the field that directly named the changed key would leave a
   * now-doubly-hidden field's stale value sitting in the payload, unseen
   * but still submittable. Always correct regardless of WHY a field is
   * hidden, not just as a reaction to this one change.
   */
  function clearHiddenFields(patched: Record<string, unknown>): Record<string, unknown> {
    let changed = true;
    while (changed) {
      changed = false;
      for (const field of template.rowFields) {
        const current = patched[field.key];
        if (current === undefined || current === '') continue;
        const dependsOnUnset = field.dependsOn && !asString(patched[field.dependsOn]);
        const hiddenByShowWhen = !isFieldVisible(field, patched);
        if (dependsOnUnset || hiddenByShowWhen) {
          patched[field.key] = '';
          changed = true;
        }
      }
    }
    return patched;
  }

  async function setEntry(index: number, key: string, next: string) {
    const entry = entries[index] ?? {};
    const governingField = template.rowFields.find((f) => f.key === key);
    if (governingField?.confirmOnChange) {
      const probe = clearHiddenFields({ ...entry, [key]: next });
      const wouldClear = template.rowFields.some((field) => asString(entry[field.key]) !== '' && asString(probe[field.key]) === '');
      if (wouldClear) {
        const ok = await confirm({
          title: `Change ${governingField.label.toLowerCase()}?`,
          message: 'Switching this will clear the details you already entered for it.',
          confirmLabel: 'Switch anyway',
          danger: true
        });
        if (!ok) return;
      }
    }
    const updated = entries.map((entry2, i) => (i === index ? clearHiddenFields({ ...entry2, [key]: next }) : entry2));
    onChange({ ...value, entries: updated });
  }

  function addEntry() {
    onChange({ ...value, entries: [...entries, {}] });
  }

  function removeEntry(index: number) {
    onChange({ ...value, entries: entries.filter((_, i) => i !== index) });
  }

  // TmsLinkedTaskPanel's write actions (POSTs straight to TMS's own API
  // routes) return the task's new state; this merges every tms_*-prefixed
  // field from that response onto the one row, immediately — not waiting
  // for the next report save's refresh — so the row shows what was just
  // saved. No clearHiddenFields pass: nothing patched here governs another
  // field's showWhen/dependsOn.
  function patchEntry(index: number, patch: Record<string, unknown>) {
    // clearHiddenFields matters here too, not just in setEntry: switching
    // `project` away from 'Other' must blank project_other, the same as it
    // would through a normal single-field edit — patchEntry just applies
    // several fields in one go rather than skipping that rule.
    const updated = entries.map((entry2, i) => (i === index ? clearHiddenFields({ ...entry2, ...patch }) : entry2));
    onChange({ ...value, entries: updated });
  }

  // null = closed. 'new' = picking for a fresh row (the "Link TMS Task"
  // footer button). A number = picking for that existing standalone row's
  // own "Link to TMS task…" action.
  const [tmsPickerTarget, setTmsPickerTarget] = useState<'new' | number | null>(null);

  // Populated straight from the picker's own already-fetched task, so the
  // row shows real context immediately rather than looking blank until the
  // next save round-trips lib/aiTmsTaskLink.ts's refresh — that refresh
  // still runs on save and is the lasting source of truth; this is only a
  // head start on the very first render. priority/status must be set here
  // too, not just the tms_*-prefixed display fields: both are required on
  // submit, and validateReportPayload runs before the server-side refresh
  // ever gets a chance to fill them in — an immediate submit right after
  // linking would otherwise fail validation on fields the employee never
  // had a box to type into.
  function applyTmsTaskToEntry(entry: Record<string, unknown>, task: TmsLinkableTask): Record<string, unknown> {
    return {
      ...entry,
      tms_task_id: task.id,
      ...buildEntryPatchFromTmsTask({
        name: task.name,
        description: task.description,
        dueDate: task.dueDate,
        priority: task.priority,
        status: task.status,
        projectName: task.projectName,
        progressPercent: task.progressPercent
      })
    };
  }

  function handleTmsTaskSelected(task: TmsLinkableTask) {
    if (tmsPickerTarget === 'new') {
      onChange({ ...value, entries: [...entries, applyTmsTaskToEntry({}, task)] });
    } else if (typeof tmsPickerTarget === 'number') {
      const index = tmsPickerTarget;
      onChange({ ...value, entries: entries.map((e, i) => (i === index ? applyTmsTaskToEntry(e, task) : e)) });
    }
    setTmsPickerTarget(null);
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
              derived={headerDerived}
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
              {(template.measures ?? []).map((measure) => {
                const isAuto = template.autoMeasures?.includes(measure);
                return (
                  <tr key={measure}>
                    <th scope="row" className={styles.measureCell}>
                      {measure}
                      {isAuto && (
                        <span className={styles.autoMeasureBadge} title="Filled in automatically from your leads/quotations — not editable.">
                          Auto
                        </span>
                      )}
                    </th>
                    {(template.channels ?? []).map((channel) => {
                      const cellIssue = issues[`matrix.${measure}.${channel}`];
                      const cellCount = Number(value.matrix?.[measure]?.[channel]) || 0;
                      // An auto cell with something in it is clickable — the
                      // records behind that number, not just the number
                      // (this is the whole point: "4" on its own can't be
                      // checked, the leads/quotations it came from can). A
                      // zero cell has nothing to show, so it stays a plain
                      // disabled input same as before.
                      if (isAuto && cellCount > 0) {
                        return (
                          <td key={channel} className={styles.numCol}>
                            <button
                              type="button"
                              className={`${styles.matrixInput} ${styles.matrixInputAuto} ${styles.matrixAutoBtn}`}
                              onClick={() => openAutoDetail(measure, channel)}
                              title="Filled in automatically — click to see the records behind this number."
                              aria-label={`${measure}, ${channel}: ${cellCount}. View the records behind this number.`}
                            >
                              {cellCount}
                            </button>
                          </td>
                        );
                      }
                      return (
                        <td key={channel} className={styles.numCol}>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            className={`${styles.matrixInput} ${isAuto ? styles.matrixInputAuto : ''} ${cellIssue ? styles.matrixInputError : ''}`}
                            value={asString(value.matrix?.[measure]?.[channel])}
                            disabled={disabled || isAuto}
                            placeholder="0"
                            aria-label={`${measure}, ${channel}${isAuto ? ' (automatic)' : ''}`}
                            aria-invalid={cellIssue ? true : undefined}
                            onChange={(e) => setMatrixCell(measure, channel, e.target.value)}
                          />
                        </td>
                      );
                    })}
                    <td className={styles.totalCell}>{totals.byMeasure[measure] ?? 0}</td>
                  </tr>
                );
              })}
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
              const derived = computeDerivedValues(template, reportDate, entry, index, today);
              // A row the system generated (its autoEntryActivity marker —
              // a `hidden` field — is set) is re-derived fresh on every
              // save, so nothing on it is worth hand-editing or reordering:
              // locked, the rows-layout counterpart to the Sales grid's
              // "Auto" cells.
              const isAutoRow = template.rowFields.some((f) => f.hidden && f.locksRowWhenSet !== false && asString(entry[f.key]) !== '');
              return (
                <div className={styles.entryCard} key={index}>
                  <div className={styles.entryHead}>
                    <span className={styles.entryIndex}>
                      {template.entryNoun ?? 'Entry'} {index + 1}
                      {derived.task_code && <span className={styles.entryCode}>{derived.task_code}</span>}
                      {isAutoRow && (
                        <span className={styles.autoMeasureBadge} title={template.autoRowHint ?? 'Filled in automatically — not editable.'}>
                          Auto
                        </span>
                      )}
                    </span>
                    {!disabled && !isAutoRow && (
                      <div className={styles.entryTools}>
                        {template.supportsTmsTaskLink && (
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => setTmsPickerTarget(index)}
                            aria-label={`Link ${template.entryNoun ?? 'entry'} ${index + 1} to an existing TMS task`}
                            title="Link to an existing TMS task"
                          >
                            <Link2 size={15} />
                          </button>
                        )}
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
                      <Fragment key={field.key}>
                        <FieldControl
                          field={field}
                          row={entry}
                          path={`entries.${index}`}
                          issues={issues}
                          disabled={disabled || (isAutoRow && !field.editableWhenAuto)}
                          derived={derived}
                          onFieldChange={(key, next) => setEntry(index, key, next)}
                        />
                        {/* Sits right where "Project / Category" used to
                            render as a plain field — same visual slot, now a
                            bespoke, per-employee-data-backed control instead
                            of a static options list (see its own comment on
                            why: lib/dailyReportTemplates.ts's `project`). */}
                        {field.key === 'task_description' && template.supportsTmsTaskLink && (
                          <TmsNewTaskProjectSelect
                            projects={tmsProjects}
                            salesProjects={salesProjects}
                            error={tmsProjectsError}
                            projectId={asString(entry.tms_project_id)}
                            salesProjectId={asString(entry.sales_project_id)}
                            projectName={asString(entry.project)}
                            locked={disabled || isAutoRow}
                            onChange={({ projectId, salesProjectId, projectName }) =>
                              patchEntry(index, { tms_project_id: projectId, sales_project_id: salesProjectId, project: projectName })
                            }
                          />
                        )}
                      </Fragment>
                    ))}
                    {isAutoRow && asString(entry.tms_task_id) && (
                      <a
                        className={styles.tmsLinkOut}
                        href={`/tms/tasks/${asString(entry.tms_task_id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View in TMS ↗
                      </a>
                    )}
                    {!disabled && isAutoRow && asString(entry.tms_task_id) && (
                      <TmsLinkedTaskPanel
                        taskId={asString(entry.tms_task_id)}
                        taskName={asString(entry.task_description)}
                        description={asString(entry.task_description)}
                        priority={reverseAiPriority(asString(entry.priority))}
                        currentDeadline={asString(entry.due_date)}
                        tmsStatusLabel={asString(entry.tms_status_label)}
                        onPatch={(patch) => patchEntry(index, patch)}
                      />
                    )}
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
              {template.supportsTmsTaskLink && (
                <Button
                  variant="secondary"
                  icon={<Link2 size={15} />}
                  onClick={() => setTmsPickerTarget('new')}
                  disabled={!!template.maxEntries && entries.length >= template.maxEntries}
                >
                  Link TMS Task
                </Button>
              )}
              {entries.length === 0 && (
                <span className={styles.savedHint}>
                  Add at least {template.minEntries ?? 1} {(template.entryNoun ?? 'entry').toLowerCase()} before submitting.
                </span>
              )}
            </div>
          )}
          {tmsPickerTarget !== null && (
            <TmsTaskPicker
              employeeId={employeeId}
              alreadyLinkedTaskIds={entries.map((e) => asString(e.tms_task_id)).filter(Boolean)}
              onClose={() => setTmsPickerTarget(null)}
              onSelect={handleTmsTaskSelected}
            />
          )}
        </>
      )}

      {autoDetailModal}
    </div>
  );
}
