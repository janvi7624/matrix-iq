'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BackOfficeRemarkTag, DcLineItem, DcStatus, DeliveryChallanRecord, DemoScheduleRecord, ProjectRecord, PublicAppConfig, UserRole } from '@/lib/types';
import { BACK_OFFICE_REMARK_LABEL, BACK_OFFICE_REMARK_TAGS } from '@/lib/backOfficeRemarks';
import { generateDeliveryChallanPdf } from '@/lib/deliveryChallanPdf';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import Button from './ui/Button';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import { todayDateInputValue } from '@/lib/dateHelpers';

const DC_STATUS_LABEL: Record<DcStatus, string> = { prepared: 'Prepared', dispatched: 'Dispatched', returned: 'Returned', closed: 'Closed' };
const DC_STATUS_TONE: Record<DcStatus, StatusTone> = {
  prepared: 'pending',
  dispatched: 'confirmed',
  returned: 'done',
  closed: 'cancelled'
};

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function GenerateDcPanel({ demo, onGenerated }: { demo: DemoScheduleRecord; onGenerated: (dc: DeliveryChallanRecord) => void }) {
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function handleGenerate() {
    setBusy(true);
    try {
      const response = await fetch('/api/delivery-challans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoId: demo.id, expectedReturnDate })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      onGenerated(await response.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not generate the Delivery Challan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={historyStyles.detailPanel} style={{ marginTop: 0 }}>
      <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Generate Delivery Challan</h2>
      <div className={calcStyles.small} style={{ marginBottom: 12 }}>
        For {demo.client_name}{demo.company ? ` (${demo.company})` : ''} — demo on {new Date(demo.scheduled_at).toLocaleString('en-IN')}
      </div>
      <div className={historyStyles.reviewGrid} style={{ marginBottom: 12 }}>
        {demo.products_required.length === 0 ? (
          <div className={historyStyles.reviewRow}>No products were listed as required on this request.</div>
        ) : (
          demo.products_required.map((p) => (
            <div key={p.product} className={historyStyles.reviewRow}><strong>{p.product}</strong> ×{p.quantity}</div>
          ))
        )}
      </div>
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Expected return date</label>
        <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} />
      </div>
      <Button variant="primary" icon="📦" loading={busy} loadingLabel="Generating…" onClick={handleGenerate}>Create Delivery Challan</Button>
    </div>
  );
}

const EMPTY_MANUAL_ITEM = { product: '', serialNumber: '', quantity: 1, price: 0 };

// No demo, no approval chain — a walk-in / custom dispatch. Client details
// are free text unless a Project is optionally picked to prefill from.
function ManualDcPanel({ projects, onGenerated, onCancel }: { projects: ProjectRecord[]; onGenerated: (dc: DeliveryChallanRecord) => void; onCancel: () => void }) {
  const [projectId, setProjectId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [assignedEngineer, setAssignedEngineer] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [items, setItems] = useState<DcLineItem[]>([{ ...EMPTY_MANUAL_ITEM }]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function pickProject(id: string) {
    setProjectId(id);
    const project = projects.find((p) => p.id === id);
    if (project) {
      setClientName(project.client_name || project.company || clientName);
      setClientAddress(project.address || clientAddress);
      setClientPhone(project.phone || clientPhone);
    }
  }

  function updateItem(idx: number, patch: Partial<DcLineItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleGenerate() {
    if (!clientName.trim()) {
      toast.error('Client name is required.');
      return;
    }
    const validItems = items.filter((i) => i.product.trim());
    if (!validItems.length) {
      toast.error('At least one item is required.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/delivery-challans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectId || undefined,
          clientName,
          clientAddress,
          clientPhone,
          assignedEngineer,
          expectedReturnDate,
          items: validItems
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      onGenerated(await response.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the Delivery Challan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={historyStyles.detailPanel} style={{ marginTop: 0 }}>
      <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Create Manual Delivery Challan</h2>
      <div className={calcStyles.small} style={{ marginBottom: 12 }}>
        No linked Sales Request — for a walk-in or custom dispatch that never went through demo approval.
      </div>
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Link to a project (optional — prefills client details)</label>
        <select className={calcStyles.formControl} value={projectId} onChange={(e) => pickProject(e.target.value)}>
          <option value="">— None —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.client_name}{p.company ? ` (${p.company})` : ''}</option>
          ))}
        </select>
      </div>
      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Client name *</label>
          <input className={calcStyles.formControl} value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Client phone</label>
          <input className={calcStyles.formControl} value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
        </div>
      </div>
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Client address</label>
        <input className={calcStyles.formControl} value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
      </div>
      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Requested By</label>
          <input className={calcStyles.formControl} value={assignedEngineer} onChange={(e) => setAssignedEngineer(e.target.value)} />
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Expected return date</label>
          <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} />
        </div>
      </div>

      <div className={calcStyles.label} style={{ marginBottom: 8, marginTop: 12 }}>Items</div>
      <div className={historyStyles.tableWrap}>
      <table className={historyStyles.table}>
        <thead>
          <tr>
            <th>Product</th>
            <th>Serial Number</th>
            <th>Quantity</th>
            <th>Price</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td><input className={calcStyles.formControl} value={item.product} onChange={(e) => updateItem(idx, { product: e.target.value })} /></td>
              <td><input className={calcStyles.formControl} value={item.serialNumber} onChange={(e) => updateItem(idx, { serialNumber: e.target.value })} /></td>
              <td><input type="number" min={1} className={calcStyles.formControl} value={item.quantity} onChange={(e) => updateItem(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></td>
              <td><input type="number" min={0} step="0.01" className={calcStyles.formControl} value={item.price || ''} placeholder="0" onChange={(e) => updateItem(idx, { price: Number(e.target.value) || 0 })} /></td>
              <td>
                <Button
                  variant="ghost"
                  compact
                  disabled={items.length === 1}
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div style={{ marginTop: 8 }}>
        <Button variant="secondary" compact onClick={() => setItems((prev) => [...prev, { ...EMPTY_MANUAL_ITEM }])}>+ Add Item</Button>
      </div>

      <div className={historyStyles.actionGroupButtons} style={{ marginTop: 16 }}>
        <Button variant="primary" icon="📦" loading={busy} loadingLabel="Creating…" onClick={handleGenerate}>Create Delivery Challan</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function DcDetail({ dc, canManage, onUpdated, onDelete }: { dc: DeliveryChallanRecord; canManage: boolean; onUpdated: (dc: DeliveryChallanRecord) => void; onDelete: (id: string) => Promise<void> }) {
  const [items, setItems] = useState<DcLineItem[]>(dc.items);
  const [assignedEngineer, setAssignedEngineer] = useState(dc.assigned_engineer);
  const [expectedReturnDate, setExpectedReturnDate] = useState(dc.expected_return_date);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [returned, setReturned] = useState(dc.material_return.returned);
  const [condition, setCondition] = useState(dc.material_return.condition);
  const [missing, setMissing] = useState(dc.material_return.missing);
  const [damaged, setDamaged] = useState(dc.material_return.damaged);
  const [accessories, setAccessories] = useState(dc.material_return.accessories);
  const [serialNumberVerified, setSerialNumberVerified] = useState(dc.material_return.serialNumberVerified);
  const [remarkTags, setRemarkTags] = useState<BackOfficeRemarkTag[]>(dc.material_return.remarkTags);
  const [remarks, setRemarks] = useState(dc.material_return.remarks);
  const [publicConfig, setPublicConfig] = useState<PublicAppConfig | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    fetch('/api/config/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PublicAppConfig | null) => setPublicConfig(data))
      .catch(() => setPublicConfig(null));
  }, []);

  async function patch(action: string, extra: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(`/api/delivery-challans/${dc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      onUpdated(await response.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this change.');
    } finally {
      setBusy(false);
    }
  }

  function toggleRemarkTag(tag: BackOfficeRemarkTag) {
    setRemarkTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function handleExportPdf() {
    generateDeliveryChallanPdf(dc, {
      companyOverride: publicConfig
        ? { legalName: publicConfig.companyLegalName, addressLines: [publicConfig.addressLine1, publicConfig.addressLine2, publicConfig.addressLine3].filter(Boolean), contactPhone: publicConfig.contactPhone }
        : undefined
    });
  }

  async function handleDeleteClick() {
    setDeleting(true);
    try {
      await onDelete(dc.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDispatchClick() {
    if (!(await confirm({ message: `Dispatch materials for ${dc.dc_number}? Serial numbers can no longer be edited after dispatch.`, danger: true }))) return;
    patch('dispatch', {});
  }

  async function handleCloseClick() {
    if (!(await confirm({ message: `Close ${dc.dc_number}? This finalizes the Delivery Challan.`, danger: true }))) return;
    patch('close', {});
  }

  return (
    <div className={historyStyles.detailPanel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 className={calcStyles.h2} style={{ margin: 0 }}>{dc.dc_number}</h2>
          <div className={calcStyles.small}>
            {dc.client_name} · Issued by {dc.issued_by} on {formatDate(dc.issued_date)}
            {dc.project_id && (
              <>
                {' · '}
                <Link href={`/projects/${dc.project_id}`}>Project {dc.project_id}</Link>
              </>
            )}
          </div>
        </div>
        <StatusBadge tone={DC_STATUS_TONE[dc.status]} label={DC_STATUS_LABEL[dc.status]} />
      </div>

      <div className={historyStyles.actionBar} style={{ margin: '12px 0' }}>
        <div className={historyStyles.actionGroup}>
          <div className={historyStyles.actionGroupLabel}>Secondary Actions</div>
          <div className={historyStyles.actionGroupButtons}>
            <Button variant="secondary" icon="⬇️" onClick={handleExportPdf}>Download PDF</Button>
            <Button variant="secondary" icon="🖨️" onClick={() => window.print()}>Print DC</Button>
          </div>
        </div>
        {canManage && dc.status === 'prepared' && (
          <div className={historyStyles.actionGroup}>
            <div className={historyStyles.actionGroupLabel}>Danger Zone</div>
            <div className={historyStyles.actionGroupButtons}>
              <Button variant="danger" icon="🗑️" loading={deleting} loadingLabel="Deleting…" onClick={handleDeleteClick}>Delete DC</Button>
            </div>
          </div>
        )}
      </div>

      <h3 style={{ marginTop: 0 }}>Materials</h3>
      <div className={historyStyles.tableWrap}>
      <table className={historyStyles.table}>
        <thead>
          <tr>
            <th>Product</th>
            <th>Serial Number</th>
            <th>Quantity</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td>{item.product}</td>
              <td>
                {canManage && dc.status === 'prepared' ? (
                  <input
                    className={calcStyles.formControl}
                    value={item.serialNumber}
                    onChange={(e) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, serialNumber: e.target.value } : it)))}
                  />
                ) : (
                  item.serialNumber || '-'
                )}
              </td>
              <td>{item.quantity}</td>
              <td>
                {canManage && dc.status === 'prepared' ? (
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={calcStyles.formControl}
                    value={item.price || ''}
                    placeholder="0"
                    onChange={(e) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, price: Number(e.target.value) || 0 } : it)))}
                  />
                ) : (
                  item.price ? item.price.toLocaleString('en-IN') : '-'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {canManage && dc.status === 'prepared' && (
        <>
          <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginTop: 12 }}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Requested By</label>
              <input className={calcStyles.formControl} value={assignedEngineer} onChange={(e) => setAssignedEngineer(e.target.value)} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Expected return date</label>
              <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} />
            </div>
          </div>
          <div className={historyStyles.actionGroup}>
            <div className={historyStyles.actionGroupLabel}>Primary Actions</div>
            <div className={historyStyles.actionGroupButtons}>
              <Button variant="secondary" icon="💾" loading={busy} loadingLabel="Saving…" onClick={() => patch('updateItems', { items, assignedEngineer, expectedReturnDate })}>Save Serial Numbers</Button>
              <Button variant="primary" icon="🚚" loading={busy} loadingLabel="Dispatching…" onClick={handleDispatchClick}>Dispatch Material</Button>
            </div>
          </div>
        </>
      )}

      {canManage && dc.status === 'dispatched' && (
        <div style={{ marginTop: 16 }}>
          <h3>Material return — verification checklist</h3>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" checked={returned} onChange={(e) => setReturned(e.target.checked)} />
            Materials returned
          </label>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Condition</label>
              <select className={calcStyles.formControl} value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)}>
                <option value="">-- Select --</option>
                <option value="good">Good</option>
                <option value="minor_damage">Minor damage</option>
                <option value="major_damage">Major damage</option>
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Flags</label>
              <div style={{ display: 'flex', gap: 14 }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} /> Missing
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} /> Damaged
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={serialNumberVerified} onChange={(e) => setSerialNumberVerified(e.target.checked)} /> Serial verified
                </label>
              </div>
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Accessories returned</label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {(['powerCable', 'remote', 'adapter', 'stand', 'packing'] as const).map((key) => (
                <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={accessories[key]}
                    onChange={(e) => setAccessories((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  {key === 'powerCable' ? 'Power Cable' : key.charAt(0).toUpperCase() + key.slice(1)}
                </label>
              ))}
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Remarks</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {BACK_OFFICE_REMARK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={remarkTags.includes(tag) ? historyStyles.modeToggleBtnActive : historyStyles.modeToggleBtn}
                  style={{ borderRadius: 999, padding: '6px 12px', border: '1px solid #d1d5db' }}
                  onClick={() => toggleRemarkTag(tag)}
                >
                  {BACK_OFFICE_REMARK_LABEL[tag]}
                </button>
              ))}
            </div>
            <textarea className={calcStyles.formControl} rows={2} placeholder="Additional detail…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          <div className={historyStyles.actionGroup}>
            <div className={historyStyles.actionGroupLabel}>Primary Actions</div>
            <div className={historyStyles.actionGroupButtons}>
              <Button
                variant="success"
                icon="✅"
                loading={busy}
                loadingLabel="Saving…"
                onClick={() => patch('verifyReturn', { returned, condition, missing, damaged, accessories, serialNumberVerified, remarkTags, remarks })}
              >
                Verify &amp; Receive Material
              </Button>
            </div>
          </div>
        </div>
      )}

      {dc.status === 'returned' && (
        <div style={{ marginTop: 16 }}>
          <h3>Return verification</h3>
          <div className={historyStyles.reviewGrid}>
            <div className={historyStyles.reviewRow}><strong>Condition:</strong> {dc.material_return.condition || '-'}</div>
            <div className={historyStyles.reviewRow}><strong>Missing:</strong> {dc.material_return.missing ? 'Yes' : 'No'}</div>
            <div className={historyStyles.reviewRow}><strong>Damaged:</strong> {dc.material_return.damaged ? 'Yes' : 'No'}</div>
            <div className={historyStyles.reviewRow}><strong>Serial verified:</strong> {dc.material_return.serialNumberVerified ? 'Yes' : 'No'}</div>
            <div className={historyStyles.reviewRow}><strong>Remarks:</strong> {dc.material_return.remarkTags.map((t) => BACK_OFFICE_REMARK_LABEL[t]).join(', ') || '-'}{dc.material_return.remarks ? ` — ${dc.material_return.remarks}` : ''}</div>
          </div>
          {canManage && (
            <div className={historyStyles.actionGroup} style={{ marginTop: 10 }}>
              <div className={historyStyles.actionGroupLabel}>Primary Actions</div>
              <div className={historyStyles.actionGroupButtons}>
                <Button variant="success" icon="🔒" loading={busy} loadingLabel="Closing…" onClick={handleCloseClick}>Close DC</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BackOfficeContent({ currentUser }: { currentUser: { username: string; role: UserRole } }) {
  const searchParams = useSearchParams();
  const demoIdParam = searchParams.get('demoId') || '';
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const canManage = currentUser.role === 'backoffice' || isPrivileged;

  const [dcs, setDcs] = useState<DeliveryChallanRecord[]>([]);
  const [demos, setDemos] = useState<DemoScheduleRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showManualDc, setShowManualDc] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    setStatus('Loading...');
    try {
      const [dcRes, demoRes] = await Promise.all([fetch('/api/delivery-challans'), fetch('/api/demo-schedule')]);
      if (!dcRes.ok) throw new Error(String(dcRes.status));
      const dcData: DeliveryChallanRecord[] = await dcRes.json();
      setDcs(dcData);
      setDemos(demoRes.ok ? await demoRes.json() : []);
      setStatus(dcData.length ? `${dcData.length} Delivery Challan${dcData.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the Back Office API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).then(setProjects).catch(() => setProjects([]));
  }, []);

  const demoForGenerate = useMemo(() => {
    if (!demoIdParam) return null;
    const existingDc = dcs.find((d) => d.demo_id === demoIdParam);
    if (existingDc) return null;
    const demo = demos.find((d) => d.id === demoIdParam);
    return demo && demo.status === 'pending_backoffice' ? demo : null;
  }, [demoIdParam, demos, dcs]);

  const linkedDc = useMemo(() => (demoIdParam ? dcs.find((d) => d.demo_id === demoIdParam) : null), [demoIdParam, dcs]);

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this Delivery Challan? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/delivery-challans/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setDcs((prev) => prev.filter((d) => d.id !== id));
    } catch {
      toast.error('Could not delete this Delivery Challan.');
    }
  }

  function handleUpdated(updated: DeliveryChallanRecord) {
    setDcs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }

  return (
    <AppShell title="Back Office Operations" subtitle="Delivery Challans — materials out, dispatched, returned, and closed.">
        {demoForGenerate && <GenerateDcPanel demo={demoForGenerate} onGenerated={(dc) => { setDcs((prev) => [dc, ...prev]); }} />}
        {linkedDc && (
          <DcDetail dc={linkedDc} canManage={canManage} onUpdated={handleUpdated} onDelete={handleDelete} />
        )}
        {canManage && showManualDc && (
          <ManualDcPanel
            projects={projects}
            onCancel={() => setShowManualDc(false)}
            onGenerated={(dc) => { setDcs((prev) => [dc, ...prev]); setShowManualDc(false); toast.success(`${dc.dc_number} created.`); }}
          />
        )}

        <h2 className={calcStyles.h2} style={{ marginTop: demoForGenerate || linkedDc || showManualDc ? 24 : 0 }}>All Delivery Challans</h2>
        <div className={historyStyles.toolbar}>
          {canManage && !showManualDc && <Button variant="primary" icon="➕" compact onClick={() => setShowManualDc(true)}>Create Manual DC</Button>}
          <button type="button" className={historyStyles.button} onClick={load}>Refresh</button>
        </div>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>DC Number</th>
                <th>Project</th>
                <th>Client</th>
                <th>Requested By</th>
                <th>Status</th>
                <th>Issued Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dcs.length === 0 ? (
                <tr>
                  <td colSpan={7} className={historyStyles.empty}>No Delivery Challans yet — generate one from an approved demo request.</td>
                </tr>
              ) : (
                dcs.map((dc) => (
                  <tr key={dc.id}>
                    <td className={historyStyles.num}>{dc.dc_number}</td>
                    <td>{dc.project_id ? <Link href={`/projects/${dc.project_id}`}>{dc.project_id}</Link> : '-'}</td>
                    <td>{dc.client_name}</td>
                    <td>{dc.assigned_engineer || '-'}</td>
                    <td><StatusBadge tone={DC_STATUS_TONE[dc.status]} label={DC_STATUS_LABEL[dc.status]} /></td>
                    <td>{formatDate(dc.issued_date)}</td>
                    <td>
                      <button type="button" className={historyStyles.button} onClick={() => setOpenId(openId === dc.id ? null : dc.id)}>
                        {openId === dc.id ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        )}
        {openId && !linkedDc && (
          (() => {
            const dc = dcs.find((d) => d.id === openId);
            return dc ? <DcDetail dc={dc} canManage={canManage} onUpdated={handleUpdated} onDelete={handleDelete} /> : null;
          })()
        )}
    </AppShell>
  );
}

export default function BackOfficeView({ currentUser }: { currentUser: { username: string; role: UserRole } }) {
  return (
    <Suspense fallback={<AppShell title="Back Office Operations" subtitle="Delivery Challans — prepare, dispatch, verify returns, close.">{null}</AppShell>}>
      <BackOfficeContent currentUser={currentUser} />
    </Suspense>
  );
}
