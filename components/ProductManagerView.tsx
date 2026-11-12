'use client';

import { FormEvent, useEffect, useState } from 'react';
import AppShell from './AppShell';
import { SkeletonRows } from './ui/Skeleton';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import { ProductManagerNoteRecord, ProductManagerNoteType, ProductManagerRollup, ProductRecord } from '@/lib/types';

interface MyData {
  rollup: ProductManagerRollup | null;
  products: ProductRecord[];
  notes: ProductManagerNoteRecord[];
}

const NOTE_LABEL: Record<ProductManagerNoteType, string> = { feedback: 'Feedback received', action: 'Action taken', plan: 'Next plan' };

function money(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function ProductManagerView() {
  const [data, setData] = useState<MyData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [noteType, setNoteType] = useState<ProductManagerNoteType>('feedback');
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const response = await fetch('/api/product-manager');
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
    } catch {
      setLoadError('Could not load your products.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/product-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: noteType, text: noteText.trim() })
      });
      if (response.ok) {
        setNoteText('');
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  const content = !data ? (
    loadError ? <div className={historyStyles.loginError}>{loadError}</div> : <SkeletonRows rows={4} />
  ) : (
    <>
      <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>My Products</h2>
      {data.products.length === 0 ? (
        <div className={historyStyles.status}>You haven&apos;t created any products yet — products are added from the Product Master screen (Admin), and whoever creates one becomes its Product Manager.</div>
      ) : (
        <>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.sectionPanel}><strong>Pending</strong><div>₹{money(data.rollup?.pending_value || 0)}</div></div>
            <div className={calcStyles.sectionPanel}><strong>Won</strong><div>₹{money(data.rollup?.won_value || 0)}</div></div>
            <div className={calcStyles.sectionPanel}><strong>Lost</strong><div>₹{money(data.rollup?.lost_value || 0)}</div></div>
          </div>
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr><th>Name</th><th>SKU</th><th>Category</th><th>Type</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className={historyStyles.num}>{p.sku || '-'}</td>
                    <td>{p.category || '-'}</td>
                    <td>{p.type}</td>
                    <td>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className={calcStyles.h2}>Feedback &amp; Plan</h2>
      <form className={calcStyles.sectionPanel} onSubmit={handleAddNote}>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Type</label>
            <select className={calcStyles.formControl} value={noteType} onChange={(e) => setNoteType(e.target.value as ProductManagerNoteType)}>
              <option value="feedback">Feedback received</option>
              <option value="action">Action taken</option>
              <option value="plan">Next plan</option>
            </select>
          </div>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Notes</label>
          <textarea className={calcStyles.formControl} value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} required />
        </div>
        <button type="submit" className={calcStyles.btn} disabled={saving}>{saving ? 'Saving...' : '+ Add Entry'}</button>
      </form>

      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead><tr><th>Type</th><th>Note</th><th>By</th><th>Date</th></tr></thead>
          <tbody>
            {data.notes.map((n) => (
              <tr key={n.id}>
                <td>{NOTE_LABEL[n.type]}</td>
                <td>{n.text}</td>
                <td>{n.created_by || '-'}</td>
                <td>{n.created_at ? new Date(n.created_at).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
            {data.notes.length === 0 && <tr><td colSpan={4}>No entries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <AppShell title="My Products" subtitle="Products you created, their Pending/Won/Lost value, and your feedback/action/plan log">
      {content}
    </AppShell>
  );
}
