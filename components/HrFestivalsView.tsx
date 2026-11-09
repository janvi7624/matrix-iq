'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2, Pencil, Plus, X } from 'lucide-react';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface FestivalRecord {
  id: string;
  key: string;
  name: string;
  date: string;
  greeting: string;
  provisional: boolean;
}

const EMPTY_FORM = { key: '', name: '', date: '', greeting: '', provisional: false };

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
}

// HR's own management screen for the company-wide Indian festival greeting
// calendar (see lib/festivalStore.ts) — add next year's confirmed dates,
// fix a wrong one, or remove a festival the company doesn't want to
// greet for, without needing a code change or a deploy.
export default function HrFestivalsView() {
  const [festivals, setFestivals] = useState<FestivalRecord[]>([]);
  const [status, setStatus] = useState('Loading…');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/hr/festivals');
      if (!response.ok) {
        setStatus(response.status === 403 ? 'You do not have access to manage festival greetings.' : 'Could not load the festival list.');
        setFestivals([]);
        return;
      }
      const data: FestivalRecord[] = await response.json();
      setFestivals(data);
      setStatus(data.length ? '' : 'No festivals configured yet.');
    } catch {
      setStatus('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowForm(true);
  }

  function startEdit(f: FestivalRecord) {
    setEditId(f.id);
    setForm({ key: f.key, name: f.name, date: f.date, greeting: f.greeting, provisional: f.provisional });
    setError('');
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const url = editId ? `/api/hr/festivals/${editId}` : '/api/hr/festivals';
      const method = editId ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Could not save the festival.' }));
        setError(body.error || 'Could not save the festival.');
        return;
      }
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove "${name}" from the festival calendar? This cannot be undone.`)) return;
    const response = await fetch(`/api/hr/festivals/${id}`, { method: 'DELETE' });
    if (response.ok) await load();
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell title="Festival Greetings" subtitle="HR › Indian festival calendar for company-wide greetings">
      <div className={historyStyles.toolbar}>
        <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={startAdd}>
          <Plus size={16} /> Add Festival
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className={calcStyles.sectionPanel} style={{ marginBottom: 16 }}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="festival-name">Name *</label>
              <input
                id="festival-name"
                type="text"
                className={calcStyles.formControl}
                required
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({ ...f, name, key: editId ? f.key : slugify(name) }));
                }}
                placeholder="e.g. Diwali"
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="festival-date">Date *</label>
              <input
                id="festival-date"
                type="date"
                className={calcStyles.formControl}
                required
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="festival-key">Key *</label>
              <input
                id="festival-key"
                type="text"
                className={calcStyles.formControl}
                required
                pattern="[a-z0-9-]+"
                title="Lowercase letters, numbers, and hyphens only"
                value={form.key}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                placeholder="e.g. diwali-2028"
              />
            </div>
          </div>
          <div className={calcStyles.field} style={{ marginTop: 8 }}>
            <label className={calcStyles.label} htmlFor="festival-greeting">Greeting message *</label>
            <textarea
              id="festival-greeting"
              className={calcStyles.formControl}
              required
              rows={3}
              value={form.greeting}
              onChange={(e) => setForm((f) => ({ ...f, greeting: e.target.value }))}
              placeholder="e.g. Happy Diwali! May this festival of lights bring prosperity, joy, and brightness to you and your family."
            />
          </div>
          <div className={`${calcStyles.field} ${calcStyles.mt8}`}>
            <label className={calcStyles.inlineFlexGap8}>
              <input
                type="checkbox"
                checked={form.provisional}
                onChange={(e) => setForm((f) => ({ ...f, provisional: e.target.checked }))}
              />
              Provisional (lunar-calendar date not yet officially confirmed — e.g. Eid, which is confirmed only by moon sighting a day or two ahead)
            </label>
          </div>
          {error && <p style={{ color: 'var(--mx-danger)', marginTop: 8 }}>{error}</p>}
          <div className={`${calcStyles.inlineFlexGap8} ${calcStyles.mt8}`}>
            <button type="submit" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={saving}>
              {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Festival'}
            </button>
            <button type="button" className={historyStyles.button} onClick={() => setShowForm(false)}>
              <X size={14} /> Cancel
            </button>
          </div>
        </form>
      )}

      {status && <p className={calcStyles.small}>{status}</p>}

      {festivals.length > 0 && (
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Name</th>
              <th>Greeting</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {festivals.map((f) => (
              <tr key={f.id} style={f.date === today ? { fontWeight: 600 } : undefined}>
                <td>{formatDate(f.date)}</td>
                <td>{f.name}</td>
                <td style={{ maxWidth: 360 }}>{f.greeting}</td>
                <td>
                  {f.date === today && <span style={{ color: 'var(--mx-success)' }}>Today</span>}
                  {f.provisional && <span style={{ color: 'var(--mx-warning)', marginLeft: 6 }}>Provisional — confirm date</span>}
                </td>
                <td>
                  <button
                    type="button"
                    className={`${historyStyles.actionBtn} ${historyStyles.actionBtnSecondary}`}
                    onClick={() => startEdit(f)}
                    aria-label={`Edit ${f.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className={`${historyStyles.actionBtn} ${historyStyles.actionBtnDanger}`}
                    onClick={() => handleDelete(f.id, f.name)}
                    aria-label={`Delete ${f.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
