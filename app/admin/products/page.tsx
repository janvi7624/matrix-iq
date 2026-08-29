'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ProductRecord, ProductStatus } from '@/lib/types';
import { selectAllOnFocusIfZero } from '@/lib/numberInputHelpers';
import AppShell from '@/components/AppShell';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmDialog';

interface ProductForm {
  name: string;
  sku: string;
  category: string;
  brand: string;
  description: string;
  unit: string;
  defaultQty: number;
  basePrice: number;
  sellingPrice: number;
  taxPercent: number;
  hsnSac: string;
  discountPercent: number;
  status: ProductStatus;
}

const BLANK_FORM: ProductForm = {
  name: '', sku: '', category: '', brand: '', description: '', unit: 'Nos',
  defaultQty: 1, basePrice: 0, sellingPrice: 0, taxPercent: 0, hsnSac: '', discountPercent: 0, status: 'active'
};

export default function ProductMasterPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState<ProductForm>(BLANK_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<ProductForm | null>(null);
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProductStatus | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<'percent' | 'flat'>('percent');
  const [bulkField, setBulkField] = useState<'basePrice' | 'sellingPrice'>('sellingPrice');
  const [bulkValue, setBulkValue] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setStatus('Loading...');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (categoryFilter) params.set('category', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);
      const response = await fetch(`/api/admin/products${params.toString() ? `?${params}` : ''}`);
      if (!response.ok) throw new Error(String(response.status));
      const data: ProductRecord[] = await response.json();
      setProducts(data);
      setStatus(data.length ? `${data.length} product${data.length === 1 ? '' : 's'}.` : 'No products yet — add one below or import a catalog.');
    } catch {
      setStatus('Could not load products. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(), [products]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const response = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setCreateError(body?.error || 'Could not create product.');
        return;
      }
      setForm(BLANK_FORM);
      await load();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(p: ProductRecord) {
    setEditingId(p.id);
    setEditState({
      name: p.name, sku: p.sku, category: p.category, brand: p.brand, description: p.description, unit: p.unit,
      defaultQty: p.defaultQty, basePrice: p.basePrice, sellingPrice: p.sellingPrice, taxPercent: p.taxPercent,
      hsnSac: p.hsnSac, discountPercent: p.discountPercent, status: p.status
    });
  }

  async function saveEdit(id: string) {
    if (!editState) return;
    const response = await fetch(`/api/admin/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editState)
    });
    if (!response.ok) {
      toast.error('Could not save changes.');
      return;
    }
    setEditingId(null);
    setEditState(null);
    await load();
  }

  async function toggleStatus(p: ProductRecord) {
    const next = p.status === 'active' ? 'inactive' : 'active';
    await fetch(`/api/admin/products/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
    await load();
  }

  async function handleDuplicate(p: ProductRecord) {
    const response = await fetch(`/api/admin/products/${p.id}/duplicate`, { method: 'POST' });
    if (!response.ok) {
      toast.error('Could not duplicate product.');
      return;
    }
    await load();
  }

  async function handleDelete(p: ProductRecord) {
    if (!(await confirm({ message: `Delete "${p.name}"? This cannot be undone.`, danger: true }))) return;
    const response = await fetch(`/api/admin/products/${p.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Could not delete product.');
      return;
    }
    await load();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkUpdate() {
    if (selected.size === 0) return;
    const response = await fetch('/api/admin/products/bulk-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected), field: bulkField, mode: bulkMode, value: bulkValue })
    });
    if (!response.ok) {
      toast.error('Could not apply bulk price update.');
      return;
    }
    const body = await response.json();
    setSelected(new Set());
    await load();
    toast.success(`Updated ${body.updated} product(s).`);
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportSummary('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/admin/products/import', { method: 'POST', body: formData });
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json();
      setImportSummary(`Imported: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`);
      await load();
    } catch {
      setImportSummary('Import failed. Check the file format and try again.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <AppShell title="Product Master" subtitle="Administration › products available to pick from in every quotation's Custom Products list.">
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Add product</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          {createError && <div className={historyStyles.loginError}>{createError}</div>}
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Product name</label>
              <input className={calcStyles.formControl} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>SKU / Product code</label>
              <input className={calcStyles.formControl} value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Category</label>
              <input className={calcStyles.formControl} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Brand</label>
              <input className={calcStyles.formControl} value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Unit</label>
              <input className={calcStyles.formControl} value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Description</label>
            <input className={calcStyles.formControl} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Default Qty</label>
              <input className={calcStyles.formControl} type="number" min={1} value={form.defaultQty === 0 ? '' : form.defaultQty} onFocus={selectAllOnFocusIfZero} onChange={(e) => setForm((f) => ({ ...f, defaultQty: parseInt(e.target.value, 10) || 1 }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Base Price</label>
              <input className={calcStyles.formControl} type="number" placeholder="Enter Base Price" value={form.basePrice === 0 ? '' : form.basePrice} onFocus={selectAllOnFocusIfZero} onChange={(e) => setForm((f) => ({ ...f, basePrice: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Selling Price</label>
              <input className={calcStyles.formControl} type="number" placeholder="Enter Selling Price" value={form.sellingPrice === 0 ? '' : form.sellingPrice} onFocus={selectAllOnFocusIfZero} onChange={(e) => setForm((f) => ({ ...f, sellingPrice: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Tax %</label>
              <input className={calcStyles.formControl} type="number" value={form.taxPercent === 0 ? '' : form.taxPercent} onFocus={selectAllOnFocusIfZero} onChange={(e) => setForm((f) => ({ ...f, taxPercent: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>HSN/SAC (optional)</label>
              <input className={calcStyles.formControl} value={form.hsnSac} onChange={(e) => setForm((f) => ({ ...f, hsnSac: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Discount %</label>
              <input className={calcStyles.formControl} type="number" value={form.discountPercent === 0 ? '' : form.discountPercent} onFocus={selectAllOnFocusIfZero} onChange={(e) => setForm((f) => ({ ...f, discountPercent: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>{creating ? 'Adding...' : '+ Add Product'}</button>
        </form>

        <h2 className={calcStyles.h2}>Import / Export</h2>
        <div className={calcStyles.sectionPanel}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx" onChange={handleImport} disabled={importing} />
            <a className={historyStyles.button} href="/api/admin/products/export.csv">Export CSV</a>
            <a className={historyStyles.button} href="/api/admin/products/export.xlsx">Export XLSX</a>
          </div>
          <div className={historyStyles.status}>
            Import matches rows to existing products by SKU (updates them) or creates new ones. Columns: SKU, Product Name, Category, Brand, Description, Unit, Default Qty, Base Price, Selling Price, Tax %, HSN/SAC, Discount %, Status.
          </div>
          {importSummary && <div className={historyStyles.status}>{importSummary}</div>}
        </div>

        <h2 className={calcStyles.h2}>Products</h2>
        <div className={historyStyles.toolbar}>
          <input type="text" placeholder="Search name, SKU, brand..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ProductStatus | '')}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => load()}>Search</button>
        </div>
        <div className={historyStyles.status}>{status}</div>

        {selected.size > 0 && (
          <div className={calcStyles.sectionPanel} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <strong>{selected.size} selected —</strong>
            <select className={calcStyles.formControl} style={{ width: 'auto' }} value={bulkField} onChange={(e) => setBulkField(e.target.value as 'basePrice' | 'sellingPrice')}>
              <option value="sellingPrice">Selling Price</option>
              <option value="basePrice">Base Price</option>
            </select>
            <select className={calcStyles.formControl} style={{ width: 'auto' }} value={bulkMode} onChange={(e) => setBulkMode(e.target.value as 'percent' | 'flat')}>
              <option value="percent">Adjust by %</option>
              <option value="flat">Set to fixed amount</option>
            </select>
            <input className={calcStyles.formControl} style={{ width: 120 }} type="number" value={bulkValue === 0 ? '' : bulkValue} onFocus={selectAllOnFocusIfZero} onChange={(e) => setBulkValue(parseFloat(e.target.value) || 0)} placeholder={bulkMode === 'percent' ? '+/- %' : 'Amount'} />
            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={handleBulkUpdate}>Apply Bulk Update</button>
            <button type="button" className={historyStyles.button} onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}

        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Brand</th>
                <th>Unit</th>
                <th>Base Price</th>
                <th>Selling Price</th>
                <th>Tax %</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const isEditing = editingId === p.id;
                return (
                  <tr key={p.id}>
                    <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} /></td>
                    {isEditing && editState ? (
                      <>
                        <td><input className={calcStyles.formControl} value={editState.name} onChange={(e) => setEditState({ ...editState, name: e.target.value })} /></td>
                        <td><input className={calcStyles.formControl} value={editState.sku} onChange={(e) => setEditState({ ...editState, sku: e.target.value })} /></td>
                        <td><input className={calcStyles.formControl} value={editState.category} onChange={(e) => setEditState({ ...editState, category: e.target.value })} /></td>
                        <td><input className={calcStyles.formControl} value={editState.brand} onChange={(e) => setEditState({ ...editState, brand: e.target.value })} /></td>
                        <td><input className={calcStyles.formControl} value={editState.unit} onChange={(e) => setEditState({ ...editState, unit: e.target.value })} /></td>
                        <td><input className={calcStyles.formControl} type="number" value={editState.basePrice} onChange={(e) => setEditState({ ...editState, basePrice: parseFloat(e.target.value) || 0 })} /></td>
                        <td><input className={calcStyles.formControl} type="number" value={editState.sellingPrice} onChange={(e) => setEditState({ ...editState, sellingPrice: parseFloat(e.target.value) || 0 })} /></td>
                        <td><input className={calcStyles.formControl} type="number" value={editState.taxPercent} onChange={(e) => setEditState({ ...editState, taxPercent: parseFloat(e.target.value) || 0 })} /></td>
                        <td>
                          <select className={calcStyles.formControl} value={editState.status} onChange={(e) => setEditState({ ...editState, status: e.target.value as ProductStatus })}>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => saveEdit(p.id)}>Save</button>
                            <button type="button" className={historyStyles.button} onClick={() => { setEditingId(null); setEditState(null); }}>Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{p.name}</td>
                        <td className={historyStyles.num}>{p.sku || '-'}</td>
                        <td>{p.category || '-'}</td>
                        <td>{p.brand || '-'}</td>
                        <td>{p.unit}</td>
                        <td className={historyStyles.amount}>{p.basePrice.toFixed(2)}</td>
                        <td className={historyStyles.amount}>{p.sellingPrice.toFixed(2)}</td>
                        <td>{p.taxPercent}%</td>
                        <td>
                          <span className={`${historyStyles.statusPill} ${p.status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
                            {p.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" className={historyStyles.button} onClick={() => startEdit(p)}>Edit</button>
                            <button type="button" className={historyStyles.button} onClick={() => handleDuplicate(p)}>Duplicate</button>
                            <button type="button" className={historyStyles.button} onClick={() => toggleStatus(p)}>{p.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                            <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(p)}>Delete</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr><td colSpan={11} className={historyStyles.empty}>No products match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
    </AppShell>
  );
}
