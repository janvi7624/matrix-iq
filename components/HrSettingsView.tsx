'use client';

import { FormEvent, useEffect, useState } from 'react';
import { DepartmentRecord, GeneralTaskPriority, HrRecurrenceType, HrRecurringTaskTemplateRecord, HrTaskCategoryRecord } from '@/lib/types';
import { GENERAL_TASK_PRIORITY_LABEL } from '@/lib/generalTaskLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import SubmitButton from './ui/SubmitButton';

interface EmployeeOption {
  id: string;
  name: string;
}

const EMPTY_TEMPLATE_FORM = {
  title: '',
  departmentId: '',
  assigneeId: '',
  categoryId: '',
  priority: 'medium' as GeneralTaskPriority,
  requiresReview: true,
  recurrenceType: 'daily' as HrRecurrenceType,
  weekday: 1,
  dayOfMonth: 1
};

const WEEKDAY_LABEL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function HrSettingsView() {
  const toast = useToast();
  const [categories, setCategories] = useState<HrTaskCategoryRecord[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [templates, setTemplates] = useState<HrRecurringTaskTemplateRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE_FORM);
  const [creatingTemplate, setCreatingTemplate] = useState(false);

  async function load() {
    const [catRes, tmplRes, deptRes] = await Promise.all([fetch('/api/hr/categories'), fetch('/api/hr/recurring-templates'), fetch('/api/departments')]);
    if (catRes.ok) setCategories(await catRes.json());
    if (tmplRes.ok) setTemplates(await tmplRes.json());
    if (deptRes.ok) setDepartments(await deptRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!templateForm.departmentId) {
      setEmployees([]);
      return;
    }
    fetch(`/api/departments/${templateForm.departmentId}/active-employees`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setEmployees)
      .catch(() => setEmployees([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateForm.departmentId]);

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

  async function createTemplate(e: FormEvent) {
    e.preventDefault();
    if (!templateForm.title.trim() || !templateForm.departmentId || !templateForm.assigneeId) {
      toast.error('Title, department, and employee are required.');
      return;
    }
    setCreatingTemplate(true);
    try {
      const response = await fetch('/api/hr/recurring-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateForm)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setTemplateForm(EMPTY_TEMPLATE_FORM);
      await load();
      toast.success('Recurring task template created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this template.');
    } finally {
      setCreatingTemplate(false);
    }
  }

  async function toggleTemplate(id: string, active: boolean) {
    try {
      const response = await fetch(`/api/hr/recurring-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active })
      });
      if (!response.ok) throw new Error();
      await load();
    } catch {
      toast.error('Could not update this template.');
    }
  }

  return (
    <AppShell title="HR Settings" subtitle="Task categories and recurring task templates.">
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

      <div className={`${calcStyles.h2}`} style={{ marginTop: 24 }}>Recurring Task Templates</div>
      <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={createTemplate}>
        <FieldRow>
          <Field label="Title">
            <Input value={templateForm.title} onChange={(e) => setTemplateForm((f) => ({ ...f, title: e.target.value }))} required />
          </Field>
          <Field label="Department">
            <Select value={templateForm.departmentId} onChange={(e) => setTemplateForm((f) => ({ ...f, departmentId: e.target.value, assigneeId: '' }))} required>
              <option value="">Select department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Employee">
            <Select value={templateForm.assigneeId} onChange={(e) => setTemplateForm((f) => ({ ...f, assigneeId: e.target.value }))} required disabled={!templateForm.departmentId}>
              <option value="">Select employee</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Category">
            <Select value={templateForm.categoryId} onChange={(e) => setTemplateForm((f) => ({ ...f, categoryId: e.target.value }))}>
              <option value="">No category</option>
              {categories.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={templateForm.priority} onChange={(e) => setTemplateForm((f) => ({ ...f, priority: e.target.value as GeneralTaskPriority }))}>
              {(Object.keys(GENERAL_TASK_PRIORITY_LABEL) as GeneralTaskPriority[]).map((p) => (
                <option key={p} value={p}>{GENERAL_TASK_PRIORITY_LABEL[p]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Recurrence">
            <Select value={templateForm.recurrenceType} onChange={(e) => setTemplateForm((f) => ({ ...f, recurrenceType: e.target.value as HrRecurrenceType }))}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
        </FieldRow>
        {templateForm.recurrenceType === 'weekly' && (
          <Field label="Weekday">
            <Select value={templateForm.weekday} onChange={(e) => setTemplateForm((f) => ({ ...f, weekday: Number(e.target.value) }))}>
              {WEEKDAY_LABEL.map((label, i) => (
                <option key={label} value={i + 1}>{label}</option>
              ))}
            </Select>
          </Field>
        )}
        {templateForm.recurrenceType === 'monthly' && (
          <Field label="Day of Month">
            <Input type="number" min={1} max={31} value={templateForm.dayOfMonth} onChange={(e) => setTemplateForm((f) => ({ ...f, dayOfMonth: Number(e.target.value) }))} />
          </Field>
        )}
        <SubmitButton disabled={creatingTemplate}>{creatingTemplate ? 'Creating…' : 'Create Template'}</SubmitButton>
      </form>

      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead><tr><th>Title</th><th>Department</th><th>Assignee</th><th>Recurrence</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td>{t.department_name}</td>
                <td>{t.assignee_name}</td>
                <td>{t.recurrence_type}</td>
                <td>{t.active ? 'Yes' : 'No'}</td>
                <td><button type="button" className={historyStyles.button} onClick={() => toggleTemplate(t.id, t.active)}>{t.active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
