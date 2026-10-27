'use client';

import { useCallback, useEffect, useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './taskCategoryEditor.module.css';

// Lets a department manager edit the task dropdowns their team files against
// — the Category, and the Sub-category under it.
//
// The catalogue used to live only in lib/dailyReportTemplates.ts, so adding
// an activity meant a code change. The override mechanism was already there;
// nothing had ever surfaced it.
//
// A group is edited as ONE object rather than two lists, because the parent's
// options and the sub-category catalogue's keys must stay the same set — see
// the pairing rule in lib/dailyReportCategoryFields.ts.

interface CategoryGroup {
  parentKey: string;
  parentLabel: string;
  childKey: string | null;
  childLabel: string | null;
  catalogue: Record<string, string[]>;
  childIsCustom: boolean;
  subLevelEnabled: boolean;
}

interface Payload {
  department_id: string;
  template_key: string;
  template_label: string;
  configured: boolean;
  can_edit: boolean;
  groups: CategoryGroup[];
  departments: { id: string; name: string; can_edit: boolean }[];
}

/** Rename a key while keeping its position — renaming must not reorder the list. */
function renameKey(catalogue: Record<string, string[]>, from: string, to: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(catalogue)) {
    if (key === from) out[to] = value;
    else out[key] = value;
  }
  return out;
}

export default function TaskCategoryEditor({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('Loading…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : '';
        const response = await fetch(`/api/daily-reports/team/categories${params}`);
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setStatus(body?.error || 'Could not load the task categories.');
          setData(null);
          return;
        }
        const payload = body as Payload;
        setData(payload);
        setGroups(payload.groups);
        setDepartmentId(payload.department_id);
        setStatus(payload.groups.length ? '' : 'This report format has no dropdowns to edit.');
      } catch {
        if (!cancelled) setStatus('Could not reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [departmentId]);

  const update = useCallback((index: number, next: CategoryGroup) => {
    setGroups((prev) => prev.map((g, i) => (i === index ? next : g)));
  }, []);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const response = await fetch('/api/daily-reports/team/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentId: data.department_id, groups })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.error || 'Could not save these categories.');
        return;
      }
      setGroups((body.groups as CategoryGroup[]) ?? groups);
      toast.success('Task categories updated. Your team sees them on their next report.');
      onClose();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  const readOnly = Boolean(data && !data.can_edit);

  return (
    <Modal
      title="Task categories"
      ariaLabel="Edit task categories"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <ModalCancelButton onClick={onClose} disabled={saving}>Close</ModalCancelButton>
          {!readOnly && (
            <ModalOkButton onClick={save} disabled={saving || !data?.groups.length}>
              {saving ? 'Saving…' : 'Save categories'}
            </ModalOkButton>
          )}
        </>
      }
    >
      {data && data.departments.length > 1 && (
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Department</label>
          <select className={calcStyles.formControl} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.can_edit ? '' : ' (view only)'}
              </option>
            ))}
          </select>
        </div>
      )}

      {data && (
        <p className={calcStyles.small}>
          Report format: <strong>{data.template_label}</strong>. Changes apply to everyone in this department from their
          next report — reports already filed keep what they recorded.
        </p>
      )}

      {/* HR reads every department but manages only its own, so the editor
          opens read-only rather than refusing outright. */}
      {readOnly && (
        <div className={styles.readOnlyNote}>You can view this department&apos;s categories, but only its own manager can change them.</div>
      )}

      {status && <div className={historyStyles.status}>{status}</div>}

      {groups.map((group, index) => (
        <section key={group.parentKey} className={styles.group}>
          <header className={styles.groupHead}>
            <h4 className={styles.groupTitle}>{group.parentLabel}</h4>
            {group.subLevelEnabled && group.childIsCustom && (
              <input
                className={styles.subNameInput}
                value={group.childLabel ?? ''}
                disabled={readOnly}
                placeholder="Sub-category"
                aria-label={`Name of the sub-category level under ${group.parentLabel}`}
                onChange={(e) => update(index, { ...group, childLabel: e.target.value })}
              />
            )}
            {!group.subLevelEnabled && !readOnly && (
              <button
                type="button"
                className={historyStyles.button}
                onClick={() => update(index, { ...group, subLevelEnabled: true, childLabel: group.childLabel || 'Sub-category' })}
              >
                + Add sub-category level
              </button>
            )}
            {group.subLevelEnabled && group.childIsCustom && !readOnly && (
              <button
                type="button"
                className={historyStyles.button}
                onClick={() => update(index, { ...group, subLevelEnabled: false })}
              >
                Remove sub-level
              </button>
            )}
            {group.subLevelEnabled && !group.childIsCustom && (
              // Built into the format — the validator and every filed report
              // already depend on it, so it is stated rather than offered.
              <span className={styles.builtIn}>{group.childLabel} · part of this format</span>
            )}
          </header>

          <div className={styles.rows}>
            {Object.entries(group.catalogue).map(([category, subs], rowIndex) => (
              // Keyed by POSITION, not by the category name. The name is the
              // value being edited, so keying on it made React unmount and
              // remount the input on every keystroke — the field lost focus
              // after a single character. renameKey preserves order, so the
              // index is stable across a rename.
              <div key={rowIndex} className={styles.row}>
                <input
                  className={styles.catInput}
                  value={category}
                  disabled={readOnly}
                  aria-label={`${group.parentLabel} name`}
                  onChange={(e) => update(index, { ...group, catalogue: renameKey(group.catalogue, category, e.target.value) })}
                />

                {group.subLevelEnabled && (
                  <input
                    className={styles.subInput}
                    value={subs.join(', ')}
                    disabled={readOnly}
                    placeholder={`${group.childLabel || 'Sub-category'} options, separated by commas`}
                    aria-label={`${group.childLabel || 'Sub-categories'} for ${category}`}
                    onChange={(e) =>
                      update(index, {
                        ...group,
                        // Split on save-as-you-type rather than on blur so the
                        // field stays a plain comma list the whole time.
                        catalogue: { ...group.catalogue, [category]: e.target.value.split(',').map((v) => v.trim()) }
                      })
                    }
                  />
                )}

                {!readOnly && (
                  <button
                    type="button"
                    className={styles.removeBtn}
                    aria-label={`Remove ${category}`}
                    onClick={() => {
                      const next = { ...group.catalogue };
                      delete next[category];
                      update(index, { ...group, catalogue: next });
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          {!readOnly && (
            <button
              type="button"
              className={historyStyles.button}
              onClick={() => {
                // Numbered so repeated clicks don't collide on one key,
                // which would silently merge the new rows into each other.
                let name = 'New category';
                let n = 2;
                while (name in group.catalogue) name = `New category ${n++}`;
                update(index, { ...group, catalogue: { ...group.catalogue, [name]: [] } });
              }}
            >
              + Add {group.parentLabel.toLowerCase()}
            </button>
          )}
        </section>
      ))}
    </Modal>
  );
}
