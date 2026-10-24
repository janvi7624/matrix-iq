'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PartnerRecord } from '@/lib/types';
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL, MaterialCategory } from '@/lib/materialCategories';
import PartnerShell from './PartnerShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface PartnerMaterial {
  id: string;
  folderId: string | null;
  product: string;
  category: MaterialCategory;
  title: string;
  description: string;
  webViewLink: string;
  isFolder: boolean;
  updatedAt: string;
}

interface PartnerFolder {
  id: string;
  name: string;
  parentId: string | null;
}

// Belt and braces for the one surface that hands a MatrixIQ-entered URL to
// another company's users. Materials may now point at any web address
// (lib/customLink.ts), and that parser is what actually keeps a hostile scheme
// out of the column — but this app sets no Content-Security-Policy, and React
// blocks only `javascript:`, so the render site refuses anything that is not
// plainly an http(s) address or an in-app path rather than trusting the row.
// An empty href renders a dead card, which is the right failure here.
function safeHref(url: string): string {
  const value = (url || '').trim();
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return /^https?:\/\//i.test(value) ? value : '';
}

export default function PartnerMaterialsView({ partner }: { partner: PartnerRecord }) {
  const [materials, setMaterials] = useState<PartnerMaterial[]>([]);
  const [folders, setFolders] = useState<PartnerFolder[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | MaterialCategory>('all');
  const [folderId, setFolderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/partner/materials');
      if (!response.ok) throw new Error(String(response.status));
      const data: { materials: PartnerMaterial[]; folders: PartnerFolder[] } = await response.json();
      setMaterials(data.materials);
      setFolders(data.folders);
      setStatus(data.materials.length ? '' : 'No materials have been published for partners yet.');
    } catch {
      setStatus('Could not load the library. Refresh to try again.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Opening a document is recorded so our marketing team can see which
  // collateral is useful. Fire-and-forget — the link opens either way.
  function open(material: PartnerMaterial) {
    void fetch(`/api/partner/materials/${material.id}/open`, { method: 'POST' }).catch(() => undefined);
  }

  const childFolders = useMemo(() => folders.filter((f) => f.parentId === folderId), [folders, folderId]);

  const breadcrumb = useMemo(() => {
    const trail: PartnerFolder[] = [];
    const byId = new Map(folders.map((f) => [f.id, f]));
    let current = folderId;
    const guard = new Set<string>();
    while (current && !guard.has(current)) {
      guard.add(current);
      const folder = byId.get(current);
      if (!folder) break;
      trail.unshift(folder);
      current = folder.parentId;
    }
    return trail;
  }, [folders, folderId]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return materials.filter((m) => {
      // While searching, look across the whole published library rather than
      // only the open folder — someone searching "X200" wants the datasheet
      // wherever it was filed.
      if (!needle && m.folderId !== folderId) return false;
      if (category !== 'all' && m.category !== category) return false;
      if (!needle) return true;
      return (
        m.product.toLowerCase().includes(needle) ||
        m.title.toLowerCase().includes(needle) ||
        m.description.toLowerCase().includes(needle)
      );
    });
  }, [materials, search, category, folderId]);

  return (
    <PartnerShell
      title="Marketing Materials"
      subtitle="Brochures, datasheets, case studies and presentations published for partners"
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      <div className={historyStyles.toolbar}>
        <input type="text" placeholder="Search the library..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value as 'all' | MaterialCategory)}>
          <option value="all">All types</option>
          {MATERIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>{MATERIAL_CATEGORY_LABEL[c]}</option>
          ))}
        </select>
      </div>

      {!search.trim() && (
        <div className={styles.cardGrid} style={{ gridTemplateColumns: 'auto', gap: 4, marginBottom: 12 }}>
          <div className={calcStyles.small}>
            <button type="button" className={historyStyles.button} onClick={() => setFolderId(null)}>Library</button>
            {breadcrumb.map((f) => (
              <span key={f.id}>
                {' › '}
                <button type="button" className={historyStyles.button} onClick={() => setFolderId(f.id)}>{f.name}</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {status && <div className={historyStyles.status}>{status}</div>}

      {!search.trim() && childFolders.length > 0 && (
        <>
          <h3 className={styles.sectionHeading}>Folders</h3>
          <div className={styles.cardGrid}>
            {childFolders.map((f) => (
              <button key={f.id} type="button" className={styles.card} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setFolderId(f.id)}>
                <p className={styles.cardTitle}>{f.name}</p>
                <p className={styles.cardDesc}>Open folder</p>
              </button>
            ))}
          </div>
        </>
      )}

      {visible.length > 0 && (
        <>
          <h3 className={styles.sectionHeading}>{search.trim() ? 'Search results' : 'Documents'}</h3>
          <div className={styles.cardGrid}>
            {visible.map((m) => (
              <a
                key={m.id}
                className={styles.card}
                href={safeHref(m.webViewLink)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => open(m)}
              >
                <p className={styles.cardTitle}>{m.title || m.product}</p>
                <p className={styles.cardDesc}>
                  {m.product}
                  {m.description ? ` — ${m.description}` : ''}
                </p>
                <p className={styles.cardDesc} style={{ marginTop: 6 }}>
                  {MATERIAL_CATEGORY_LABEL[m.category]}
                  {m.updatedAt ? ` · updated ${new Date(m.updatedAt).toLocaleDateString()}` : ''}
                </p>
              </a>
            ))}
          </div>
        </>
      )}

      {!status && visible.length === 0 && (
        <p className={styles.pending}>
          {search.trim() ? 'Nothing matches that search.' : 'This folder has no documents published for partners.'}
        </p>
      )}
    </PartnerShell>
  );
}
