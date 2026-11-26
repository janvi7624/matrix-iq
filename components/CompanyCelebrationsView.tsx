'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  Cake,
  CalendarHeart,
  CirclePlay,
  FileText,
  FolderPlus,
  Megaphone,
  Pencil,
  Plus,
  Presentation,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  type LucideIcon
} from 'lucide-react';
import AppShell from './AppShell';
import CommonButton from './ui/CommonButton';
import CommonHeader from './ui/CommonHeader';
import { useConfirm } from './ui/ConfirmDialog';
import { usePrompt } from './ui/PromptDialog';
import historyStyles from './quotationHistory.module.css';
import { SkeletonCards } from './ui/Skeleton';
import calcStyles from './calculator.module.css';
import RowActions from './ui/RowActions';

// A fixed key from the built-in seven, or a custom one HR added on top
// (lib/companyCelebrationStore.ts's company_celebration_categories table) —
// plain string, since folders are no longer limited to the built-in set.
type CelebrationCategory = string;

interface CategoryInfo {
  key: string;
  label: string;
  isCustom: boolean;
  /** A single emoji HR picked for a custom folder — empty for the built-in seven. */
  icon?: string;
}

// A short, varied set to pick from when adding a folder — not exhaustive,
// just enough that HR isn't stuck typing/pasting an emoji by hand. The free
// text field next to it still accepts anything.
const FOLDER_EMOJI_CHOICES = ['🎉', '🏆', '⚽', '🎯', '🎗️', '🌟', '🤝', '🎓', '🧧', '🎄', '🏝️', '📢'];

const CATEGORY_LABEL: Record<string, string> = {
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  event_expo: 'Event / Expo',
  festival: 'Festival',
  engagement_activities: 'Engagement Activities',
  company_announcements: 'Company Announcements',
  employee_appreciation: 'Employee Appreciation'
};

// One icon + tint per BUILT-IN category so those tiles are recognisable at a
// glance; a custom folder HR added gets a generic folder icon instead
// (CategoryIcon's fallback below) since there is no sensible per-folder
// icon to assign automatically.
const CATEGORY_ICON: Record<string, { Icon: LucideIcon; color: string; bg: string }> = {
  birthday: { Icon: Cake, color: '#db2777', bg: '#fce7f3' },
  anniversary: { Icon: CalendarHeart, color: '#e11d48', bg: '#ffe4e6' },
  event_expo: { Icon: Presentation, color: '#2563eb', bg: '#dbeafe' },
  festival: { Icon: Sparkles, color: '#d97706', bg: '#fef3c7' },
  engagement_activities: { Icon: Users, color: '#059669', bg: '#d1fae5' },
  company_announcements: { Icon: Megaphone, color: '#7c3aed', bg: '#ede9fe' },
  employee_appreciation: { Icon: Award, color: '#b45309', bg: '#ffedd5' }
};
const CUSTOM_CATEGORY_ICON = { Icon: FolderPlus, color: '#0f766e', bg: '#ccfbf1' };

function categoryIconFor(category: string) {
  return CATEGORY_ICON[category] ?? CUSTOM_CATEGORY_ICON;
}

function categoryLabelFor(category: string, categories: CategoryInfo[]): string {
  return categories.find((c) => c.key === category)?.label || CATEGORY_LABEL[category] || category;
}

function CategoryIcon({ category, categories, size = 20 }: { category: CelebrationCategory; categories: CategoryInfo[]; size?: number }) {
  const emoji = categories.find((c) => c.key === category)?.icon;
  if (emoji) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size + 16,
          height: size + 16,
          borderRadius: 10,
          background: 'var(--mx-surface-2, #f3f3f3)',
          fontSize: size,
          lineHeight: 1,
          flexShrink: 0
        }}
      >
        {emoji}
      </span>
    );
  }
  const { Icon, color, bg } = categoryIconFor(category);
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 16,
        height: size + 16,
        borderRadius: 10,
        background: bg,
        color,
        flexShrink: 0
      }}
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

interface SubfolderSummary {
  name: string;
  itemCount: number;
  coverUrl: string;
  coverKind: 'image' | 'video' | 'file';
  updatedAt: string;
}

interface CelebrationItem {
  id: string;
  category: CelebrationCategory;
  subfolder: string;
  title: string;
  description: string;
  fileUrl: string;
  mimeType: string;
  kind: 'image' | 'video' | 'file';
  addedBy: string;
  createdAt: string;
  // Server-computed (app/api/hr/celebrations's GET): true for HR on any
  // item, true for any other manager only on an item they personally added.
  canEdit: boolean;
}

// Three levels: pick a category (fixed, HR never adds one) → pick/create a
// named album inside it (an employee's name, an event's title — whatever the
// category calls for) → see the photos/videos in that album. Every
// signed-in employee can browse all three levels. Writing splits in two:
// `canManage` (HR Manager only) controls the wall's STRUCTURE — folders,
// renaming/deleting a whole album; `canContribute` (any department manager)
// controls adding a photo/video and creating a new album for it, with
// editing/deleting a specific item gated per-item by that item's own
// `canEdit` (HR can touch anything; another manager only their own upload)
// — enforced server-side either way, this is only which controls to show.
export default function CompanyCelebrationsView({ canManage, canContribute }: { canManage: boolean; canContribute: boolean }) {
  const [category, setCategory] = useState<CelebrationCategory | null>(null);
  const [subfolder, setSubfolder] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [countByCategory, setCountByCategory] = useState<Record<string, number>>({});
  const [subfolders, setSubfolders] = useState<SubfolderSummary[]>([]);
  const [items, setItems] = useState<CelebrationItem[]>([]);
  const [status, setStatus] = useState('Loading…');

  const [showNewAlbum, setShowNewAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderIcon, setNewFolderIcon] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAlbumName = useRef('');
  const confirmDialog = useConfirm();
  const promptDialog = usePrompt();

  const loadTop = useCallback(async () => {
    setStatus('Loading…');
    const res = await fetch('/api/hr/celebrations');
    if (!res.ok) {
      setStatus('Could not load the celebration wall.');
      return;
    }
    const data = await res.json();
    setCategories(data.categories ?? []);
    setCountByCategory(data.countByCategory ?? {});
    setStatus('');
  }, []);

  const loadSubfolders = useCallback(async (cat: CelebrationCategory) => {
    setStatus('Loading…');
    const res = await fetch(`/api/hr/celebrations?category=${encodeURIComponent(cat)}`);
    if (!res.ok) {
      setStatus('Could not load albums for this category.');
      return;
    }
    const data = await res.json();
    setSubfolders(data.subfolders ?? []);
    setStatus(data.subfolders?.length ? '' : 'No albums here yet.');
  }, []);

  const loadItems = useCallback(async (cat: CelebrationCategory, sub: string) => {
    setStatus('Loading…');
    const res = await fetch(`/api/hr/celebrations?category=${encodeURIComponent(cat)}&subfolder=${encodeURIComponent(sub)}`);
    if (!res.ok) {
      setStatus('Could not load this album.');
      return;
    }
    const data = await res.json();
    setItems(data.items ?? []);
    setStatus(data.items?.length ? '' : 'No photos or videos here yet.');
  }, []);

  useEffect(() => {
    if (!category) {
      loadTop();
    } else if (!subfolder) {
      loadSubfolders(category);
    } else {
      loadItems(category, subfolder);
    }
  }, [category, subfolder, loadTop, loadSubfolders, loadItems]);

  function openCategory(cat: CelebrationCategory) {
    setCategory(cat);
    setSubfolder(null);
    setError('');
  }

  function openSubfolder(name: string) {
    setSubfolder(name);
    setError('');
  }

  function goBack() {
    setError('');
    if (subfolder) {
      setSubfolder(null);
    } else {
      setCategory(null);
    }
  }

  function startNewAlbum() {
    setNewAlbumName('');
    setError('');
    setShowNewAlbum(true);
  }

  function startNewFolder() {
    setNewFolderName('');
    setNewFolderIcon('');
    setError('');
    setShowNewFolder(true);
  }

  // Unlike an album (which only exists once its first photo does), a
  // top-level folder is a real row the moment it's created — it's meant to
  // sit in the grid empty until HR starts filling it.
  async function confirmNewFolder() {
    const label = newFolderName.trim();
    if (!label) {
      setError('Give this folder a name.');
      return;
    }
    setSavingFolder(true);
    setError('');
    try {
      const res = await fetch('/api/hr/celebrations/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, icon: newFolderIcon.trim() })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Could not add this folder.');
        return;
      }
      setShowNewFolder(false);
      await loadTop();
    } finally {
      setSavingFolder(false);
    }
  }

  // Creating an album and adding the first photo are one step from the HR
  // Manager's side: there is no bare "empty folder" concept in the store —
  // a subfolder exists the moment its first item does — so this just opens
  // the file picker with the typed name remembered for the upload handler.
  function confirmNewAlbum() {
    const name = newAlbumName.trim();
    if (!name) {
      setError('Give this album a name.');
      return;
    }
    pendingAlbumName.current = name;
    setShowNewAlbum(false);
    fileInputRef.current?.click();
  }

  function triggerUploadIntoCurrentAlbum() {
    pendingAlbumName.current = subfolder || '';
    fileInputRef.current?.click();
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !category) return;
    const albumName = pendingAlbumName.current;
    if (!albumName) return;

    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('folder', 'celebrations');
      formData.append('files', file);
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      const uploadBody = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadBody.urls?.[0]) {
        setError(uploadBody.error || 'Could not upload the file.');
        return;
      }

      const createRes = await fetch('/api/hr/celebrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          subfolder: albumName,
          fileUrl: uploadBody.urls[0],
          mimeType: file.type
        })
      });
      const createBody = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        setError(createBody.error || 'Could not save this to the celebration wall.');
        return;
      }

      setSubfolder(albumName);
      await loadItems(category, albumName);
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteItem(id: string) {
    if (!(await confirmDialog({ title: 'Remove photo/video?', message: 'This will remove it from the celebration wall. This cannot be undone.', confirmLabel: 'Remove', danger: true }))) return;
    const res = await fetch(`/api/hr/celebrations/${id}`, { method: 'DELETE' });
    if (res.ok && category && subfolder) await loadItems(category, subfolder);
  }

  // ---- Edit / delete (HR Manager, admin, superadmin) ----

  async function send(url: string, method: 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
    setError('');
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not save the change.');
      return false;
    }
    return true;
  }

  async function handleEditItem(item: CelebrationItem) {
    const title = await promptDialog({ title: 'Edit caption', message: 'Caption for this photo/video', defaultValue: item.title, placeholder: 'e.g. Cake cutting', confirmLabel: 'Save' });
    if (title === null) return;
    if (await send(`/api/hr/celebrations/${item.id}`, 'PATCH', { title }) && category && subfolder) await loadItems(category, subfolder);
  }

  async function handleRenameAlbum(name: string) {
    if (!category) return;
    const next = (await promptDialog({ title: 'Rename album', defaultValue: name, confirmLabel: 'Save', validate: (v) => (v.trim() ? null : 'Give this album a name.') }))?.trim();
    if (!next || next === name) return;
    if (!(await send('/api/hr/celebrations/albums', 'PATCH', { category, subfolder: name, name: next }))) return;
    if (subfolder === name) setSubfolder(next);
    else await loadSubfolders(category);
  }

  async function handleDeleteAlbum(name: string, count: number) {
    if (!category) return;
    if (!(await confirmDialog({ title: 'Delete album?', message: `"${name}" and all ${count} photo/video${count === 1 ? '' : 's'} in it will be deleted. This cannot be undone.`, confirmLabel: 'Delete album', danger: true }))) return;
    if (!(await send('/api/hr/celebrations/albums', 'DELETE', { category, subfolder: name }))) return;
    if (subfolder === name) setSubfolder(null);
    else await loadSubfolders(category);
  }

  async function handleEditFolder(cat: CategoryInfo) {
    const label = (await promptDialog({ title: 'Rename folder', defaultValue: cat.label, confirmLabel: 'Next', validate: (v) => (v.trim() ? null : 'Give this folder a name.') }))?.trim();
    if (!label) return;
    const icon = await promptDialog({ title: 'Folder icon', message: 'One emoji — leave blank for the default icon', defaultValue: cat.icon || '', placeholder: '🎉', confirmLabel: 'Save' });
    if (icon === null) return;
    if (await send(`/api/hr/celebrations/categories/${encodeURIComponent(cat.key)}`, 'PATCH', { label, icon })) await loadTop();
  }

  async function handleDeleteFolder(cat: CategoryInfo) {
    const count = countByCategory[cat.key] ?? 0;
    if (!(await confirmDialog({ title: 'Delete folder?', message: `"${cat.label}"${count ? ` and all ${count} item${count === 1 ? '' : 's'} in it` : ''} will be deleted. This cannot be undone.`, confirmLabel: 'Delete folder', danger: true }))) return;
    if (await send(`/api/hr/celebrations/categories/${encodeURIComponent(cat.key)}`, 'DELETE')) await loadTop();
  }

  // The tile's Edit / Delete live in one ⋮ menu, pinned top-right so it never
  // sits on top of the tile's title.
  const tileActions = (onEdit: () => void, onDelete: () => void, what: string) => (
    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>
      <RowActions
        label={`Actions for ${what}`}
        actions={[
          { key: 'edit', label: 'Edit', icon: <Pencil size={14} />, onClick: onEdit },
          { key: 'delete', label: 'Delete', icon: <Trash2 size={14} />, destructive: true, onClick: onDelete }
        ]}
      />
    </div>
  );

  return (
    <AppShell title="Company Celebration" subtitle="HR › Birthdays, anniversaries, events, festivals and company moments">
      <input ref={fileInputRef} type="file" accept="image/*,video/*" hidden onChange={handleFileChosen} />

      {(category || subfolder) && (
        <CommonHeader
          tone="light"
          onBack={goBack}
          backLabel="Back"
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {category && <CategoryIcon category={category} categories={categories} size={14} />}
              {category ? categoryLabelFor(category, categories) : ''}
              {subfolder ? ` / ${subfolder}` : ''}
            </span>
          }
        />
      )}

      {error && <p style={{ color: 'var(--mx-danger)', marginTop: 8 }}>{error}</p>}
      {uploading && <p className={calcStyles.small}>Uploading…</p>}

      {!category && (
        <>
          {canManage && !showNewFolder && (
            <div className={historyStyles.toolbar}>
              <CommonButton variant="secondary" size="md" leadingIcon={<FolderPlus size={16} />} onClick={startNewFolder}>
                Add Folder
              </CommonButton>
            </div>
          )}

          {showNewFolder && (
            <div className={calcStyles.sectionPanel} style={{ marginTop: 12, marginBottom: 4 }}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label} htmlFor="celebration-folder-name">
                  Folder name *
                </label>
                <input
                  id="celebration-folder-name"
                  type="text"
                  className={calcStyles.formControl}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g. Sports Day"
                  autoFocus
                />
              </div>
              <div className={calcStyles.field} style={{ marginTop: 8 }}>
                <label className={calcStyles.label} htmlFor="celebration-folder-icon">
                  Icon (optional — pick one, or type/paste any emoji)
                </label>
                <div className={calcStyles.inlineFlexGap8} style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                  {FOLDER_EMOJI_CHOICES.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setNewFolderIcon(emoji)}
                      aria-label={`Use ${emoji}`}
                      aria-pressed={newFolderIcon === emoji}
                      style={{
                        fontSize: 20,
                        lineHeight: 1,
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        border: newFolderIcon === emoji ? '2px solid var(--mx-primary, #2563eb)' : '1px solid var(--mx-border, #e2e8f0)',
                        background: 'var(--mx-surface-2, #f8fafc)',
                        cursor: 'pointer'
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <input
                  id="celebration-folder-icon"
                  type="text"
                  className={calcStyles.formControl}
                  style={{ maxWidth: 120 }}
                  value={newFolderIcon}
                  onChange={(e) => setNewFolderIcon(e.target.value)}
                  placeholder="🎉"
                  maxLength={8}
                />
              </div>
              <div className={`${calcStyles.inlineFlexGap8} ${calcStyles.mt8}`}>
                <CommonButton variant="primary" size="md" onClick={confirmNewFolder} loading={savingFolder} loadingLabel="Adding…">
                  Add Folder
                </CommonButton>
                <CommonButton variant="secondary" size="md" leadingIcon={<X size={14} />} onClick={() => setShowNewFolder(false)}>
                  Cancel
                </CommonButton>
              </div>
            </div>
          )}

          {status === 'Loading…' && categories.length === 0 && (
            <div style={{ marginTop: 12 }}><SkeletonCards count={6} minWidth={220} /></div>
          )}
          {status && status !== 'Loading…' && categories.length === 0 && <p className={calcStyles.small}>{status}</p>}

          <div className={calcStyles.row} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginTop: 12 }}>
            {categories.map((cat) => (
              <div key={cat.key} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={calcStyles.sectionPanel}
                  style={{ width: '100%', height: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, paddingRight: canManage ? 84 : undefined }}
                  onClick={() => openCategory(cat.key)}
                >
                  <CategoryIcon category={cat.key} categories={categories} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{cat.label}</div>
                    <div className={calcStyles.small}>{countByCategory[cat.key] ?? 0} item{(countByCategory[cat.key] ?? 0) === 1 ? '' : 's'}</div>
                  </div>
                </button>
                {canManage && tileActions(() => handleEditFolder(cat), () => handleDeleteFolder(cat), 'folder')}
              </div>
            ))}
          </div>
        </>
      )}

      {category && !subfolder && (
        <>
          {canContribute && (
            <div className={historyStyles.toolbar} style={{ marginTop: 8 }}>
              <CommonButton variant="primary" size="md" leadingIcon={<Plus size={16} />} onClick={startNewAlbum}>
                New Album
              </CommonButton>
            </div>
          )}

          {showNewAlbum && (
            <div className={calcStyles.sectionPanel} style={{ marginTop: 12, marginBottom: 16 }}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label} htmlFor="celebration-album-name">
                  {category === 'birthday' || category === 'anniversary' || category === 'employee_appreciation'
                    ? 'Employee name *'
                    : 'Event / title *'}
                </label>
                <input
                  id="celebration-album-name"
                  type="text"
                  className={calcStyles.formControl}
                  value={newAlbumName}
                  onChange={(e) => setNewAlbumName(e.target.value)}
                  placeholder={
                    category === 'birthday' || category === 'anniversary' || category === 'employee_appreciation'
                      ? 'e.g. Employee Name'
                      : 'e.g. Title'
                  }
                />
              </div>
              <div className={`${calcStyles.inlineFlexGap8} ${calcStyles.mt8}`}>
                <CommonButton variant="primary" size="md" leadingIcon={<Upload size={14} />} onClick={confirmNewAlbum}>
                  Choose Photo/Video
                </CommonButton>
                <CommonButton variant="secondary" size="md" leadingIcon={<X size={14} />} onClick={() => setShowNewAlbum(false)}>
                  Cancel
                </CommonButton>
              </div>
            </div>
          )}

          {status === 'Loading…' && subfolders.length === 0 ? (
            <div style={{ marginTop: 12 }}><SkeletonCards count={6} minWidth={180} /></div>
          ) : (
            status && <p className={calcStyles.small}>{status}</p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 12 }}>
            {subfolders.map((sf) => (
              <div key={sf.name} style={{ position: 'relative' }}>
              {canManage && tileActions(() => handleRenameAlbum(sf.name), () => handleDeleteAlbum(sf.name, sf.itemCount), 'album')}
              <button
                type="button"
                className={calcStyles.sectionPanel}
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: 0, overflow: 'hidden' }}
                onClick={() => openSubfolder(sf.name)}
              >
                <div style={{ height: 120, background: 'var(--mx-surface-2, #f3f3f3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {sf.coverKind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sf.coverUrl} alt={sf.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : sf.coverKind === 'video' ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      <video src={sf.coverUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                      <CirclePlay
                        size={32}
                        aria-hidden="true"
                        style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#fff', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}
                      />
                    </div>
                  ) : (
                    <FileText size={32} aria-label="File" style={{ color: 'var(--mx-ink-faint, #94a3b8)' }} />
                  )}
                </div>
                <div style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {category && <CategoryIcon category={category} categories={categories} size={14} />}
                    {sf.name}
                  </div>
                  <div className={calcStyles.small}>{sf.itemCount} item{sf.itemCount === 1 ? '' : 's'}</div>
                </div>
              </button>
              </div>
            ))}
          </div>
        </>
      )}

      {category && subfolder && (
        <>
          {(canContribute || canManage) && (
            <div className={historyStyles.toolbar} style={{ marginTop: 8 }}>
              {canContribute && (
                <CommonButton variant="primary" size="md" leadingIcon={<Upload size={16} />} onClick={triggerUploadIntoCurrentAlbum}>
                  Add Photo/Video
                </CommonButton>
              )}
              {canManage && (
                <RowActions
                  size="md"
                  label="Album actions"
                  actions={[
                    { key: 'rename', label: 'Rename Album', icon: <Pencil size={14} />, onClick: () => handleRenameAlbum(subfolder) },
                    { key: 'delete', label: 'Delete Album', icon: <Trash2 size={14} />, destructive: true, onClick: () => handleDeleteAlbum(subfolder, items.length) }
                  ]}
                />
              )}
            </div>
          )}

          {status === 'Loading…' && items.length === 0 ? (
            <div style={{ marginTop: 12 }}><SkeletonCards count={6} minWidth={200} /></div>
          ) : (
            status && <p className={calcStyles.small}>{status}</p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginTop: 12 }}>
            {items.map((item) => (
              <div key={item.id} className={calcStyles.sectionPanel} style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
                {item.canEdit && tileActions(() => handleEditItem(item), () => handleDeleteItem(item.id), 'photo/video')}
                {item.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.fileUrl} alt={item.title || subfolder} style={{ width: '100%', height: 200, objectFit: 'cover' }} />
                ) : item.kind === 'video' ? (
                  <video src={item.fileUrl} controls style={{ width: '100%', height: 200, objectFit: 'cover' }} />
                ) : (
                  <a href={item.fileUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16 }}>
                    <FileText size={18} aria-hidden="true" /> Open file
                  </a>
                )}
                {item.title && <div style={{ padding: '8px 8px 0', fontWeight: 600, fontSize: 14 }}>{item.title}</div>}
                <div style={{ padding: 8 }} className={calcStyles.small}>
                  {item.addedBy && <>Added by {item.addedBy}</>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
