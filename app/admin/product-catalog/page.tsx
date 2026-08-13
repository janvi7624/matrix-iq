'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BRAND } from '@/lib/branding';
import { CATALOGS, CatalogDef, findCatalog, PriceFieldDef } from '@/lib/catalogRegistry';
import { CatalogOverrideRow } from '@/lib/catalogOverrides';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';

// Rendered tabs, in registry order, minus conference-accessory — that one
// nests under "AV — Conferencing" as a sub-table instead of its own tab
// (it's conceptually a sub-item of that domain, not a peer catalog).
const TAB_CATALOGS = CATALOGS.filter((c) => c.id !== 'conference-accessory');
const CONFERENCE_ACCESSORY = findCatalog('conference-accessory')!;

interface OverrideRecord extends CatalogOverrideRow {
  id: string;
  updatedBy: string;
}

function fieldValue(field: PriceFieldDef, record: Record<string, unknown>): string {
  const value = record[field.key];
  if (field.arrayLabels) return '';
  return value === null || value === undefined ? '' : String(value);
}

function fieldArrayValue(field: PriceFieldDef, record: Record<string, unknown>, i: number): string {
  const arr = record[field.key];
  if (!Array.isArray(arr)) return '';
  const v = arr[i];
  return v === null || v === undefined ? '' : String(v);
}

interface CatalogRowProps {
  productKey: string;
  base: Record<string, unknown>;
  override: OverrideRecord | undefined;
  catalog: CatalogDef;
  onSave: (productKey: string, name: string | null, fields: Record<string, unknown>) => Promise<void>;
  onReset: (overrideId: string) => Promise<void>;
}

function CatalogRow({ productKey, base, override, catalog, onSave, onReset }: CatalogRowProps) {
  const effective = override ? { ...base, ...(override.fields || {}), ...(catalog.nameField && override.name ? { [catalog.nameField]: override.name } : {}) } : base;
  const [name, setName] = useState<string>(catalog.nameField ? String(effective[catalog.nameField] ?? '') : '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    catalog.priceFields.forEach((f) => {
      if (f.arrayLabels) {
        f.arrayLabels.forEach((_, i) => {
          init[`${f.key}.${i}`] = fieldArrayValue(f, effective, i);
        });
      } else {
        init[f.key] = fieldValue(f, effective);
      }
    });
    return init;
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      catalog.priceFields.forEach((f) => {
        if (f.arrayLabels) {
          fields[f.key] = f.arrayLabels.map((_, i) => Number(values[`${f.key}.${i}`]) || 0);
        } else {
          fields[f.key] = Number(values[f.key]) || 0;
        }
      });
      await onSave(productKey, catalog.nameField ? name.trim() || null : null, fields);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td className={historyStyles.num}>{productKey}</td>
      {catalog.nameField && (
        <td>
          <input className={calcStyles.formControl} value={name} onChange={(e) => setName(e.target.value)} />
        </td>
      )}
      {catalog.priceFields.map((f) =>
        f.arrayLabels ? (
          <td key={f.key}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {f.arrayLabels.map((label, i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: '#6b7280', width: 78, flexShrink: 0 }}>{label}</span>
                  <input
                    className={calcStyles.formControl}
                    style={{ width: 90 }}
                    type="number"
                    step="any"
                    value={values[`${f.key}.${i}`]}
                    onChange={(e) => setValues((prev) => ({ ...prev, [`${f.key}.${i}`]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </td>
        ) : (
          <td key={f.key}>
            <input
              className={calcStyles.formControl}
              style={{ width: 110 }}
              type="number"
              step="any"
              value={values[f.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </td>
        )
      )}
      <td>
        <span className={`${historyStyles.rolePill} ${override ? historyStyles.rolePillBackoffice : ''}`}>{override ? 'Overridden' : 'Default'}</span>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className={historyStyles.button} disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save'}</button>
          {override && (
            <button type="button" className={historyStyles.deleteBtn} onClick={() => onReset(override.id)}>Reset</button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function ProductCatalogPage() {
  const [activeId, setActiveId] = useState(TAB_CATALOGS[0].id);
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [status, setStatus] = useState('Loading…');
  const [search, setSearch] = useState('');

  async function load() {
    setStatus('Loading…');
    try {
      const response = await fetch('/api/product-overrides');
      if (!response.ok) throw new Error(String(response.status));
      const data: OverrideRecord[] = await response.json();
      setOverrides(data);
      setStatus('');
    } catch {
      setStatus('Could not load overrides. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const overrideByKey = useMemo(() => {
    const map = new Map<string, OverrideRecord>();
    overrides.forEach((o) => map.set(`${o.catalog}::${o.productKey}`, o));
    return map;
  }, [overrides]);

  async function handleSave(catalogId: string, productKey: string, name: string | null, fields: Record<string, unknown>) {
    const response = await fetch('/api/admin/product-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalog: catalogId, productKey, name, fields })
    });
    if (!response.ok) {
      alert('Could not save this change.');
      return;
    }
    await load();
  }

  async function handleReset(overrideId: string) {
    const response = await fetch(`/api/admin/product-overrides/${overrideId}`, { method: 'DELETE' });
    if (!response.ok) {
      alert('Could not reset this product.');
      return;
    }
    await load();
  }

  function renderCatalogTable(catalog: CatalogDef) {
    const base = catalog.getBaseRecords();
    const keys = Object.keys(base).filter((key) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      const record = base[key];
      const name = catalog.nameField ? String(record[catalog.nameField] ?? '') : '';
      return key.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    });

    return (
      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Product Key</th>
              {catalog.nameField && <th>Name</th>}
              {catalog.priceFields.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <CatalogRow
                key={`${catalog.id}-${key}-${overrideByKey.get(`${catalog.id}::${key}`)?.id || 'base'}`}
                productKey={key}
                base={base[key]}
                override={overrideByKey.get(`${catalog.id}::${key}`)}
                catalog={catalog}
                onSave={(productKey, name, fields) => handleSave(catalog.id, productKey, name, fields)}
                onReset={handleReset}
              />
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={4 + catalog.priceFields.length} className={historyStyles.empty}>No products match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  const activeCatalog = findCatalog(activeId)!;

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <Link href="/" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>Product Catalog</h1>
            <div className={historyStyles.sub}>Administration &rsaquo; rename or reprice any AV, Robotics, AI Analytics &amp; VisitIQ product used in quotations.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className={historyStyles.button} href="/admin/products">Product Master</Link>
          <Link className={historyStyles.button} href="/">Back to Dashboard</Link>
        </div>
      </header>
      <main className={historyStyles.main}>
        <div className={historyStyles.status}>{status}</div>
        <div className={historyStyles.status}>
          Changes here apply to every NEW quotation from now on — a quotation already saved keeps whatever price/name it had at the time it was created.
          Reset a product to return it to its original catalog value.
        </div>

        <div className={historyStyles.toolbar}>
          <select className={calcStyles.formControl} style={{ maxWidth: 320 }} value={activeId} onChange={(e) => setActiveId(e.target.value)}>
            {TAB_CATALOGS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <input className={calcStyles.formControl} style={{ maxWidth: 260 }} placeholder="Search by key or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <h2 className={calcStyles.h2}>{activeCatalog.label}</h2>
        {renderCatalogTable(activeCatalog)}

        {activeId === 'conference' && (
          <>
            <h2 className={calcStyles.h2} style={{ marginTop: 24 }}>{CONFERENCE_ACCESSORY.label}</h2>
            {renderCatalogTable(CONFERENCE_ACCESSORY)}
          </>
        )}
      </main>
    </div>
  );
}
