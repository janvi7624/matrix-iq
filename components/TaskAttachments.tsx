'use client';

import { useRef, useState } from 'react';
import { Download, Eye, File, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip, UploadCloud } from 'lucide-react';
import CommonButton from './ui/CommonButton';
import styles from './taskAttachments.module.css';

// The stored name is "<timestamp>-<8 hex>-<original name>" (see
// app/api/uploads/route.ts) — show people the name they actually uploaded.
function displayName(url: string): string {
  const last = decodeURIComponent(url.split('/').pop() || 'file');
  return last.replace(/^\d{10,}-[0-9a-f]{8}-/i, '');
}

function iconFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return FileImage;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) return FileText;
  return File;
}

function extLabel(name: string): string {
  const ext = name.split('.').pop();
  return ext && ext !== name ? ext.toUpperCase() : 'FILE';
}

// Task attachments: one obvious place to drop or pick files, and a list where
// each file shows its real name and type with View and Download buttons.
export default function TaskAttachments({
  attachments,
  uploading,
  onUpload
}: {
  attachments: string[];
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.title}>
          <Paperclip size={16} /> Attachments
        </span>
        <span className={styles.count}>{attachments.length} file{attachments.length === 1 ? '' : 's'}</span>
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
            <span className={styles.dropMain}>
              <strong>Click to choose files</strong> or drag them here
            </span>
            <span className={styles.dropHint}>PDF, images, Word or Excel · up to 10 MB each · you can pick several at once</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onUpload(e.target.files);
          e.target.value = '';
        }}
      />

      {attachments.length === 0 ? (
        <p className={styles.empty}>No files attached yet.</p>
      ) : (
        <ul className={styles.list}>
          {attachments.map((url) => {
            const name = displayName(url);
            const Icon = iconFor(name);
            return (
              <li key={url} className={styles.item}>
                <span className={styles.fileIcon}><Icon size={18} /></span>
                <span className={styles.fileMain}>
                  <span className={styles.fileName} title={name}>{name}</span>
                  <span className={styles.fileType}>{extLabel(name)}</span>
                </span>
                <CommonButton href={url} native target="_blank" rel="noreferrer" variant="secondary" size="sm" leadingIcon={<Eye />}>
                  View
                </CommonButton>
                <CommonButton
                  href={url}
                  native
                  download={name}
                  variant="outlined"
                  size="sm"
                  iconOnly
                  aria-label={`Download ${name}`}
                  title="Download"
                  leadingIcon={<Download />}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
