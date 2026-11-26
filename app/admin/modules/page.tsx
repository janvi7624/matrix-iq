'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleConfigRecord, RoleRecord, UserRole } from '@/lib/types';
import { ArrowDown, ArrowUp, LayoutGrid, Pencil, RotateCcw, Save } from 'lucide-react';
import AppShell from '@/components/AppShell';
import CommonButton from '@/components/ui/CommonButton';
import { MODULE_ICON_OPTIONS, resolveModuleIcon } from '@/lib/icons';
import { useToast } from '@/components/ui/ToastProvider';
import pageStyles from './modulesPage.module.css';
import { refreshShellData } from '@/lib/shellDataStore';
import { SkeletonTable } from '@/components/ui/Skeleton';
import Dropdown from '@/components/ui/Dropdown';
import SearchInput from '@/components/ui/SearchInput';

function iconOptionLabel(key: string): string {
  return key.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
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
  const [q, setQ] = useState('');
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
      // Visibility/order/labels feed the sidebar — refresh the once-per-login menu.
      void refreshShellData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save these changes.');
      // Deliberately NOT reloading — the draft is kept so the edits aren't
      // lost and can be retried.
    } finally {
      setSaving(false);
    }
  }

  // Icon picker options — each shows its icon, so you choose by looking, not by name.
  const iconOptions = MODULE_ICON_OPTIONS.map((key) => {
    const Icon = resolveModuleIcon(key);
    return { value: key, label: iconOptionLabel(key), icon: Icon ? <Icon size={16} /> : undefined };
  });

  const query = q.trim().toLowerCase();
  const matches = (m: ModuleConfigRecord) => !query || `${m.label} ${m.href} ${m.section}`.toLowerCase().includes(query);

  return (
    <AppShell title="Module Manager" subtitle="Administration › enable, disable, rename, reorder, and set role visibility for every module — no code required.">
      {status && status !== 'Loading...' && <div className={pageStyles.notice}>{status}</div>}

      {/* Search + save state in one sticky bar: always in reach while editing any row. */}
      <div className={`${pageStyles.saveBar} ${dirty ? pageStyles.saveBarActive : ''}`}>
        <SearchInput inline value={q} onChange={setQ} placeholder="Search modules or links…" aria-label="Search modules" />
        <span className={pageStyles.saveBarText} aria-live="polite">
          {dirty ? (
            <>
              <span className={pageStyles.dot} aria-hidden="true" />
              {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}
            </>
          ) : (
            'All changes saved'
          )}
        </span>
        <div className={pageStyles.saveActions}>
          <CommonButton variant="ghost" size="md" leadingIcon={<RotateCcw />} onClick={discard} disabled={!dirty || saving}>
            Discard
          </CommonButton>
          <CommonButton variant="primary" size="md" leadingIcon={<Save />} onClick={save} disabled={!dirty} loading={saving} loadingLabel="Saving…">
            Save changes
          </CommonButton>
        </div>
      </div>

      <p className={pageStyles.hint}>
        Turning a module off hides it for everyone (its data is kept). The role columns choose who sees it while it&apos;s on. Nothing is applied until you press <strong>Save changes</strong>.
      </p>

      {status === 'Loading...' && <SkeletonTable rows={8} columns={5} />}

      {[...bySection.entries()].map(([section, list]) => {
        const visible = list.filter(matches);
        if (!visible.length) return null;
        const onCount = list.filter((m) => m.enabled).length;
        return (
          <section key={section} className={pageStyles.section} aria-labelledby={`sec-${section}`}>
            <header className={pageStyles.sectionHead}>
              <span className={pageStyles.sectionIcon} aria-hidden="true">
                <LayoutGrid />
              </span>
              <h2 id={`sec-${section}`} className={pageStyles.sectionTitle}>{section}</h2>
              <span className={pageStyles.sectionCount}>
                {onCount} of {list.length} on
              </span>
              {reorderedSections.includes(section) && <span className={pageStyles.pendingChip}>Order changed</span>}
            </header>

            <div className={pageStyles.tableWrap}>
              <table className={pageStyles.table} data-mobile-layout="scroll">
                <thead>
                  <tr>
                    <th className={pageStyles.colOrder}>Order</th>
                    <th className={pageStyles.colModule}>Module</th>
                    <th className={pageStyles.colEnabled}>Enabled</th>
                    {roles.map((r) => (
                      <th key={r.key} className={pageStyles.colRole} title={r.label}>
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => {
                    const i = list.indexOf(m);
                    const Icon = resolveModuleIcon(m.icon);
                    const changed = changedIds.has(m.id);
                    return (
                      <tr key={m.id} className={[changed ? pageStyles.rowDirty : '', m.enabled ? '' : pageStyles.rowOff].filter(Boolean).join(' ') || undefined}>
                        {/* Order (disabled while searching — positions are within the whole section) */}
                        <td className={pageStyles.colOrder}>
                          <div className={pageStyles.order}>
                            <button type="button" className={pageStyles.orderBtn} aria-label={`Move ${m.label} up`} disabled={i === 0 || !!query} onClick={() => move(section, m.id, -1)}>
                              <ArrowUp />
                            </button>
                            <span className={pageStyles.orderNum}>{i + 1}</span>
                            <button type="button" className={pageStyles.orderBtn} aria-label={`Move ${m.label} down`} disabled={i === list.length - 1 || !!query} onClick={() => move(section, m.id, 1)}>
                              <ArrowDown />
                            </button>
                          </div>
                        </td>

                        {/* Icon + label + icon picker + link */}
                        <td className={pageStyles.colModule}>
                          <div className={pageStyles.identity}>
                            <span className={pageStyles.iconTile} aria-hidden="true">
                              {Icon ? <Icon /> : <span title="Legacy custom icon">{m.icon}</span>}
                            </span>
                            <div className={pageStyles.nameBlock}>
                              <div className={pageStyles.nameField}>
                                <input
                                  id={`mod-label-${m.id}`}
                                  className={pageStyles.nameInput}
                                  value={m.label}
                                  placeholder="Module name"
                                  aria-label={`Label for ${m.href}`}
                                  onChange={(e) => editModule(m.id, { label: e.target.value })}
                                />
                                <Pencil className={pageStyles.nameEditIcon} aria-hidden="true" />
                              </div>
                              <div className={pageStyles.metaLine}>
                                <div className={pageStyles.iconPick}>
                                  <Dropdown
                                    size="sm"
                                    fullWidth
                                    clearable={false}
                                    searchable
                                    ariaLabel={`Icon for ${m.label}`}
                                    placeholder="Legacy icon"
                                    value={Icon ? m.icon : ''}
                                    onChange={(v) => {
                                      if (v) editModule(m.id, { icon: v });
                                    }}
                                    options={iconOptions}
                                  />
                                </div>
                                <code className={pageStyles.href}>{m.href}</code>
                                {m.isCustom && <span className={pageStyles.customPill}>Custom</span>}
                                {changed && <span className={pageStyles.editedPill}>Edited</span>}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className={pageStyles.colEnabled}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={m.enabled}
                            aria-label={`${m.label} ${m.enabled ? 'on' : 'off'}`}
                            className={`${pageStyles.switch} ${m.enabled ? pageStyles.switchOn : ''}`}
                            onClick={() => editModule(m.id, { enabled: !m.enabled })}
                          >
                            <span className={pageStyles.switchTrack} aria-hidden="true">
                              <span className={pageStyles.switchThumb} />
                            </span>
                          </button>
                        </td>

                        {roles.map((r) => (
                          <td key={r.key} className={pageStyles.colRole}>
                            <input
                              type="checkbox"
                              className={pageStyles.roleBox}
                              aria-label={`${r.label} can see ${m.label}`}
                              disabled={!m.enabled}
                              checked={m.visibleToRoles.includes(r.key)}
                              onChange={() => toggleRole(m.id, r.key)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {status === '' && query && ![...bySection.values()].some((list) => list.some(matches)) && (
        <div className={pageStyles.notice}>No modules match “{q}”.</div>
      )}
    </AppShell>
  );
}
