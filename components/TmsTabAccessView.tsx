'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ModuleConfigRecord, ModulePermissionAction, RoleRecord, UserRole } from '@/lib/types';
import { TMS_ROLE_LABEL } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import { useToast } from './ui/ToastProvider';

const PERMISSION_ACTIONS: { key: ModulePermissionAction; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
  { key: 'approve', label: 'Approve' },
  { key: 'manage', label: 'Manage' }
];

interface TmsTabAccessViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsTabAccessView({ currentUser }: TmsTabAccessViewProps) {
  void currentUser;
  const toast = useToast();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [modules, setModules] = useState<ModuleConfigRecord[]>([]);
  const [status, setStatus] = useState('Loading...');

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/tms/tab-access');
      if (!response.ok) throw new Error(String(response.status));
      const body: { roles: RoleRecord[]; modules: ModuleConfigRecord[] } = await response.json();
      setRoles(body.roles);
      setModules([...body.modules].sort((a, b) => a.order - b.order));
      setStatus('');
    } catch {
      setStatus('Could not load Tab Access. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sortedRoles = useMemo(() => [...roles].sort((a, b) => a.order - b.order), [roles]);

  async function toggleAction(role: RoleRecord, moduleKey: string, action: ModulePermissionAction) {
    const currentSet = role.permissions.modules[moduleKey] || {};
    const nextPermissions = { ...currentSet, [action]: !currentSet[action] };
    try {
      const response = await fetch('/api/tms/tab-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId: role.id, moduleKey, permissions: nextPermissions })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this change.');
    }
  }

  return (
    <AppShell title="TMS Tab Access" subtitle="Configure which TMS roles can view, create, edit, delete, approve, or manage each tab.">
      <div className={historyStyles.status}>{status}</div>

      <div className={historyStyles.permTableScroll}>
        <table className={historyStyles.permTable}>
          <thead>
            <tr>
              <th>Role \ Tab</th>
              {modules.map((m) => (
                <th key={m.key}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRoles.map((role) => (
              <Fragment key={role.id}>
                <tr>
                  <td className={`${historyStyles.permModuleCell} ${historyStyles.permGroupRow}`} colSpan={modules.length + 1}>
                    <strong>{TMS_ROLE_LABEL[role.key] || role.label}</strong>
                  </td>
                </tr>
                {PERMISSION_ACTIONS.map((action) => (
                  <tr key={`${role.id}-${action.key}`}>
                    <td className={historyStyles.permModuleCell}>{action.label}</td>
                    {modules.map((m) => {
                      const set = role.permissions.modules[m.key] || {};
                      return (
                        <td key={m.key}>
                          <label className={historyStyles.permCheckboxLabel}>
                            <input type="checkbox" checked={!!set[action.key]} onChange={() => toggleAction(role, m.key, action.key)} />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
