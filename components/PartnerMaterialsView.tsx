'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, FileText, FolderOpen } from 'lucide-react';
import { PartnerRecord } from '@/lib/types';
import {
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_HINT,
  MATERIAL_CATEGORY_LABEL,
  MaterialCategory,
  MaterialFileKind
} from '@/lib/materialCategories';
import { groupByCategory } from '@/lib/materialGrouping';
import { CATEGORY_ICON, KIND_ICON, formatWhen } from './materialIcons';
import PartnerShell from './PartnerShell';
import historyStyles from './quotationHistory.module.css';
import styles from './materials.module.css';

// Mirrors the internal library (components/MaterialsView.tsx) field for
// field: the same category -> product -> documents grouping from
// lib/materialGrouping.ts, the same icons, the same CSS module. A partner
// opening a datasheet sees what our own team sees.
//
// The two differences are both deliberate:
//   - no management tools (edit / delete / add), because publication is
//     Marketing's decision, not the partner's;
//   - no "added by", because who uploaded a document is internal staff
//     identity. The partner projection sets it to '' server-side
//     (lib/partnerMaterialStore.ts) so it cannot leak through this screen.

interface PartnerMaterial {
  id: string;
  folderId: string | null;
  product: string;
  category: MaterialCategory;
  title: string;
  description: string;
  webViewLink: string;
  isFolder: boolean;
  fileKind: MaterialFileKind;
  updatedAt: string;
  addedBy: string;
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Async IIFE with a cancelled guard, matching components/MaterialsView.tsx.
  // Calling a synchronous loader straight out of the effect body sets state
  // during the effect and triggers a cascading render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/partner/materials');
        if (!response.ok) throw new Error(String(response.status));
        const data: { materials: PartnerMaterial[]; folders: PartnerFolder[] } = await response.json();
        if (cancelled) return;
        setMaterials(data.materials);
        setFolders(data.folders);
        setStatus(data.materials.length ? '' : 'No materials have been published for partners yet.');
      } catch {
        if (!cancelled) setStatus('Could not load the library. Refresh to try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Opening a document is recorded so our marketing team can see which
  // collateral is useful. Fire-and-forget — the link opens either way.
  function open(material: { id: string }) {
    void fetch(`/api/partner/materials/${material.id}/open`, { method: 'POST' }).catch(() => undefined);
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  // Same grouping the internal library uses, in MATERIAL_CATEGORIES order.
  const groups = useMemo(
    () => groupByCategory(visible, category === 'all' ? MATERIAL_CATEGORIES : [category]),
    [visible, category]
  );

  const countByCategory = useMemo(() => {
    const counts: Partial<Record<MaterialCategory, number>> = {};
    for (const m of materials) counts[m.category] = (counts[m.category] ?? 0) + 1;
    return counts;
  }, [materials]);

  const searching = Boolean(search.trim());

  return (
    <PartnerShell
      title="Marketing Materials"
      subtitle="Brochures, datasheets, case studies and presentations published for partners"
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search the library..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searching && (
            <button type="button" className={styles.searchClear} onClick={() => setSearch('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
      </div>

      <div className={styles.tabRow} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={category === 'all'}
          className={category === 'all' ? styles.tabActive : styles.tab}
          onClick={() => setCategory('all')}
        >
          All
          <span className={styles.tabCount}>{materials.length}</span>
        </button>
        {MATERIAL_CATEGORIES.map((c) => {
          const Icon = CATEGORY_ICON[c];
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={category === c}
              className={category === c ? styles.tabActive : styles.tab}
              onClick={() => setCategory(c)}
            >
              <Icon size={14} /> {MATERIAL_CATEGORY_LABEL[c]}
              <span className={styles.tabCount}>{countByCategory[c] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {!searching && (
        <nav className={styles.breadcrumb}>
          <button type="button" className={styles.crumbLink} onClick={() => setFolderId(null)}>Library</button>
          {breadcrumb.map((f, i) => (
            <span key={f.id} className={styles.crumbPart}>
              <span className={styles.crumbSep}>›</span>
              {i === breadcrumb.length - 1 ? (
                <span className={styles.crumbCurrent}>{f.name}</span>
              ) : (
                <button type="button" className={styles.crumbLink} onClick={() => setFolderId(f.id)}>{f.name}</button>
              )}
            </span>
          ))}
        </nav>
      )}

      {searching && (
        <div className={styles.resultLine}>
          {visible.length} {visible.length === 1 ? 'result' : 'results'} for “{search.trim()}”
        </div>
      )}

      {status && <div className={historyStyles.status}>{status}</div>}

      {!searching && childFolders.length > 0 && (
        <div className={styles.grid}>
          {childFolders.map((f) => (
            <button key={f.id} type="button" className={styles.folderCard} onClick={() => setFolderId(f.id)}>
              <span className={`${styles.kindTile} ${styles.kindTileFolder}`} aria-hidden>
                <FolderOpen size={18} />
              </span>
              <h3 className={styles.cardTitle}>{f.name}</h3>
              <p className={styles.cardDesc}>Open folder</p>
            </button>
          ))}
        </div>
      )}

      {groups.map((group) => {
        const CategoryIcon = CATEGORY_ICON[group.category];
        return (
          <section key={group.category} className={styles.categoryBlock}>
            <header className={styles.categoryHeader}>
              <CategoryIcon size={15} className={styles.categoryIcon} aria-hidden />
              <h2 className={styles.categoryTitle}>{MATERIAL_CATEGORY_LABEL[group.category]}</h2>
              <span className={styles.categoryCount}>
                {group.products.length} {group.products.length === 1 ? 'product' : 'products'}
              </span>
              {category !== 'all' && <span className={styles.categoryHint}>{MATERIAL_CATEGORY_HINT[group.category]}</span>}
            </header>

            <div className={styles.grid}>
              {group.products.map((product) => {
                const key = `${group.category}|${product.product}`;
                const isOpen = expanded.has(key);
                const multiple = product.documents.length > 1;
                const Icon = KIND_ICON[product.fileKind] ?? FileText;

                return (
                  <article key={key} className={styles.card}>
                    <div className={styles.cardTop}>
                      <span className={`${styles.kindTile} ${product.isFolder ? styles.kindTileFolder : ''}`} aria-hidden>
                        <Icon size={18} />
                      </span>
                    </div>

                    <h3 className={styles.cardTitle}>{product.product}</h3>
                    {product.description && <p className={styles.cardDesc}>{product.description}</p>}

                    <div className={styles.cardMeta}>
                      {multiple && <span className={styles.docPill}>{product.documents.length} documents</span>}
                      {product.updatedAt && <span>Updated {formatWhen(product.updatedAt)}</span>}
                    </div>

                    <div className={styles.cardActions}>
                      <a
                        className={styles.openBtn}
                        href={safeHref(product.primaryLink)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => open(product.documents[0])}
                      >
                        <ExternalLink size={14} /> {product.isFolder ? 'Open folder' : 'Open'}
                      </a>
                      {multiple && (
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          onClick={() => toggleExpanded(key)}
                          aria-expanded={isOpen}
                        >
                          <ChevronDown size={14} className={isOpen ? styles.chevronOpen : undefined} />
                          {isOpen ? 'Hide' : 'All files'}
                        </button>
                      )}
                    </div>

                    {multiple && isOpen && (
                      <ul className={styles.docList}>
                        {product.documents.map((document) => {
                          const DocIcon = KIND_ICON[document.fileKind] ?? FileText;
                          return (
                            <li key={document.id} className={styles.docRow}>
                              <DocIcon size={14} />
                              <a
                                className={styles.docLink}
                                href={safeHref(document.webViewLink)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => open(document)}
                              >
                                {document.title || document.product}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {!status && visible.length === 0 && (
        <p className={styles.resultLine}>
          {searching ? 'Nothing matches that search.' : 'This folder has no documents published for partners.'}
        </p>
      )}
    </PartnerShell>
  );
}
