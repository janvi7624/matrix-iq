'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ModuleConfigRecord, RoleRecord, UserRole } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';

// Short column header for a role — first word, capped so the table stays readable.
function shortLabel(label: string): string {
  const first = label.split(' ')[0];
  return first.length > 6 ? first.slice(0, 6) : first;
}

export default function ModuleManagerPage() {
  const [modules, setModules] = useState<ModuleConfigRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [status, setStatus] = useState('Loading...');

  async function load() {
    setStatus('Loading...');
    try {
      const [modulesRes, rolesRes] = await Promise.all([fetch('/api/admin/modules'), fetch('/api/admin/roles')]);
      if (!modulesRes.ok) throw new Error(String(modulesRes.status));
      const data: ModuleConfigRecord[] = await modulesRes.json();
      const rolesData: RoleRecord[] = rolesRes.ok ? await rolesRes.json() : [];
      setModules(data);
      setRoles(rolesData.filter((r) => r.status === 'active'));
      setStatus('');
    } catch {
      setStatus('Could not load modules. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const bySection = useMemo(() => {
    const groups = new Map<string, ModuleConfigRecord[]>();
    modules.forEach((m) => {
      const list = groups.get(m.section) || [];
      list.push(m);
      groups.set(m.section, list);
    });
    for (const list of groups.values()) list.sort((a, b) => a.order - b.order);
    return groups;
  }, [modules]);

  async function patch(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/modules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      alert('Could not save this change.');
      return;
    }
    await load();
  }

  async function move(section: string, id: string, direction: -1 | 1) {
    const list = [...(bySection.get(section) || [])];
    const index = list.findIndex((m) => m.id === id);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= list.length) return;
    [list[index], list[swapWith]] = [list[swapWith], list[index]];
    const orderedIds = list.map((m) => m.id);
    const response = await fetch('/api/admin/modules/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds })
    });
    if (!response.ok) {
      alert('Could not reorder.');
      return;
    }
    await load();
  }

  function toggleRole(m: ModuleConfigRecord, role: UserRole) {
    const has = m.visibleToRoles.includes(role);
    const next = has ? m.visibleToRoles.filter((r) => r !== role) : [...m.visibleToRoles, role];
    patch(m.id, { visibleToRoles: next });
  }

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <Link href="/" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>Module Manager</h1>
            <div className={historyStyles.sub}>Administration &rsaquo; enable, disable, rename, reorder, and set role visibility for every module — no code required.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className={historyStyles.button} href="/admin/custom-modules">Custom Module Builder</Link>
          <Link className={historyStyles.button} href="/">Back to Dashboard</Link>
        </div>
      </header>
      <main className={historyStyles.main}>
        <div className={historyStyles.status}>{status}</div>
        <div className={historyStyles.status}>
          Disabling a module hides it from the Dashboard for everyone (data is never deleted). Role columns control who sees it when enabled.
        </div>

        {[...bySection.entries()].map(([section, list]) => (
          <div key={section} style={{ marginBottom: 24 }}>
            <h2 className={calcStyles.h2}>{section}</h2>
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Icon</th>
                    <th>Label</th>
                    <th>Href</th>
                    <th>Enabled</th>
                    {roles.map((r) => <th key={r.key} style={{ textAlign: 'center' }} title={r.label}>{shortLabel(r.label)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.map((m, i) => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className={historyStyles.toggleBtn} disabled={i === 0} onClick={() => move(section, m.id, -1)}>↑</button>
                          <button type="button" className={historyStyles.toggleBtn} disabled={i === list.length - 1} onClick={() => move(section, m.id, 1)}>↓</button>
                        </div>
                      </td>
                      <td>
                        <input className={calcStyles.formControl} style={{ width: 56 }} value={m.icon} onChange={(e) => setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, icon: e.target.value } : x)))} onBlur={(e) => patch(m.id, { icon: e.target.value })} />
                      </td>
                      <td>
                        <input className={calcStyles.formControl} value={m.label} onChange={(e) => setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)))} onBlur={(e) => patch(m.id, { label: e.target.value })} />
                        {m.isCustom && <span className={`${historyStyles.rolePill} ${historyStyles.rolePillBackoffice}`} style={{ marginLeft: 6 }}>Custom</span>}
                      </td>
                      <td className={historyStyles.num}>{m.href}</td>
                      <td>
                        <input type="checkbox" checked={m.enabled} onChange={(e) => patch(m.id, { enabled: e.target.checked })} />
                      </td>
                      {roles.map((r) => (
                        <td key={r.key} style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={m.visibleToRoles.includes(r.key)} onChange={() => toggleRole(m, r.key)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
