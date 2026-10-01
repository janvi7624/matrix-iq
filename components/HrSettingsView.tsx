'use client';

import { FormEvent, useEffect, useState } from 'react';
import { HrTaskCategoryRecord } from '@/lib/types';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import SubmitButton from './ui/SubmitButton';

export default function HrSettingsView() {
  const toast = useToast();
  const [categories, setCategories] = useState<HrTaskCategoryRecord[]>([]);
  const [newCategory, setNewCategory] = useState('');

  async function load() {
    const catRes = await fetch('/api/hr/categories');
    if (catRes.ok) setCategories(await catRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    try {
      const response = await fetch('/api/hr/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategory.trim() })
      });
      if (!response.ok) throw new Error();
      setNewCategory('');
      await load();
      toast.success('Category added.');
    } catch {
      toast.error('Could not add this category.');
    }
  }

  async function toggleCategory(id: string, active: boolean) {
    try {
      const response = await fetch(`/api/hr/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active })
      });
      if (!response.ok) throw new Error();
      await load();
    } catch {
      toast.error('Could not update this category.');
    }
  }

  return (
    <AppShell title="HR Settings" subtitle="Task categories for HR Tasks.">
      <div className={`${calcStyles.h2}`}>Task Categories</div>
      <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={addCategory}>
        <FieldRow>
          <Field label="New Category">
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Vendor Coordination" />
          </Field>
        </FieldRow>
        <SubmitButton>Add Category</SubmitButton>
      </form>
      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.active ? 'Active' : 'Inactive'}</td>
                <td><button type="button" className={historyStyles.button} onClick={() => toggleCategory(c.id, c.active)}>{c.active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
