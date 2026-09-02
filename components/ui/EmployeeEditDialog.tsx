'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { DepartmentRecord, PublicUser, RoleRecord, UserRole } from '@/lib/types';
import { useModalBehavior } from '@/lib/useModalBehavior';
import PhoneInput from './PhoneInput';
import notifyStyles from './notify.module.css';
import calcStyles from '../calculator.module.css';
import historyStyles from '../quotationHistory.module.css';
import styles from './employeeEditDialog.module.css';

export interface EmployeeEditPayload {
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  employeeId: string;
  department: string;
  designation: string;
  password: string;
  isDepartmentManager: boolean;
}

interface EmployeeEditDialogProps {
  user: PublicUser;
  roles: RoleRecord[];
  departments: DepartmentRecord[];
  includeSuperadmin: boolean;
  error?: string;
  saving: boolean;
  onSave: (payload: EmployeeEditPayload) => void;
  onClose: () => void;
}

// Replaces the old in-table inline edit row, which swapped eight <td>s for
// form controls while the <thead> above still said "Username | Name | … |
// Role | Status | Actions". The controls didn't line up with those headers —
// the password field rendered under "Status" — and eight inputs squeezed into
// table cells were unusable at any width. A dialog also means the row's
// surrounding context stays readable while editing.
export default function EmployeeEditDialog({
  user,
  roles,
  departments,
  includeSuperadmin,
  error,
  saving,
  onSave,
  onClose
}: EmployeeEditDialogProps) {
  const [form, setForm] = useState<EmployeeEditPayload>(() => ({
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId || '',
    department: user.department || '',
    designation: user.designation || '',
    password: '',
    isDepartmentManager: departments.find((d) => d.name === user.department)?.managerIds.includes(user.id) ?? false
  }));

  // Escape / focus trap / scroll lock / focus restore — see
  // lib/useModalBehavior.ts, shared with DepartmentHealthDetail.
  const cardRef = useModalBehavior(onClose);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  const set = <K extends keyof EmployeeEditPayload>(key: K, value: EmployeeEditPayload[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className={notifyStyles.overlay} role="presentation" onClick={onClose}>
      <div
        ref={cardRef}
        className={notifyStyles.wideCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="employeeEditTitle"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={notifyStyles.confirmTitle} id="employeeEditTitle">
          Edit {user.name || user.username}
        </div>
        <div className={`${notifyStyles.confirmMessage} ${notifyStyles.confirmMessageMb18}`}>
          Username <strong>@{user.username}</strong> can&apos;t be changed. Leave the password field blank to keep the current password.
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className={historyStyles.loginError}>{error}</div>}

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="editName">Full name</label>
              <input
                ref={firstFieldRef}
                id="editName"
                className={calcStyles.formControl}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="editEmployeeId">Employee ID</label>
              <input id="editEmployeeId" className={calcStyles.formControl} value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)} />
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="editEmail">Email</label>
              <input id="editEmail" type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="editPhone">Phone</label>
              <PhoneInput id="editPhone" value={form.phone} onChange={(v) => set('phone', v)} />
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="editDepartment">Department</label>
              <select id="editDepartment" className={calcStyles.formControl} value={form.department} onChange={(e) => set('department', e.target.value)}>
                <option value="">No department</option>
                {[...departments].sort((a, b) => a.name.localeCompare(b.name)).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              {form.department && (
                <label className={`${calcStyles.label} ${styles.managerCheckboxLabel}`}>
                  <input
                    type="checkbox"
                    checked={form.isDepartmentManager}
                    onChange={(e) => set('isDepartmentManager', e.target.checked)}
                    className={styles.managerCheckbox}
                  />
                  Manager of {form.department}
                </label>
              )}
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="editDesignation">Designation</label>
              <input id="editDesignation" className={calcStyles.formControl} placeholder="e.g. Sales Executive" value={form.designation} onChange={(e) => set('designation', e.target.value)} />
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="editRole">Role</label>
              <select id="editRole" className={calcStyles.formControl} value={form.role} onChange={(e) => set('role', e.target.value as UserRole)}>
                {roles
                  .filter((r) => r.key !== 'superadmin' || includeSuperadmin)
                  .map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="editPassword">Set a new password</label>
              <input
                id="editPassword"
                type="password"
                autoComplete="new-password"
                className={calcStyles.formControl}
                placeholder="Leave blank to keep current"
                minLength={6}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
              />
            </div>
          </div>

          <div className={`${notifyStyles.confirmActions} ${notifyStyles.confirmActionsSpaced}`}>
            <button type="button" className={notifyStyles.confirmCancel} onClick={onClose}>Cancel</button>
            <button type="submit" className={notifyStyles.confirmOk} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
