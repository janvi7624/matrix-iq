'use client';

import { useCallback, useEffect, useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './taskCategoryEditor.module.css';

// Editing the Office Operation Expense picklists.
//
// Two independent two-level lists — Category with its optional detail, and
// Expense Head with its sub-items — so the editor is the same block repeated
// rather than two different screens.
//
// Shares taskCategoryEditor.module.css with the daily-report editor: the two
// do the same job for different modules, and a second stylesheet would be two
// things to keep in step for no gain.

interface Options {
  usecases: string[];
  usecaseSubOptions: Record<string, string[]>;
  items: string[];
  itemSubOptions: Record<string, string[]>;
}

interface Payload {
  options: Options;
  defaults: Options;
  departmentDrivenItem: string;
}

/** Rename a key in place — renaming must not reorder the list. */
function renameKey(map: Record<string, string[]>, from: string, to: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(map)) out[key === from ? to : key] = value;
  return out;
}

function uniqueName(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function ListBlock({
  title,
  hint,
  values,
  subs,
  subLabel,
  lockedSubFor,
  onChange
}: {
  title: string;
  hint: string;
  values: string[];
  subs: Record<string, string[]>;
  subLabel: string;
  /** An entry whose sub-list comes from elsewhere and must not be typed here. */
  lockedSubFor?: string;
  onChange: (values: string[], subs: Record<string, string[]>) => void;
}) {
  return (
    <section className={styles.group}>
      <header className={styles.groupHead}>
        <h4 className={styles.groupTitle}>{title}</h4>
        <span className={styles.builtIn}>{hint}</span>
      </header>

      <div className={styles.rows}>
        {values.map((value, index) => (
          <div key={`${value}-${index}`} className={styles.row}>
            <input
              className={styles.catInput}
              value={value}
              aria-label={`${title} name`}
              onChange={(e) => {
                const next = [...values];
                next[index] = e.target.value;
                onChange(next, renameKey(subs, value, e.target.value));
              }}
            />
            {value === lockedSubFor ? (
              <span className={`${styles.subInput} ${styles.builtIn}`} style={{ border: 'none' }}>
                Sub-list comes from Department Master — not edited here.
              </span>
            ) : (
              <input
                className={styles.subInput}
                value={(subs[value] ?? []).join(', ')}
                placeholder={`${subLabel}, separated by commas`}
                aria-label={`${subLabel} for ${value}`}
                onChange={(e) => onChange(values, { ...subs, [value]: e.target.value.split(',').map((v) => v.trim()) })}
              />
            )}
            <button
              type="button"
              className={styles.removeBtn}
              aria-label={`Remove ${value}`}
              onClick={() => {
                const nextSubs = { ...subs };
                delete nextSubs[value];
                onChange(values.filter((_, i) => i !== index), nextSubs);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className={historyStyles.button}
        onClick={() => onChange([...values, uniqueName(values, `New ${title.toLowerCase()}`)], subs)}
      >
        + Add {title.toLowerCase()}
      </button>
    </section>
  );
}

export default function ExpenseCategoryEditor({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/office-operation-expenses/categories');
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setStatus(body?.error || 'Could not load the categories.');
          return;
        }
        setData(body as Payload);
        setOptions((body as Payload).options);
        setStatus('');
      } catch {
        if (!cancelled) setStatus('Could not reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    if (!options) return;
    setSaving(true);
    try {
      const response = await fetch('/api/office-operation-expenses/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.error || 'Could not save these categories.');
        return;
      }
      toast.success('Categories updated.');
      onSaved?.();
      onClose();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }, [options, toast, onClose, onSaved]);

  return (
    <Modal
      title="Expense categories"
      ariaLabel="Edit expense categories"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <ModalCancelButton onClick={onClose} disabled={saving}>Close</ModalCancelButton>
          {data && (
            <ModalOkButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save categories'}</ModalOkButton>
          )}
        </>
      }
    >
      <p className={calcStyles.small}>
        These lists drive the Category and Expense Head dropdowns for everyone recording office spend. Expenses already
        filed keep whatever they recorded — removing an option only stops it being chosen again.
      </p>

      {status && <div className={historyStyles.status}>{status}</div>}

      {data && options && (
        <>
          <ListBlock
            title="Category"
            hint="Office, Employee, Guest, …"
            values={options.usecases}
            subs={options.usecaseSubOptions}
            subLabel="Detail options"
            onChange={(usecases, usecaseSubOptions) => setOptions({ ...options, usecases, usecaseSubOptions })}
          />

          <ListBlock
            title="Expense Head"
            hint="Pantry, Stationary, Salary, …"
            values={options.items}
            subs={options.itemSubOptions}
            subLabel="Sub-items"
            lockedSubFor={data.departmentDrivenItem}
            onChange={(items, itemSubOptions) => setOptions({ ...options, items, itemSubOptions })}
          />

          <button
            type="button"
            className={historyStyles.button}
            style={{ marginTop: 12 }}
            onClick={() => setOptions({ ...data.defaults })}
          >
            Reset both lists to defaults
          </button>
        </>
      )}
    </Modal>
  );
}
