'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, File, FileImage, FileSpreadsheet, FileText, Loader2, Lock, Receipt, UploadCloud } from 'lucide-react';
import { QuotationRecord } from '@/lib/types';
import { downloadQuotationFromRecord } from '@/lib/quotationPdfFromRecord';
import { useToast } from './ui/ToastProvider';
import CommonButton from './ui/CommonButton';
import CommonChip from './ui/CommonChip';
import SearchInput from './ui/SearchInput';
import { SkeletonList } from './ui/Skeleton';
import styles from './taskAttachments.module.css';
import docs from './projectDocuments.module.css';

interface DocItem {
  url: string;
  name: string;
  source: string;
  context: string;
  at: string;
}

function iconFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return FileImage;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) return FileText;
  return File;
}

const fmt = (iso: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

// The TMS project's Attachments tab: one place for EVERY document tied to the
// project — uploaded here, on its tasks, BOM / procurement, or on the sales
// side before handover (PO, site-visit photos, demo files) — plus the won
// quotation as a PDF. The server returns only what an assigned member may see.
export default function ProjectDocuments({
  projectId,
  uploading,
  onUpload,
  refreshKey
}: {
  projectId: string;
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
  refreshKey: number;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<DocItem[]>([]);
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading');
  const [source, setSource] = useState('All');
  const [query, setQuery] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tms/projects/${projectId}/documents`);
      if (res.status === 403) return setState('forbidden');
      if (!res.ok) return setState('error');
      const body = await res.json();
      setItems(body.documents || []);
      setQuotations(body.quotations || []);
      setState('ok');
    } catch {
      setState('error');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const sources = useMemo(() => ['All', ...Array.from(new Set(items.map((d) => d.source)))], [items]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((d) => (source === 'All' || d.source === source) && (!q || `${d.name} ${d.context} ${d.source}`.toLowerCase().includes(q)));
  }, [items, source, query]);

  async function downloadQuote(q: QuotationRecord) {
    setDownloading(q.id);
    try {
      const outcome = await downloadQuotationFromRecord(q);
      if (outcome === 'nothing-to-download') toast.error('This quotation has no document to download.');
    } catch {
      toast.error('Could not build the quotation PDF.');
    } finally {
      setDownloading(null);
    }
  }

  if (state === 'forbidden') {
    return (
      <div className={styles.wrap}>
        <p className={docs.locked}><Lock size={16} /> Only people assigned to this project can see its documents.</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.title}>All project documents</span>
        <span className={styles.count}>{items.length + quotations.length} total</span>
      </div>

      <button
        type="button"
        className={`${styles.drop} ${dragOver ? styles.dropActive : ''}`}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!uploading) onUpload(e.dataTransfer.files); }}
      >
        {uploading ? (
          <>
            <Loader2 size={22} className={styles.spin} />
            <span className={styles.dropMain}>Uploading…</span>
          </>
        ) : (
          <>
            <UploadCloud size={24} />
            <span className={styles.dropMain}><strong>Click to add project files</strong> or drag them here</span>
            <span className={styles.dropHint}>Files added on tasks, BOM, procurement and the sales side show up here automatically</span>
          </>
        )}
      </button>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />

      {quotations.length > 0 && (
        <div className={docs.quoteBox}>
          <div className={docs.quoteTitle}><Receipt size={16} /> Won quotation{quotations.length > 1 ? 's' : ''}</div>
          {quotations.map((q) => (
            <div key={q.id} className={styles.item}>
              <span className={`${styles.fileIcon} ${docs.quoteIcon}`}><Receipt size={18} /></span>
              <span className={styles.fileMain}>
                <span className={styles.fileName}>{q.quotation_number}</span>
                <span className={styles.fileType}>APPROVED{q.client_name ? ` · ${q.client_name}` : ''}</span>
              </span>
              <CommonButton variant="secondary" size="sm" leadingIcon={<Download />} disabled={downloading === q.id} onClick={() => downloadQuote(q)}>
                {downloading === q.id ? 'Preparing…' : 'Download PDF'}
              </CommonButton>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className={docs.filters}>
          <div className={docs.chips}>
            {sources.map((s) => (
              <CommonChip
                key={s}
                size="sm"
                label={s}
                count={s === 'All' ? items.length : items.filter((d) => d.source === s).length}
                selected={source === s}
                onClick={() => setSource(s)}
              />
            ))}
          </div>
          <SearchInput size="sm" inline placeholder="Search files" value={query} onChange={(v) => setQuery(v)} />
        </div>
      )}

      {state === 'loading' ? (
        <SkeletonList rows={4} boxed={false} />
      ) : state === 'error' ? (
        <p className={styles.empty}>Could not load documents. <CommonButton variant="link" size="sm" onClick={load}>Retry</CommonButton></p>
      ) : items.length === 0 && quotations.length === 0 ? (
        <p className={styles.empty}>No documents yet for this project.</p>
      ) : shown.length === 0 ? (
        <p className={styles.empty}>No files match.</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((d) => {
            const Icon = iconFor(d.name);
            return (
              <li key={d.url} className={styles.item}>
                <span className={styles.fileIcon}><Icon size={18} /></span>
                <span className={styles.fileMain}>
                  <span className={styles.fileName} title={d.name}>{d.name}</span>
                  <span className={docs.meta}>
                    <span className={docs.sourceTag}>{d.source}</span>
                    {d.context && <span className={docs.context} title={d.context}>{d.context}</span>}
                    {d.at && <span>{fmt(d.at)}</span>}
                  </span>
                </span>
                <CommonButton variant="secondary" size="sm" leadingIcon={<Eye />} href={d.url} native target="_blank" rel="noreferrer">View</CommonButton>
                <CommonButton variant="ghost" size="sm" iconOnly leadingIcon={<Download />} href={d.url} native download={d.name} aria-label={`Download ${d.name}`} title="Download" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
