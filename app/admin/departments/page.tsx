'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { DepartmentRecord } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';

export default function DepartmentMasterPage() {
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<{ name: string; description: string } | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/admin/departments');
      if (!response.ok) throw new Error(String(response.status));
      const data: DepartmentRecord[] = await response.json();
      setDepartments(data);
      setStatus(`${data.length} department${data.length === 1 ? '' : 's'}.`);
    } catch {
      setStatus('Could not load departments. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (!q.trim()) return departments;
    const needle = q.trim().toLowerCase();
    return departments.filter((d) => d.name.toLowerCase().includes(needle) || d.description.toLowerCase().includes(needle));
  }, [departments, q]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const response = await fetch('/api/admin/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setCreateError(body?.error || 'Could not add department.');
        return;
      }
      setName('');
      setDescription('');
      await load();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setRowError((prev) => ({ ...prev, [id]: '' }));
    const response = await fetch(`/api/admin/departments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      setRowError((prev) => ({ ...prev, [id]: errBody?.error || 'Could not save changes.' }));
      return false;
    }
    await load();
    return true;
  }

  function startEdit(d: DepartmentRecord) {
    setEditingId(d.id);
    setEditState({ name: d.name, description: d.description });
  }

  async function saveEdit(id: string) {
    if (!editState) return;
    const ok = await patch(id, { name: editState.name, description: editState.description });
    if (ok) {
      setEditingId(null);
      setEditState(null);
    }
  }

  async function toggleStatus(d: DepartmentRecord) {
    const next = d.status === 'active' ? 'inactive' : 'active';
    await patch(d.id, { status: next });
  }

  async function move(id: string, direction: -1 | 1) {
    const list = [...departments].sort((a, b) => a.order - b.order);
    const index = list.findIndex((d) => d.id === id);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= list.length) return;
    [list[index], list[swapWith]] = [list[swapWith], list[index]];
    const response = await fetch('/api/admin/departments/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: list.map((d) => d.id) })
    });
    if (!response.ok) {
      alert('Could not reorder.');
      return;
    }
    await load();
  }

  async function handleDelete(d: DepartmentRecord) {
    if (!window.confirm(`Delete department "${d.name}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/admin/departments/${d.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      alert(body?.error || 'Could not delete department.');
      return;
    }
    await load();
  }

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <Link href="/" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>Department Master</h1>
            <div className={historyStyles.sub}>Administration &rsaquo; departments used across user profiles — no code change required.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={historyStyles.button} href="/admin/users">User Management</Link>
          <Link className={historyStyles.button} href="/">Back to Dashboard</Link>
        </div>
      </header>
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Add department</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          {createError && <div className={historyStyles.loginError}>{createError}</div>}
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="deptName">Department name</label>
              <input id="deptName" className={calcStyles.formControl} type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="deptDesc">Description (optional)</label>
              <input id="deptDesc" className={calcStyles.formControl} type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>{creating ? 'Adding...' : '+ Add department'}</button>
        </form>

        <h2 className={calcStyles.h2}>Departments</h2>
        <div className={historyStyles.toolbar}>
          <input type="text" placeholder="Search departments..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className={historyStyles.status}>{status}</div>
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Description</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...visible].sort((a, b) => a.order - b.order).map((d, i, arr) => {
                const isEditing = editingId === d.id;
                return (
                  <tr key={d.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className={historyStyles.toggleBtn} disabled={i === 0} onClick={() => move(d.id, -1)}>↑</button>
                        <button type="button" className={historyStyles.toggleBtn} disabled={i === arr.length - 1} onClick={() => move(d.id, 1)}>↓</button>
                      </div>
                    </td>
                    {isEditing && editState ? (
                      <>
                        <td>
                          <input className={calcStyles.formControl} value={editState.name} onChange={(e) => setEditState({ ...editState, name: e.target.value })} />
                        </td>
                        <td>
                          <input className={calcStyles.formControl} value={editState.description} onChange={(e) => setEditState({ ...editState, description: e.target.value })} />
                        </td>
                        <td>{d.status === 'active' ? 'Active' : 'Inactive'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => saveEdit(d.id)}>Save</button>
                            <button type="button" className={historyStyles.button} onClick={() => { setEditingId(null); setEditState(null); }}>Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{d.name}</td>
                        <td>{d.description || '-'}</td>
                        <td>
                          <span className={`${historyStyles.statusPill} ${d.status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
                            {d.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" className={historyStyles.button} onClick={() => startEdit(d)}>Edit</button>
                            <button type="button" className={historyStyles.button} onClick={() => toggleStatus(d)}>
                              {d.status === 'active' ? 'Deactivate' : 'Activate'}
                            </button>
                            <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(d)}>Delete</button>
                          </div>
                          {rowError[d.id] && <div className={historyStyles.loginError}>{rowError[d.id]}</div>}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={5} className={historyStyles.empty}>No departments match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
