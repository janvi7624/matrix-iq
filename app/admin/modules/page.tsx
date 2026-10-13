'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleConfigRecord, RoleRecord, UserRole } from '@/lib/types';
import AppShell from '@/components/AppShell';
import { MODULE_ICON_OPTIONS, resolveModuleIcon } from '@/lib/icons';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import { useToast } from '@/components/ui/ToastProvider';
import pageStyles from './modulesPage.module.css';

function iconOptionLabel(key: string): string {
  return key.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Short column header for a role — first word, capped so the table stays readable.
function shortLabel(label: string): string {
  const first = label.split(' ')[0];
  return first.length > 6 ? first.slice(0, 6) : first;
}

// The fields this page may change. Everything else on a ModuleConfigRecord
// (key, href, isCustom, …) is read-only here, so the dirty check and the
// save payload both work off exactly this list and can't drift apart.
const EDITABLE_FIELDS = ['label', 'icon', 'enabled', 'visibleToRoles'] as const;

function sameRoleSet(a: UserRole[], b: UserRole[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((role) => set.has(role));
}

function hasFieldChanges(draft: ModuleConfigRecord, saved: ModuleConfigRecord): boolean {
  return (
    draft.label !== saved.label ||
    draft.icon !== saved.icon ||
    draft.enabled !== saved.enabled ||
    !sameRoleSet(draft.visibleToRoles, saved.visibleToRoles)
  );
}

function groupBySection(list: ModuleConfigRecord[]): Map<string, ModuleConfigRecord[]> {
  const groups = new Map<string, ModuleConfigRecord[]>();
  list.forEach((m) => {
    const group = groups.get(m.section) || [];
    group.push(m);
    groups.set(m.section, group);
  });
  for (const group of groups.values()) group.sort((a, b) => a.order - b.order);
  return groups;
}

// Module Manager.
//
// Every control here used to write to the server the instant it changed — a
// role checkbox fired a PATCH on click, the label on blur, reordering on
// each arrow press. There was no confirmation and no undo, so a stray click
// silently changed who can see a module and nobody could tell afterwards
// that it had happened. (That is exactly how Audit Log's visibility ended
// up widened to admins.)
//
// Edits are now buffered in `draft` and written only when Save is pressed.
// `saved` holds what the server last returned, so the diff between the two
// is both what gets highlighted in the table and what gets sent.
export default function ModuleManagerPage() {
  const [saved, setSaved] = useState<ModuleConfigRecord[]>([]);
  const [draft, setDraft] = useState<ModuleConfigRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [modulesRes, rolesRes] = await Promise.all([fetch('/api/admin/modules'), fetch('/api/admin/roles')]);
      if (!modulesRes.ok) throw new Error(String(modulesRes.status));
      const data: ModuleConfigRecord[] = await modulesRes.json();
      const rolesData: RoleRecord[] = rolesRes.ok ? await rolesRes.json() : [];
      setSaved(data);
      setDraft(data);
      setRoles(rolesData.filter((r) => r.status === 'active'));
      setStatus('');
    } catch {
      setStatus('Could not load modules. Refresh to try again.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savedById = useMemo(() => new Map(saved.map((m) => [m.id, m])), [saved]);
  const bySection = useMemo(() => groupBySection(draft), [draft]);
  const savedBySection = useMemo(() => groupBySection(saved), [saved]);

  // Which rows differ from the server, and which sections have been
  // reordered. Both drive the highlight in the table AND the save payload,
  // so what is shown as pending is exactly what gets written.
  const changedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of draft) {
      const original = savedById.get(record.id);
      if (original && hasFieldChanges(record, original)) ids.add(record.id);
    }
    return ids;
  }, [draft, savedById]);

  const reorderedSections = useMemo(() => {
    const sections: string[] = [];
    for (const [section, list] of bySection) {
      const before = (savedBySection.get(section) || []).map((m) => m.id).join(',');
      if (before && before !== list.map((m) => m.id).join(',')) sections.push(section);
    }
    return sections;
  }, [bySection, savedBySection]);

  const pendingCount = changedIds.size + reorderedSections.length;
  const dirty = pendingCount > 0;

  // The browser's own "leave site?" prompt. Buffered edits are only in
  // memory, so closing the tab or following a link would discard them
  // silently otherwise.
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function editModule(id: string, patch: Partial<ModuleConfigRecord>) {
    setDraft((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function move(section: string, id: string, direction: -1 | 1) {
    const list = [...(bySection.get(section) || [])];
    const index = list.findIndex((m) => m.id === id);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= list.length) return;
    [list[index], list[swapWith]] = [list[swapWith], list[index]];
    // Renumber within the section so the draft re-sorts the way the saved
    // order will once the reorder endpoint has run.
    const orderById = new Map(list.map((m, i) => [m.id, i + 1]));
    setDraft((prev) => prev.map((m) => (orderById.has(m.id) ? { ...m, order: orderById.get(m.id) as number } : m)));
  }

  function toggleRole(id: string, role: UserRole) {
    setDraft((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const has = m.visibleToRoles.includes(role);
        return { ...m, visibleToRoles: has ? m.visibleToRoles.filter((r) => r !== role) : [...m.visibleToRoles, role] };
      })
    );
  }

  function discard() {
    setDraft(saved);
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      // Field edits first, then ordering — a reorder renumbers rows, so
      // running it last means the PATCHes above can't be working against
      // numbers the reorder is about to replace.
      for (const id of changedIds) {
        // Not named `module` — Next forbids assigning to that identifier.
        const record = draft.find((m) => m.id === id);
        if (!record) continue;
        const body: Record<string, unknown> = {};
        for (const field of EDITABLE_FIELDS) body[field] = record[field];
        const response = await fetch(`/api/admin/modules/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(`Could not save "${record.label}"`);
      }

      for (const section of reorderedSections) {
        const orderedIds = (bySection.get(section) || []).map((m) => m.id);
        const response = await fetch('/api/admin/modules/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderedIds })
        });
        if (!response.ok) throw new Error(`Could not reorder "${section}"`);
      }

      toast.success(`Saved ${pendingCount} change${pendingCount === 1 ? '' : 's'}.`);
      // Reload rather than trusting the draft: the server is the authority
      // on what was actually written, and a partial failure above must not
      // leave the table claiming everything saved.
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save these changes.');
      // Deliberately NOT reloading — the draft is kept so the edits aren't
      // lost and can be retried.
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Module Manager" subtitle="Administration › enable, disable, rename, reorder, and set role visibility for every module — no code required.">
        <div className={historyStyles.status}>{status}</div>
        <div className={historyStyles.status}>
          Disabling a module hides it from the Dashboard for everyone (data is never deleted). Role columns control who sees it when enabled.
          <strong> Changes are not applied until you press Save.</strong>
        </div>

        {/* Sticky, because the table runs well past a screen — a Save button
            at the bottom would be out of sight from the row being edited. */}
        <div className={`${pageStyles.saveBar} ${dirty ? pageStyles.saveBarActive : ''}`}>
          <span className={pageStyles.saveBarText}>
            {dirty
              ? `${pendingCount} unsaved change${pendingCount === 1 ? '' : 's'}`
              : 'No unsaved changes'}
          </span>
          <button type="button" className={historyStyles.toggleBtn} onClick={discard} disabled={!dirty || saving}>
            Discard
          </button>
          <button type="button" className={pageStyles.saveBtn} onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {[...bySection.entries()].map(([section, list]) => (
          <div key={section} className={pageStyles.sectionBlock}>
            <h2 className={calcStyles.h2}>
              {section}
              {reorderedSections.includes(section) && <span className={pageStyles.pendingChip}>order changed</span>}
            </h2>
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Icon</th>
                    <th>Label</th>
                    <th>Href</th>
                    <th>Enabled</th>
                    {roles.map((r) => <th key={r.key} className={pageStyles.centerCell} title={r.label}>{shortLabel(r.label)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.map((m, i) => (
                    <tr key={m.id} className={changedIds.has(m.id) ? pageStyles.rowDirty : undefined}>
                      <td>
                        <div className={pageStyles.reorderRow}>
                          <button type="button" className={historyStyles.toggleBtn} disabled={i === 0} onClick={() => move(section, m.id, -1)}>↑</button>
                          <button type="button" className={historyStyles.toggleBtn} disabled={i === list.length - 1} onClick={() => move(section, m.id, 1)}>↓</button>
                        </div>
                      </td>
                      <td>
                        <div className={calcStyles.inlineFlexGap6}>
                          {(() => {
                            const Icon = resolveModuleIcon(m.icon);
                            return Icon ? <Icon size={16} /> : <span title="Legacy custom icon">{m.icon}</span>;
                          })()}
                          <select
                            className={`${calcStyles.formControl} ${pageStyles.iconSelect}`}
                            value={resolveModuleIcon(m.icon) ? m.icon : ''}
                            onChange={(e) => editModule(m.id, { icon: e.target.value })}
                          >
                            {!resolveModuleIcon(m.icon) && <option value="">(legacy)</option>}
                            {MODULE_ICON_OPTIONS.map((key) => (
                              <option key={key} value={key}>{iconOptionLabel(key)}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td>
                        <input
                          className={calcStyles.formControl}
                          value={m.label}
                          onChange={(e) => editModule(m.id, { label: e.target.value })}
                        />
                        {m.isCustom && <span className={`${historyStyles.rolePill} ${historyStyles.rolePillBackoffice} ${pageStyles.ml6}`}>Custom</span>}
                      </td>
                      <td className={historyStyles.num}>{m.href}</td>
                      <td>
                        <input type="checkbox" checked={m.enabled} onChange={(e) => editModule(m.id, { enabled: e.target.checked })} />
                      </td>
                      {roles.map((r) => (
                        <td key={r.key} className={pageStyles.centerCell}>
                          <input type="checkbox" checked={m.visibleToRoles.includes(r.key)} onChange={() => toggleRole(m.id, r.key)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </AppShell>
  );
}
