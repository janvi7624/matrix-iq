'use client';

import { useEffect, useRef, useState } from 'react';
import { CustomFieldDef, ProductRecord, ProjectRecord } from '@/lib/types';
import { selectAllOnFocusIfZero } from '@/lib/numberInputHelpers';
import styles from './calculator.module.css';

interface UserLite {
  username: string;
  name: string;
}

interface CustomFieldInputProps {
  field: CustomFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

// Renders the right input for every CustomFieldType — the one place that
// knows how to edit each type, shared by the create form and the edit form
// in app/modules/[key]/page.tsx so both stay in sync automatically.
export default function CustomFieldInput({ field, value, onChange }: CustomFieldInputProps) {
  const [users, setUsers] = useState<UserLite[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (field.type === 'user' && users.length === 0) {
      fetch('/api/users/lite').then((r) => (r.ok ? r.json() : [])).then(setUsers).catch(() => setUsers([]));
    }
    if (field.type === 'project' && projects.length === 0) {
      fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).then(setProjects).catch(() => setProjects([]));
    }
    if (field.type === 'product' && products.length === 0) {
      fetch('/api/products').then((r) => (r.ok ? r.json() : [])).then(setProducts).catch(() => setProducts([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.type]);

  async function handleFileSelect(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('folder', 'custom-modules');
      formData.append('files', file);
      const response = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('upload failed');
      const body: { urls: string[] } = await response.json();
      onChange(body.urls[0] || '');
    } catch {
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
      return (
        <input
          className={styles.formControl}
          type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <input className={styles.formControl} type="number" value={value === 0 || value === undefined ? '' : (value as number)} onFocus={selectAllOnFocusIfZero} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
      );
    case 'currency':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>₹</span>
          <input className={styles.formControl} type="number" placeholder="Enter amount" value={value === 0 || value === undefined ? '' : (value as number)} onFocus={selectAllOnFocusIfZero} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
        </div>
      );
    case 'date':
      return <input className={styles.formControl} type="date" value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'time':
      return <input className={styles.formControl} type="time" value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'dropdown':
      return (
        <select className={styles.formControl} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select...</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {field.options.map((o) => (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((s) => s !== o))}
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case 'checkbox':
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case 'radio':
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {field.options.map((o) => (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13.5 }}>
              <input type="radio" name={field.id} checked={value === o} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
        </div>
      );
    case 'textarea':
    case 'richtext':
      return <textarea className={styles.formControl} rows={3} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'file':
    case 'image':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input ref={fileInputRef} type="file" accept={field.type === 'image' ? 'image/*' : undefined} disabled={uploading} onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
          {uploading && <span>Uploading...</span>}
          {typeof value === 'string' && value && (
            field.type === 'image'
              ? <img src={value} alt={field.label} style={{ height: 40, borderRadius: 6 }} />
              : <a href={value} target="_blank" rel="noreferrer">View file</a>
          )}
        </div>
      );
    case 'user':
      return (
        <select className={styles.formControl} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select user...</option>
          {users.map((u) => <option key={u.username} value={u.username}>{u.name} ({u.username})</option>)}
        </select>
      );
    case 'project':
      return (
        <select className={styles.formControl} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select project...</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.company || p.client_name}</option>)}
        </select>
      );
    case 'product':
      return (
        <select className={styles.formControl} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select product...</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      );
    default:
      return <input className={styles.formControl} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />;
  }
}
