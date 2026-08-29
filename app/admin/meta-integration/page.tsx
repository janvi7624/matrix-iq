'use client';

import { useEffect, useState } from 'react';
import { MetaAssignmentMode, MetaCampaignRoute, MetaIntegrationConfigRecord } from '@/lib/types';
import AppShell from '@/components/AppShell';
import styles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import { useToast } from '@/components/ui/ToastProvider';

interface CredentialStatus {
  appId: boolean;
  appSecret: boolean;
  verifyToken: boolean;
  pageId: boolean;
  pageAccessToken: boolean;
}

interface LiteUser {
  id: string;
  username: string;
  name: string;
}

interface LiteDepartment {
  id: string;
  name: string;
}

interface ConnectionCheck {
  label: string;
  ok: boolean;
  detail: string;
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--mx-radius-full)',
        color: ok ? 'var(--mx-success)' : 'var(--mx-ink-faint)',
        background: ok ? 'var(--mx-success-subtle)' : 'var(--mx-surface-sunken)'
      }}
    >
      {label}
    </span>
  );
}

export default function MetaIntegrationPage() {
  const toast = useToast();
  const [config, setConfig] = useState<MetaIntegrationConfigRecord | null>(null);
  const [credentials, setCredentials] = useState<CredentialStatus | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; checks: ConnectionCheck[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ total: number; processed: number; skipped: number; failed: number } | null>(null);
  const [users, setUsers] = useState<LiteUser[]>([]);
  const [departments, setDepartments] = useState<LiteDepartment[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');

  // Local editable copies of the assignment fields — saved together via one
  // "Save Assignment Rules" action, same pattern as Application Settings.
  const [assignmentMode, setAssignmentMode] = useState<MetaAssignmentMode>('fixed');
  const [defaultDepartmentId, setDefaultDepartmentId] = useState('');
  const [defaultOwnerId, setDefaultOwnerId] = useState('');
  const [roundRobinPool, setRoundRobinPool] = useState<string[]>([]);
  const [campaignRows, setCampaignRows] = useState<{ campaignId: string; ownerId: string }[]>([]);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/integrations/meta/webhook`);
    fetch('/api/users/lite').then((r) => (r.ok ? r.json() : [])).then(setUsers).catch(() => setUsers([]));
    fetch('/api/departments').then((r) => (r.ok ? r.json() : [])).then(setDepartments).catch(() => setDepartments([]));
  }, []);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/admin/meta-integration');
      if (!response.ok) throw new Error(String(response.status));
      const data: { config: MetaIntegrationConfigRecord; credentials: CredentialStatus } = await response.json();
      setConfig(data.config);
      setCredentials(data.credentials);
      setAssignmentMode(data.config.assignmentMode);
      setDefaultDepartmentId(data.config.defaultDepartmentId);
      setDefaultOwnerId(data.config.defaultOwnerId);
      setRoundRobinPool(data.config.roundRobinPool);
      setCampaignRows(Object.entries(data.config.campaignRoutingMap).map(([campaignId, route]) => ({ campaignId, ownerId: (route as MetaCampaignRoute).ownerId || '' })));
      setStatus('');
    } catch {
      setStatus('Could not load Meta integration settings. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSaveAssignment() {
    setSaving(true);
    try {
      const campaignRoutingMap: Record<string, MetaCampaignRoute> = {};
      for (const row of campaignRows) {
        if (row.campaignId.trim()) campaignRoutingMap[row.campaignId.trim()] = { ownerId: row.ownerId || undefined };
      }
      const response = await fetch('/api/admin/meta-integration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentMode, defaultDepartmentId, defaultOwnerId, roundRobinPool, campaignRoutingMap })
      });
      if (!response.ok) throw new Error(String(response.status));
      const data: { config: MetaIntegrationConfigRecord } = await response.json();
      setConfig(data.config);
      toast.success('Assignment rules saved.');
    } catch {
      toast.error('Could not save assignment rules.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/admin/meta-integration/test-connection', { method: 'POST' });
      const data = await response.json();
      setTestResult(data);
      await load();
    } catch {
      toast.error('Connection test failed to run.');
    } finally {
      setTesting(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const response = await fetch('/api/admin/meta-integration/sync', { method: 'POST' });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setSyncResult(data);
      toast.success(`Sync complete — ${data.processed} imported/merged, ${data.skipped} already up to date, ${data.failed} failed.`);
      await load();
    } catch {
      toast.error('Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  function toggleRoundRobinUser(userId: string) {
    setRoundRobinPool((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  const isConnected = credentials && Object.values(credentials).every(Boolean) && config?.webhookVerified;

  return (
    <AppShell title="Meta Lead Integration" subtitle="Administration › connect Facebook &amp; Instagram Lead Ads to Lead Capture / Inquiry.">
      <div className={styles.status}>{status}</div>
      {config && credentials && (
        <>
          <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Connection Status</h2>
          <div className={calcStyles.sectionPanel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <StatusBadge ok={Boolean(isConnected)} label={isConnected ? 'Connected' : 'Not Connected'} />
              <span style={{ fontSize: 12.5, color: 'var(--mx-ink-muted)' }}>
                Credentials are read from server environment variables only — never stored in the database, never shown here.
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
              {([
                ['META_APP_ID', credentials.appId],
                ['META_APP_SECRET', credentials.appSecret],
                ['META_VERIFY_TOKEN', credentials.verifyToken],
                ['META_PAGE_ID', credentials.pageId],
                ['META_PAGE_ACCESS_TOKEN', credentials.pageAccessToken]
              ] as [string, boolean][]).map(([label, ok]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 'var(--mx-radius-sm)', background: 'var(--mx-surface-sunken)', fontSize: 12.5 }}>
                  <span style={{ fontFamily: 'monospace' }}>{label}</span>
                  <StatusBadge ok={ok} label={ok ? 'Configured' : 'Not configured'} />
                </div>
              ))}
            </div>
            <button type="button" className={calcStyles.btn} disabled={testing} onClick={handleTestConnection}>
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            {testResult && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {testResult.checks.map((c) => (
                  <div key={c.label} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: c.ok ? 'var(--mx-success)' : 'var(--mx-brand)', fontWeight: 700 }}>{c.ok ? '✓' : '✗'}</span>
                    <span><strong>{c.label}</strong> — {c.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <h2 className={calcStyles.h2}>Webhook Health</h2>
          <div className={calcStyles.sectionPanel}>
            <div className={calcStyles.field} style={{ marginBottom: 12 }}>
              <label className={calcStyles.label}>Webhook URL — paste this into Meta Developer Console → Webhooks</label>
              <input className={calcStyles.formControl} value={webhookUrl} readOnly onFocus={(e) => e.target.select()} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, fontSize: 13 }}>
              <div>
                <div style={{ color: 'var(--mx-ink-faint)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Webhook Status</div>
                <StatusBadge ok={config.webhookVerified} label={config.webhookVerified ? 'Verified' : 'Not Verified'} />
              </div>
              <div>
                <div style={{ color: 'var(--mx-ink-faint)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Last Webhook Received</div>
                {formatDateTime(config.lastWebhookReceivedAt)}
              </div>
              <div>
                <div style={{ color: 'var(--mx-ink-faint)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Last Connection Test</div>
                {config.lastConnectionTestAt ? `${config.lastConnectionTestOk ? '✓' : '✗'} ${formatDateTime(config.lastConnectionTestAt)}` : '—'}
              </div>
            </div>
          </div>

          <h2 className={calcStyles.h2}>Assignment Rules</h2>
          <div className={calcStyles.sectionPanel}>
            <div className={calcStyles.field} style={{ maxWidth: 320, marginBottom: 12 }}>
              <label className={calcStyles.label}>Assignment mode</label>
              <select className={calcStyles.formControl} value={assignmentMode} onChange={(e) => setAssignmentMode(e.target.value as MetaAssignmentMode)}>
                <option value="fixed">Fixed — all Meta leads go to one person</option>
                <option value="round_robin">Round-robin — rotate between selected Sales users</option>
                <option value="campaign">Campaign-based — route by Meta Campaign ID</option>
              </select>
            </div>

            <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 12 }}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Default department</label>
                <select className={calcStyles.formControl} value={defaultDepartmentId} onChange={(e) => setDefaultDepartmentId(e.target.value)}>
                  <option value="">— None —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Default owner {assignmentMode === 'fixed' ? '(used for every Meta lead)' : '(fallback when no other rule matches)'}</label>
                <select className={calcStyles.formControl} value={defaultOwnerId} onChange={(e) => setDefaultOwnerId(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.username} ({u.username})</option>
                  ))}
                </select>
              </div>
            </div>

            {assignmentMode === 'round_robin' && (
              <div style={{ marginBottom: 12 }}>
                <label className={calcStyles.label}>Round-robin pool — leads rotate through these people in order</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                  {users.map((u) => (
                    <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '5px 10px', borderRadius: 'var(--mx-radius-sm)', background: roundRobinPool.includes(u.id) ? 'var(--mx-brand-subtle)' : 'var(--mx-surface-sunken)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={roundRobinPool.includes(u.id)} onChange={() => toggleRoundRobinUser(u.id)} />
                      {u.name || u.username}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {assignmentMode === 'campaign' && (
              <div style={{ marginBottom: 12 }}>
                <label className={calcStyles.label}>Campaign routing — map a Meta Campaign ID to an owner</label>
                <div className={styles.status} style={{ marginBottom: 8 }}>
                  Use the numeric Campaign ID from Meta Ads Manager (visible in the lead&apos;s Meta Information panel once a lead has come through, or in Ads Manager itself) — not the campaign&apos;s display name. A campaign not listed here falls back to the default owner above.
                </div>
                {campaignRows.map((row, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input
                      className={calcStyles.formControl}
                      placeholder="Meta Campaign ID"
                      value={row.campaignId}
                      onChange={(e) => setCampaignRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, campaignId: e.target.value } : r)))}
                    />
                    <select
                      className={calcStyles.formControl}
                      value={row.ownerId}
                      onChange={(e) => setCampaignRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ownerId: e.target.value } : r)))}
                    >
                      <option value="">— Select owner —</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name || u.username}</option>
                      ))}
                    </select>
                    <button type="button" className={styles.button} onClick={() => setCampaignRows((prev) => prev.filter((_, idx) => idx !== i))}>Remove</button>
                  </div>
                ))}
                <button type="button" className={styles.button} onClick={() => setCampaignRows((prev) => [...prev, { campaignId: '', ownerId: '' }])}>
                  + Add campaign mapping
                </button>
              </div>
            )}

            <button type="button" className={calcStyles.btn} disabled={saving} onClick={handleSaveAssignment}>
              {saving ? 'Saving…' : 'Save Assignment Rules'}
            </button>
          </div>

          <h2 className={calcStyles.h2}>Sync Meta Leads</h2>
          <div className={calcStyles.sectionPanel}>
            <div className={styles.status} style={{ marginBottom: 10 }}>
              Recovery/backfill tool — re-processes any Meta lead events that failed or were never picked up (e.g. a temporary outage). Safe to run any time: already-imported leads are never duplicated.
            </div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              <strong>Last Sync:</strong> {formatDateTime(config.lastSuccessfulSyncAt)}
            </div>
            <button type="button" className={calcStyles.btn} disabled={syncing} onClick={handleSyncNow}>
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            {syncResult && (
              <div style={{ marginTop: 10, fontSize: 13 }}>
                {syncResult.total === 0 ? 'Nothing pending — everything is already up to date.' : `${syncResult.processed} imported/merged, ${syncResult.skipped} already up to date, ${syncResult.failed} failed (of ${syncResult.total} events).`}
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
