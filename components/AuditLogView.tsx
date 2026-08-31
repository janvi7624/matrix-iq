'use client';

import { useEffect, useState } from 'react';
import { AuditLogEntry } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import styles from './quotationHistory.module.css';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

export default function AuditLogView() {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loaded, setLoaded] = useState(false);
  const [entityType, setEntityType] = useState<'' | AuditLogEntry['entity_type']>('');

  async function load() {
    setStatus('Loading...');
    try {
      const qs = entityType ? `?entityType=${entityType}` : '';
      const response = await fetch(`/api/admin/audit-log${qs}`);
      if (!response.ok) throw new Error(String(response.status));
      const data: AuditLogEntry[] = await response.json();
      setRows(data);
      setStatus(data.length ? `${data.length} entr${data.length === 1 ? 'y' : 'ies'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the audit log API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  function handleExportPdf() {
    exportListToPdf(
      'Audit Log',
      ['Date/Time', 'User', 'Role', 'Entity', 'Action', 'Previous Status', 'New Status', 'Remarks', 'IP'],
      rows.map((r) => [formatDateTime(r.at), r.by, r.role, `${r.entity_type} ${r.entity_id}`, r.action, r.previous_status, r.new_status, r.remarks, r.ip]),
      `audit-log-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  const columns: TableColumn<AuditLogEntry>[] = [
    { key: 'at', header: 'Date/Time', render: (r) => formatDateTime(r.at) },
    { key: 'by', header: 'User', render: (r) => r.by },
    { key: 'role', header: 'Role', render: (r) => r.role },
    { key: 'entity', header: 'Entity', render: (r) => `${r.entity_type} ${r.entity_id}` },
    { key: 'action', header: 'Action', render: (r) => r.action },
    { key: 'statusChange', header: 'Previous → New', render: (r) => `${r.previous_status || '-'} → ${r.new_status || '-'}` },
    { key: 'remarks', header: 'Remarks', render: (r) => r.remarks || '-' },
    { key: 'ip', header: 'IP', render: (r) => r.ip || '-' }
  ];

  return (
    <AppShell title="Audit Log" subtitle="Every status-changing action across the Back Office workflow.">
        <FilterBar>
          <select className={styles.plainSelect} value={entityType} onChange={(e) => setEntityType(e.target.value as '' | AuditLogEntry['entity_type'])}>
            <option value="">All entities</option>
            <option value="demo">Demo requests</option>
            <option value="delivery_challan">Delivery Challans</option>
            <option value="custom_module">Custom Modules</option>
            <option value="lead">Leads</option>
            <option value="quotation">Quotations</option>
            <option value="marketing_request">Marketing Requests</option>
            <option value="project">Projects</option>
            <option value="department">Departments</option>
            <option value="user_import">User Imports</option>
          </select>
          <ToolbarButton onClick={handleExportPdf}>Export PDF</ToolbarButton>
          <ToolbarButton onClick={load}>Refresh</ToolbarButton>
        </FilterBar>
        <div className={styles.status}>{status}</div>
        {loaded && (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={<div className={styles.empty}>No audit log entries yet.</div>}
          />
        )}
    </AppShell>
  );
}
