'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ProductRecord, ProductStatus } from '@/lib/types';
import { selectAllOnFocusIfZero } from '@/lib/numberInputHelpers';
import { Download, Plus, Pencil, Copy, Power, Trash2, Upload, UserRoundPen, X } from 'lucide-react';
import AppShell from '@/components/AppShell';
import CommonButton from '@/components/ui/CommonButton';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import pageStyles from '@/app/admin/products/productsPage.module.css';
import { SkeletonTable } from '@/components/ui/Skeleton';
import RowActions from './ui/RowActions';
import SearchInput from './ui/SearchInput';
import Dropdown from './ui/Dropdown';
import { setListParam } from '@/lib/listParam';
import Select from '@/components/ui/Select';
import TablePager, { usePagination } from '@/components/ui/TablePager';

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

interface ManagerOption {
  id: string;
  username: string;
  name: string;
}

interface ProductMasterViewProps {
  /** Renders without its own AppShell/Sidebar — for hosting inside a tabbed
      parent page (see components/ProductsAdminView.tsx) instead of as its own route. */
  embedded?: boolean;
}

/** "Manali Akabari" → "MA". */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export default function ProductMasterView({ embedded }: ProductMasterViewProps = {}) {
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
  const [panel, setPanel] = useState<'' | 'add' | 'import'>('');
  // Multi-select filters: an empty list means "all".
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<ProductStatus[]>([]);
  // Every category seen in any load, so filtering by one category doesn't
  // shrink the Category options to just that one (the list is filtered
  // server-side) and strand a multi-select with nothing else to add.
  const [seenCategories, setSeenCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<'percent' | 'flat'>('percent');
  const [bulkField, setBulkField] = useState<'basePrice' | 'sellingPrice'>('sellingPrice');
  const [bulkValue, setBulkValue] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [managerId, setManagerId] = useState('');
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [reassignValue, setReassignValue] = useState('');

  useEffect(() => {
    fetch('/api/admin/products/managers')
      .then((r) => (r.ok ? r.json() : []))
      .then(setManagers)
      .catch(() => setManagers([]));
  }, []);

  // First load only: a reload after an edit keeps the current rows on screen.
  const firstLoad = status === 'Loading...' && products.length === 0;

  async function load() {
    setStatus('Loading...');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      setListParam(params, 'category', categoryFilter);
      setListParam(params, 'status', statusFilter);
      const response = await fetch(`/api/admin/products${params.toString() ? `?${params}` : ''}`);
      if (!response.ok) throw new Error(String(response.status));
      const data: ProductRecord[] = await response.json();
      setProducts(data);
      setSeenCategories((prev) => {
        const next = new Set(prev);
        for (const p of data) if (p.category) next.add(p.category);
        return next.size === prev.length ? prev : Array.from(next);
      });
      setStatus(data.length ? `${data.length} product${data.length === 1 ? '' : 's'}.` : 'No products yet — add one below or import a catalog.');
    } catch {
      setStatus('Could not load products. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const productPager = usePagination(products, 20);
  const categories = useMemo(() => Array.from(new Set([...seenCategories, ...products.map((p) => p.category)].filter(Boolean))).sort(), [seenCategories, products]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const response = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, managerId: managerId || undefined })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setCreateError(body?.error || 'Could not create product.');
        return;
      }
      setForm(BLANK_FORM);
      setManagerId('');
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

  async function saveReassign(id: string, managerId = reassignValue) {
    if (!managerId) return;
    const response = await fetch(`/api/admin/products/${id}/manager`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId })
    });
    if (!response.ok) {
      toast.error('Could not reassign the Product Manager.');
      return;
    }
    toast.success('Product Manager updated.');
    setReassigningId(null);
    setReassignValue('');
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

  const content = (
    <>
        {/* Add / Import open on demand (like "Add employee"), so the product table
            gets the screen with its pager right under it. */}
        <div className={pageStyles.panelActions}>
          <CommonButton variant="primary" size="md" leadingIcon={<Plus />} expanded={panel === 'add'} onClick={() => setPanel((p) => (p === 'add' ? '' : 'add'))}>
            Add product
          </CommonButton>
          <CommonButton variant="secondary" size="md" leadingIcon={<Upload />} expanded={panel === 'import'} onClick={() => setPanel((p) => (p === 'import' ? '' : 'import'))}>
            Import / Export
          </CommonButton>
        </div>
        {panel === 'add' && (
          <>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Add product</h2>
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
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Product Manager (optional — defaults to you)</label>
                <Select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                  <option value="">— Myself —</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{m.name || m.username}</option>)}
                </Select>
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
            <CommonButton type="submit" variant="primary" size="md" leadingIcon={<Plus />} loading={creating} loadingLabel="Adding...">Add Product</CommonButton>
          </form>
          </>
        )}
        {panel === 'import' && (
          <>
          <h2 className={calcStyles.h2}>Import / Export</h2>
          <div className={calcStyles.sectionPanel}>
            <div className={pageStyles.importRow}>
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx" onChange={handleImport} disabled={importing} />
              <CommonButton native href="/api/admin/products/export.csv" variant="secondary" size="md" leadingIcon={<Download />}>Export CSV</CommonButton>
              <CommonButton native href="/api/admin/products/export.xlsx" variant="secondary" size="md" leadingIcon={<Download />}>Export XLSX</CommonButton>
            </div>
            <div className={historyStyles.status}>
              Import matches rows to existing products by SKU (updates them) or creates new ones. Columns: SKU, Product Name, Category, Brand, Description, Unit, Default Qty, Base Price, Selling Price, Tax %, HSN/SAC, Discount %, Status.
            </div>
            {importSummary && <div className={historyStyles.status}>{importSummary}</div>}
          </div>
          </>
        )}

        <h2 className={calcStyles.h2}>Products</h2>
        <div className={historyStyles.toolbar}>
          <SearchInput placeholder="Search name, SKU, brand..." value={q} onChange={(v) => setQ(v)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <Dropdown
            multiselect
            value={categoryFilter}
            onChange={setCategoryFilter}
            placeholder="All categories"
            label="Category"
            options={categories.map((c) => ({ value: c, label: c }))}
          />
          <Dropdown<ProductStatus>
            multiselect
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All statuses"
            label="Status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' }
            ]}
          />
          <CommonButton variant="primary" size="md" onClick={() => load()}>Search</CommonButton>
        </div>
        {!firstLoad && <div className={historyStyles.status}>{status}</div>}

        {selected.size > 0 && (
          <div className={`${calcStyles.sectionPanel} ${pageStyles.bulkBar}`}>
            <strong>{selected.size} selected —</strong>
            <Select auto value={bulkField} onChange={(e) => setBulkField(e.target.value as 'basePrice' | 'sellingPrice')}>
              <option value="sellingPrice">Selling Price</option>
              <option value="basePrice">Base Price</option>
            </Select>
            <Select auto value={bulkMode} onChange={(e) => setBulkMode(e.target.value as 'percent' | 'flat')}>
              <option value="percent">Adjust by %</option>
              <option value="flat">Set to fixed amount</option>
            </Select>
            <input className={`${calcStyles.formControl} ${pageStyles.width120}`} type="number" value={bulkValue === 0 ? '' : bulkValue} onFocus={selectAllOnFocusIfZero} onChange={(e) => setBulkValue(parseFloat(e.target.value) || 0)} placeholder={bulkMode === 'percent' ? '+/- %' : 'Amount'} />
            <CommonButton variant="primary" size="md" onClick={handleBulkUpdate}>Apply Bulk Update</CommonButton>
            <CommonButton variant="secondary" size="md" onClick={() => setSelected(new Set())}>Clear selection</CommonButton>
          </div>
        )}

        {firstLoad ? (
          <SkeletonTable columns={12} rows={6} />
        ) : (
        <>
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
                <th>Manager</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {productPager.rows.map((p) => {
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
                        <td>{p.manager_name || '-'}</td>
                        <td>
                          <Select dropdownSize="sm" auto value={editState.status} onChange={(e) => setEditState({ ...editState, status: e.target.value as ProductStatus })}>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </Select>
                        </td>
                        <td>
                          <div className={pageStyles.actionsRow6}>
                            <CommonButton variant="primary" size="sm" onClick={() => saveEdit(p.id)}>Save</CommonButton>
                            <CommonButton variant="secondary" size="sm" onClick={() => { setEditingId(null); setEditState(null); }}>Cancel</CommonButton>
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
                          {/* Manager: avatar + name on one line; the pen swaps in the common
                              dropdown, and picking a person saves straight away. */}
                          {reassigningId === p.id ? (
                            <div className={pageStyles.managerEdit}>
                              <Dropdown
                                size="sm"
                                ariaLabel="Product Manager"
                                placeholder="Select manager…"
                                clearable={false}
                                value={reassignValue}
                                onChange={(v) => {
                                  setReassignValue(v);
                                  if (v && v !== p.manager_id) void saveReassign(p.id, v);
                                  else setReassigningId(null);
                                }}
                                options={managers.map((m) => ({ value: m.id, label: m.name || m.username, icon: <span className={pageStyles.managerAvatarSm}>{initialsOf(m.name || m.username)}</span> }))}
                              />
                              <CommonButton
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leadingIcon={<X />}
                                aria-label="Cancel"
                                onClick={() => { setReassigningId(null); setReassignValue(''); }}
                              />
                            </div>
                          ) : (
                            <div className={pageStyles.managerCell}>
                              {p.manager_name ? (
                                <>
                                  <span className={pageStyles.managerAvatar} aria-hidden="true">{initialsOf(p.manager_name)}</span>
                                  <span className={pageStyles.managerName} title={p.manager_name}>{p.manager_name}</span>
                                </>
                              ) : (
                                <span className={pageStyles.managerNone}>Unassigned</span>
                              )}
                              {/* Always visible as an icon chip; on hover/focus it opens
                                  out to read "Reassign". */}
                              <button
                                type="button"
                                className={pageStyles.managerChange}
                                aria-label={`Reassign Product Manager for ${p.name}`}
                                onClick={() => { setReassigningId(p.id); setReassignValue(p.manager_id); }}
                              >
                                <UserRoundPen aria-hidden="true" />
                                <span className={pageStyles.managerChangeText}>Reassign</span>
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`${historyStyles.statusPill} ${p.status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
                            {p.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <RowActions
                            label={`Actions for ${p.name}`}
                            actions={[
                              { key: 'edit', label: 'Edit', icon: <Pencil />, onClick: () => startEdit(p) },
                              { key: 'duplicate', label: 'Duplicate', icon: <Copy />, onClick: () => handleDuplicate(p) },
                              { key: 'status', label: p.status === 'active' ? 'Deactivate' : 'Activate', icon: <Power />, onClick: () => toggleStatus(p) },
                              { key: 'delete', label: 'Delete', icon: <Trash2 />, destructive: true, onClick: () => handleDelete(p) }
                            ]}
                          />
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr><td colSpan={10} className={historyStyles.empty}>No products match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager {...productPager.props} noun="products" />
        </>
        )}
    </>
  );

  if (embedded) return content;
  return (
    <AppShell title="Product Master" subtitle="Administration › products available to pick from in every quotation's Custom Products list.">
      {content}
    </AppShell>
  );
}
