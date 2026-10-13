'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Building2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Home,
  ExternalLink,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  type LucideIcon,
  Pencil,
  Plus,
  Presentation,
  Search,
  Trash2,
  Video,
  X
} from 'lucide-react';
import AppShell from './AppShell';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Skeleton } from './ui/Skeleton';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { isDriveLink } from '@/lib/driveLink';
import {
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_HINT,
  MATERIAL_CATEGORY_LABEL,
  MaterialCategory,
  MaterialFileKind
} from '@/lib/materialCategories';
import calcStyles from './calculator.module.css';
import styles from './materials.module.css';

interface MaterialDocument {
  id: string;
  product: string;
  category: MaterialCategory;
  title: string;
  description: string;
  webViewLink: string;
  isFolder: boolean;
  fileKind: MaterialFileKind;
  addedBy: string;
  updatedAt: string;
}

interface ProductGroup {
  product: string;
  primaryLink: string;
  isFolder: boolean;
  documents: MaterialDocument[];
  description: string;
  updatedAt: string;
  fileKind: MaterialFileKind;
}

interface CategoryGroup {
  category: MaterialCategory;
  products: ProductGroup[];
  documentCount: number;
}

interface Subfolder {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
  subfolderCount: number;
  materialCount: number;
}

interface Crumb {
  id: string;
  name: string;
  parentId: string | null;
}

interface MaterialsPayload {
  categories: CategoryGroup[];
  subfolders: Subfolder[];
  breadcrumb: Crumb[];
  folderId: string | null;
  flatMode: boolean;
  matchCount: number;
  totalProducts: number;
  totalDocuments: number;
  countByCategory: Record<string, number>;
  canManage: boolean;
  knownProducts: string[];
}

const KIND_ICON: Record<MaterialFileKind, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slide: Presentation,
  image: ImageIcon,
  video: Video,
  archive: FileArchive,
  folder: FolderOpen,
  file: FileText
};

// A category reads faster with a mark beside it than as text alone — and the
// same icon then identifies it in the tab, the heading and the add form.
const CATEGORY_ICON: Record<MaterialCategory, LucideIcon> = {
  datasheet: FileText,
  case_study: Award,
  company_profile: Building2,
  brochure: FileArchive,
  presentation: Presentation,
  certificate: Award,
  video: Video,
  other: Layers
};

function formatWhen(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const EMPTY_FORM = { product: '', category: 'datasheet' as MaterialCategory, title: '', description: '', driveLink: '' };
type FormValues = typeof EMPTY_FORM;

export default function MaterialsView({ canManage: canManageInitial }: { canManage: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [category, setCategory] = useState<MaterialCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  // Which folder is open. null = the library's top level.
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ mode: 'new' } | { mode: 'edit'; folder: Subfolder } | null>(null);
  const [data, setData] = useState<MaterialsPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<MaterialDocument | 'new' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Derived rather than its own state, so the fetch effect sets nothing
  // synchronously in its body (react-hooks/set-state-in-effect).
  const [loadedKey, setLoadedKey] = useState('');

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 220);
    return () => clearTimeout(timer);
  }, [search]);

  const requestKey = `${folderId ?? 'root'}|${category}|${debouncedSearch}|${reloadKey}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (folderId) params.set('folderId', folderId);
        if (category !== 'all') params.set('category', category);
        if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
        const response = await fetch(`/api/materials?${params.toString()}`);
        if (!response.ok) throw new Error(String(response.status));
        const json = (await response.json()) as MaterialsPayload;
        if (cancelled) return;
        setLoadFailed(false);
        setData(json);
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoadedKey(`${folderId ?? 'root'}|${category}|${debouncedSearch}|${reloadKey}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, category, debouncedSearch, reloadKey]);

  // "/" focuses search the way every search-first tool does, since finding a
  // document is the only thing most people come here to do.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typingAlready = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (event.key === '/' && !typingAlready) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const load = () => setReloadKey((k) => k + 1);
  const canManage = data?.canManage ?? canManageInitial;

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave(target: MaterialDocument | 'new', values: FormValues) {
    const isNew = target === 'new';
    try {
      const response = await fetch(isNew ? '/api/materials' : `/api/materials/${target.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? { ...values, folderId } : values)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body.error || 'Could not save this material.');
        return;
      }
      toast.success(isNew ? `${values.product} added to ${MATERIAL_CATEGORY_LABEL[values.category]}.` : 'Material updated.');
      setEditing(null);
      load();
    } catch {
      toast.error('Could not reach the server.');
    }
  }

  async function handleDelete(document: MaterialDocument) {
    const confirmed = await confirm({
      message: `Remove "${document.title}" from the library? The file stays in Drive — only this entry is removed.`,
      danger: true
    });
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/materials/${document.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body.error || 'Could not remove this material.');
        return;
      }
      toast.success('Material removed.');
      load();
    } catch {
      toast.error('Could not reach the server.');
    }
  }

  async function handleSaveFolder(mode: 'new' | 'edit', folder: Subfolder | null, values: { name: string; description: string }) {
    const isNew = mode === 'new';
    try {
      const response = await fetch(isNew ? '/api/material-folders' : `/api/material-folders/${folder!.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // A new folder is created inside the one currently open, which is
        // what "New folder" means wherever you're standing.
        body: JSON.stringify(isNew ? { ...values, parentId: folderId } : values)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body.error || 'Could not save this folder.');
        return;
      }
      toast.success(isNew ? `Folder “${values.name}” created.` : 'Folder updated.');
      setFolderDialog(null);
      load();
    } catch {
      toast.error('Could not reach the server.');
    }
  }

  async function handleDeleteFolder(folder: Subfolder) {
    const confirmed = await confirm({ message: `Delete the folder “${folder.name}”?`, danger: true });
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/material-folders/${folder.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        // The server refuses a folder that still holds anything and says
        // what's in the way — shown as-is, it's the actionable part.
        toast.error(body.error || 'Could not delete this folder.');
        return;
      }
      toast.success('Folder deleted.');
      load();
    } catch {
      toast.error('Could not reach the server.');
    }
  }

  // Tabs for categories that hold something, plus whichever is selected — an
  // empty "Certificate" tab is noise until there are certificates, but the
  // selected tab must never vanish mid-browse.
  const tabs = useMemo(() => {
    const counts = data?.countByCategory ?? {};
    return MATERIAL_CATEGORIES.filter((c) => (counts[c] ?? 0) > 0 || category === c);
  }, [data?.countByCategory, category]);

  const groups = data?.categories ?? [];
  const subfolders = data?.subfolders ?? [];
  const breadcrumb = data?.breadcrumb ?? [];
  const searching = debouncedSearch.trim().length > 0;
  const flatMode = Boolean(data?.flatMode);
  const isEmptyLibrary = !loading && !loadFailed && (data?.totalProducts ?? 0) === 0 && !subfolders.length;
  // Nothing in THIS folder — distinct from an empty library, and it needs a
  // different thing said about it.
  const folderIsEmpty = !loading && !loadFailed && !flatMode && !groups.length && !subfolders.length;

  return (
    <AppShell
      title="Materials"
      subtitle="Datasheets, case studies and company documents — find what you need and open it in Drive."
    >
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className={styles.searchInput}
            placeholder="Search by product, document or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search materials"
          />
          {search ? (
            <button type="button" className={styles.searchClear} onClick={() => setSearch('')} aria-label="Clear search">
              <X size={14} />
            </button>
          ) : (
            <kbd className={styles.searchKbd}>/</kbd>
          )}
        </div>
        {canManage && (
          <>
            <button type="button" className={styles.ghostBtn} onClick={() => setFolderDialog({ mode: 'new' })}>
              <FolderPlus size={15} /> New folder
            </button>
            <button type="button" className={styles.primaryBtn} onClick={() => setEditing('new')}>
              <Plus size={16} /> Add material
            </button>
          </>
        )}
      </div>

      {/* Breadcrumb — shown only once you're inside something, since at the
          top level it would be a trail of one. Hidden while searching, where
          results come from every folder and a single path would be a lie. */}
      {!flatMode && breadcrumb.length > 0 && (
        <nav className={styles.breadcrumb} aria-label="Folder path">
          <button type="button" className={styles.crumbLink} onClick={() => setFolderId(null)}>
            <Home size={13} /> Library
          </button>
          {breadcrumb.map((crumb, index) => {
            const isLast = index === breadcrumb.length - 1;
            return (
              <span key={crumb.id} className={styles.crumbPart}>
                <ChevronRight size={13} className={styles.crumbSep} aria-hidden />
                {isLast ? (
                  <span className={styles.crumbCurrent} aria-current="page">{crumb.name}</span>
                ) : (
                  <button type="button" className={styles.crumbLink} onClick={() => setFolderId(crumb.id)}>
                    {crumb.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {!isEmptyLibrary && (
        <div className={styles.tabRow} role="tablist" aria-label="Material categories">
          <button
            type="button"
            role="tab"
            aria-selected={category === 'all'}
            className={category === 'all' ? styles.tabActive : styles.tab}
            onClick={() => setCategory('all')}
          >
            <Layers size={14} /> All
            <span className={styles.tabCount}>{data?.totalProducts ?? 0}</span>
          </button>
          {tabs.map((c) => {
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
                <span className={styles.tabCount}>{data?.countByCategory?.[c] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      {searching && !loading && !loadFailed && (
        <div className={styles.resultLine}>
          {data?.matchCount ?? 0} {data?.matchCount === 1 ? 'result' : 'results'} for “{debouncedSearch.trim()}”
        </div>
      )}

      {loading ? (
        <div className={styles.grid}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={styles.skeletonCard}>
              <Skeleton width={38} height={38} />
              <Skeleton width={`${50 + ((i * 13) % 35)}%`} height={14} />
              <Skeleton width="75%" height={11} />
              <Skeleton width="100%" height={32} />
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <ErrorState message="Could not load the material library — check your connection and try again." onRetry={load} />
      ) : isEmptyLibrary ? (
        <EmptyState
          icon={FolderOpen}
          title="The library is empty"
          message={
            canManage
              ? 'Add your first material — a product name, a category, and the Drive link. Everyone in MatrixIQ will be able to find it.'
              : 'Marketing hasn’t published any materials yet. They’ll appear here as soon as they do.'
          }
          action={
            canManage ? (
              <button type="button" className={styles.primaryBtn} onClick={() => setEditing('new')}>
                <Plus size={16} /> Add the first material
              </button>
            ) : undefined
          }
        />
      ) : folderIsEmpty ? (
        <EmptyState
          icon={FolderOpen}
          title="This folder is empty"
          message={
            canManage
              ? 'Add a material here, or create a subfolder to organise it further.'
              : 'Nothing has been filed in this folder yet.'
          }
          action={
            canManage ? (
              <button type="button" className={styles.primaryBtn} onClick={() => setEditing('new')}>
                <Plus size={16} /> Add material
              </button>
            ) : undefined
          }
        />
      ) : !groups.length && !subfolders.length ? (
        <EmptyState
          icon={Search}
          title="Nothing matches that search"
          message="Try a product code, or a word from the document name."
          action={
            <button type="button" className={styles.ghostBtn} onClick={() => { setSearch(''); setCategory('all'); }}>
              Clear filters
            </button>
          }
        />
      ) : (
        <>
        {/* Folders come before materials: they're the structure, and burying
            them under a long product list would hide the navigation. */}
        {subfolders.length > 0 && (
          <section className={styles.categoryBlock}>
            <header className={styles.categoryHeader}>
              <Folder size={15} className={styles.categoryIcon} aria-hidden />
              <h2 className={styles.categoryTitle}>Folders</h2>
              <span className={styles.categoryCount}>
                {subfolders.length} {subfolders.length === 1 ? 'folder' : 'folders'}
              </span>
            </header>
            <div className={styles.grid}>
              {subfolders.map((folder) => {
                const counts = [
                  folder.subfolderCount ? `${folder.subfolderCount} folder${folder.subfolderCount === 1 ? '' : 's'}` : '',
                  folder.materialCount ? `${folder.materialCount} material${folder.materialCount === 1 ? '' : 's'}` : ''
                ].filter(Boolean);
                return (
                  <article key={folder.id} className={`${styles.card} ${styles.folderCard}`}>
                    <div className={styles.cardTop}>
                      <span className={`${styles.kindTile} ${styles.kindTileFolder}`} aria-hidden>
                        <Folder size={18} />
                      </span>
                      {canManage && (
                        <div className={styles.cardTools}>
                          <button type="button" className={styles.iconBtn} onClick={() => setFolderDialog({ mode: 'edit', folder })} aria-label={`Rename ${folder.name}`}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" className={styles.iconBtn} onClick={() => handleDeleteFolder(folder)} aria-label={`Delete ${folder.name}`}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    {/* The whole card opens the folder — a folder's one job
                        is to be entered, so the click target is the card, not
                        a small link inside it. */}
                    <button type="button" className={styles.folderOpen} onClick={() => setFolderId(folder.id)}>
                      <span className={styles.cardTitle}>{folder.name}</span>
                    </button>
                    {folder.description && <p className={styles.cardDesc}>{folder.description}</p>}
                    <div className={styles.cardMeta}>{counts.length ? counts.join(' · ') : 'Empty'}</div>
                  </article>
                );
              })}
            </div>
          </section>
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
                {/* The hint only earns its space when the whole page is one
                    category — in "All" it would repeat eight times. */}
                {category !== 'all' && <span className={styles.categoryHint}>{MATERIAL_CATEGORY_HINT[group.category]}</span>}
              </header>

              <div className={styles.grid}>
                {group.products.map((product) => {
                  const key = `${group.category}|${product.product}`;
                  const isOpen = expanded.has(key);
                  const multiple = product.documents.length > 1;
                  const Icon = KIND_ICON[product.fileKind] ?? FileText;
                  const single = product.documents[0];

                  return (
                    <article key={key} className={styles.card}>
                      <div className={styles.cardTop}>
                        <span className={`${styles.kindTile} ${product.isFolder ? styles.kindTileFolder : ''}`} aria-hidden>
                          <Icon size={18} />
                        </span>
                        {canManage && !multiple && single && (
                          <div className={styles.cardTools}>
                            <button type="button" className={styles.iconBtn} onClick={() => setEditing(single)} aria-label={`Edit ${product.product}`}>
                              <Pencil size={14} />
                            </button>
                            <button type="button" className={styles.iconBtn} onClick={() => handleDelete(single)} aria-label={`Remove ${product.product}`}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>

                      <h3 className={styles.cardTitle}>{product.product}</h3>
                      {product.description && <p className={styles.cardDesc}>{product.description}</p>}

                      <div className={styles.cardMeta}>
                        {multiple && <span className={styles.docPill}>{product.documents.length} documents</span>}
                        {product.updatedAt && <span>Updated {formatWhen(product.updatedAt)}</span>}
                      </div>

                      <div className={styles.cardActions}>
                        <a className={styles.openBtn} href={product.primaryLink} target="_blank" rel="noopener noreferrer">
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
                                <DocIcon size={13} aria-hidden />
                                <a className={styles.docLink} href={document.webViewLink} target="_blank" rel="noopener noreferrer">
                                  {document.title}
                                </a>
                                {canManage && (
                                  <>
                                    <button type="button" className={styles.iconBtn} onClick={() => setEditing(document)} aria-label={`Edit ${document.title}`}>
                                      <Pencil size={12} />
                                    </button>
                                    <button type="button" className={styles.iconBtn} onClick={() => handleDelete(document)} aria-label={`Remove ${document.title}`}>
                                      <Trash2 size={12} />
                                    </button>
                                  </>
                                )}
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
        </>
      )}

      {folderDialog && (
        <FolderDialog
          folder={folderDialog.mode === 'edit' ? folderDialog.folder : null}
          parentName={breadcrumb.length ? breadcrumb[breadcrumb.length - 1].name : 'Library'}
          onClose={() => setFolderDialog(null)}
          onSave={(values) => handleSaveFolder(folderDialog.mode, folderDialog.mode === 'edit' ? folderDialog.folder : null, values)}
        />
      )}

      {editing && (
        <MaterialDialog
          material={editing}
          defaultCategory={category === 'all' ? 'datasheet' : category}
          knownProducts={data?.knownProducts ?? []}
          onClose={() => setEditing(null)}
          onSave={(values) => handleSave(editing, values)}
        />
      )}
    </AppShell>
  );
}

// Add a material, or edit one. The same form does both — they differ only in
// whether there was a row to start from.
function MaterialDialog({
  material,
  defaultCategory,
  knownProducts,
  onClose,
  onSave
}: {
  material: MaterialDocument | 'new';
  defaultCategory: MaterialCategory;
  knownProducts: string[];
  onClose: () => void;
  onSave: (values: FormValues) => void;
}) {
  const isNew = material === 'new';
  const existing = isNew ? null : material;

  const [values, setValues] = useState<FormValues>(
    existing
      ? {
          product: existing.product,
          category: existing.category,
          title: existing.title,
          description: existing.description,
          driveLink: existing.webViewLink
        }
      : { ...EMPTY_FORM, category: defaultCategory }
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Validated as you type with the SAME parser the API validates with, so
  // the form can never accept a link the server will reject.
  const linkTouched = values.driveLink.trim().length > 0;
  const linkValid = isDriveLink(values.driveLink);
  const linkIsFolder = linkValid && /\/folders\//.test(values.driveLink);

  function handleSubmit() {
    if (!values.product.trim()) {
      setError('Enter the product or document name');
      return;
    }
    if (!linkValid) {
      setError('Paste a Google Drive link — from Drive’s Share dialog or the address bar');
      return;
    }
    setError('');
    setSaving(true);
    onSave({
      ...values,
      product: values.product.trim(),
      title: values.title.trim() || values.product.trim(),
      description: values.description.trim(),
      driveLink: values.driveLink.trim()
    });
  }

  return (
    <Modal
      title={isNew ? 'Add material' : `Edit ${existing!.title}`}
      ariaLabel={isNew ? 'Add a material' : `Edit ${existing!.title}`}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <ModalCancelButton onClick={onClose}>Cancel</ModalCancelButton>
          <ModalOkButton onClick={handleSubmit} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Add material' : 'Save'}</ModalOkButton>
        </>
      }
    >
      {error && <div className={styles.formError}>{error}</div>}

      <div className={calcStyles.field}>
        <label htmlFor="materialProduct">Product / Document name *</label>
        <input
          id="materialProduct"
          type="text"
          className={calcStyles.formControl}
          value={values.product}
          onChange={(e) => set('product', e.target.value)}
          placeholder="e.g. Allbotix X200"
          // Suggests names already in the library, so a second datasheet for
          // the same product is filed under the identical name rather than
          // splitting it into two entries.
          list="materialProductNames"
          autoFocus
        />
        <datalist id="materialProductNames">
          {knownProducts.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className={calcStyles.small}>Everything filed under the same name appears as one entry.</div>
      </div>

      <div className={calcStyles.field}>
        <label htmlFor="materialCategory">Category *</label>
        <select
          id="materialCategory"
          className={calcStyles.formControl}
          value={values.category}
          onChange={(e) => set('category', e.target.value as MaterialCategory)}
        >
          {MATERIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>{MATERIAL_CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <div className={calcStyles.small}>{MATERIAL_CATEGORY_HINT[values.category]}</div>
      </div>

      <div className={calcStyles.field}>
        <label htmlFor="materialLink">Google Drive link *</label>
        <input
          id="materialLink"
          type="url"
          className={calcStyles.formControl}
          value={values.driveLink}
          onChange={(e) => set('driveLink', e.target.value)}
          placeholder="https://drive.google.com/file/d/… or /drive/folders/…"
        />
        <div className={linkTouched && !linkValid ? styles.fieldWarn : calcStyles.small}>
          {linkTouched && !linkValid
            ? 'That doesn’t look like a Google Drive link.'
            : linkIsFolder
              ? 'Folder link — “Open folder” will show every document for this product.'
              : 'A file link opens that one document. Use a folder link when a product has several.'}
        </div>
      </div>

      <div className={calcStyles.field}>
        <label htmlFor="materialTitle">Document name</label>
        <input
          id="materialTitle"
          type="text"
          className={calcStyles.formControl}
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder={values.product.trim() || 'Same as the product name'}
        />
        <div className={calcStyles.small}>Only needed when a product has more than one — “X200 Datasheet (Hindi)”.</div>
      </div>

      <div className={calcStyles.field}>
        <label htmlFor="materialDescription">Description</label>
        <textarea
          id="materialDescription"
          className={calcStyles.formControl}
          rows={3}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="What is this for, and who should it go to?"
        />
      </div>

      <div className={styles.formNote}>
        MatrixIQ stores the <strong>link</strong>, not the file. Anyone opening it needs access in Drive — if it’s set
        to “Restricted”, share it with the team first.
      </div>
    </Modal>
  );
}

// Create or rename a folder. Deliberately small — a folder is a name and a
// line of explanation; where it sits is decided by where you were standing
// when you created it, not by a picker nobody would read.
function FolderDialog({
  folder,
  parentName,
  onClose,
  onSave
}: {
  folder: Subfolder | null;
  parentName: string;
  onClose: () => void;
  onSave: (values: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [description, setDescription] = useState(folder?.description ?? '');
  const [error, setError] = useState('');

  function handleSubmit() {
    if (!name.trim()) {
      setError('Give the folder a name');
      return;
    }
    setError('');
    onSave({ name: name.trim(), description: description.trim() });
  }

  return (
    <Modal
      title={folder ? `Rename “${folder.name}”` : `New folder in ${parentName}`}
      ariaLabel={folder ? `Rename folder ${folder.name}` : 'Create a folder'}
      onClose={onClose}
      footer={
        <>
          <ModalCancelButton onClick={onClose}>Cancel</ModalCancelButton>
          <ModalOkButton onClick={handleSubmit}>{folder ? 'Save' : 'Create folder'}</ModalOkButton>
        </>
      }
    >
      {error && <div className={styles.formError}>{error}</div>}

      <div className={calcStyles.field}>
        <label htmlFor="folderName">Folder name *</label>
        <input
          id="folderName"
          type="text"
          className={calcStyles.formControl}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Robots"
          autoFocus
        />
      </div>

      <div className={calcStyles.field}>
        <label htmlFor="folderDescription">Description</label>
        <textarea
          id="folderDescription"
          className={calcStyles.formControl}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What belongs in here?"
        />
      </div>
    </Modal>
  );
}
