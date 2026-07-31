'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AuditLogEntry } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import { BRAND } from '@/lib/branding';
import styles from './quotationHistory.module.css';

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
  const [entityType, setEntityType] = useState<'' | 'demo' | 'delivery_challan' | 'custom_module' | 'lead'>('');

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

  return (
    <div className={styles.body}>
      <header className={styles.header}>
        <Link href="/" className={styles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />
          <div>
            <h1>Audit Log</h1>
            <div className={styles.sub}>Every status-changing action across the Back Office workflow.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={styles.button} href="/">&larr; Back to Dashboard</Link>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.toolbar}>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value as '' | 'demo' | 'delivery_challan' | 'custom_module' | 'lead')} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}>
            <option value="">All entities</option>
            <option value="demo">Demo requests</option>
            <option value="delivery_challan">Delivery Challans</option>
            <option value="custom_module">Custom Modules</option>
            <option value="lead">Leads</option>
          </select>
          <button type="button" className={styles.button} onClick={handleExportPdf}>Export PDF</button>
          <button type="button" className={styles.button} onClick={load}>Refresh</button>
        </div>
        <div className={styles.status}>{status}</div>
        {loaded && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>User</th>
                <th>Role</th>
                <th>Entity</th>
                <th>Action</th>
                <th>Previous → New</th>
                <th>Remarks</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className={styles.empty}>No audit log entries yet.</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.at)}</td>
                    <td>{r.by}</td>
                    <td>{r.role}</td>
                    <td>{r.entity_type} {r.entity_id}</td>
                    <td>{r.action}</td>
                    <td>{r.previous_status || '-'} → {r.new_status || '-'}</td>
                    <td>{r.remarks || '-'}</td>
                    <td>{r.ip || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
