'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BackOfficeRemarkTag, DcLineItem, DcStatus, DeliveryChallanRecord, DemoScheduleRecord, ProjectRecord, PublicAppConfig, UserRole } from '@/lib/types';
import { CheckCircle2, Download, Lock, Package, Plus, Printer, Save, Trash2, Truck } from 'lucide-react';
import PhoneInput from '@/components/ui/PhoneInput';
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
import styles from './backOffice.module.css';
import FilterBar from './ui/FilterBar';
import Table, { TableColumn } from './ui/Table';

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
    <div className={`${historyStyles.detailPanel} ${historyStyles.detailPanelFlush}`}>
      <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Generate Delivery Challan</h2>
      <div className={`${calcStyles.small} ${calcStyles.smallSpaced}`}>
        For {demo.client_name}{demo.company ? ` (${demo.company})` : ''} — demo on {new Date(demo.scheduled_at).toLocaleString('en-IN')}
      </div>
      <div className={`${historyStyles.reviewGrid} ${historyStyles.reviewGridSpaced}`}>
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
      <Button variant="primary" icon={<Package size={16} />} loading={busy} loadingLabel="Generating…" onClick={handleGenerate}>Create Delivery Challan</Button>
    </div>
  );
}

const EMPTY_MANUAL_ITEM = { product: '', hsnCode: '', serialNumber: '', quantity: 1, price: 0 };

// No demo, no approval chain — a walk-in / custom dispatch. Client details
// are free text unless a Project is optionally picked to prefill from.
function ManualDcPanel({ projects, onGenerated, onCancel }: { projects: ProjectRecord[]; onGenerated: (dc: DeliveryChallanRecord) => void; onCancel: () => void }) {
  const [projectId, setProjectId] = useState('');
  const [customProjectName, setCustomProjectName] = useState('');
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
    if (id) setCustomProjectName('');
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
          customProjectName: !projectId ? customProjectName : undefined,
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
    <div className={`${historyStyles.detailPanel} ${historyStyles.detailPanelFlush}`}>
      <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Create Manual Delivery Challan</h2>
      <div className={`${calcStyles.small} ${calcStyles.smallSpaced}`}>
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
      {!projectId && (
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Or type a project name manually (if it isn&apos;t listed above)</label>
          <input className={calcStyles.formControl} value={customProjectName} onChange={(e) => setCustomProjectName(e.target.value)} placeholder="e.g. a project not yet in the system" />
        </div>
      )}
      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Client name *</label>
          <input className={calcStyles.formControl} value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Client phone</label>
          <PhoneInput value={clientPhone} onChange={setClientPhone} />
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

      <div className={`${calcStyles.label} ${styles.itemsHeading}`}>Items</div>
      <div className={historyStyles.tableWrap}>
      <table className={historyStyles.table}>
        <thead>
          <tr>
            <th>Product</th>
            <th>HSN Code (optional)</th>
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
              <td><input className={calcStyles.formControl} value={item.hsnCode} onChange={(e) => updateItem(idx, { hsnCode: e.target.value })} /></td>
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
      <div className={styles.addItemRow}>
        <Button variant="secondary" compact onClick={() => setItems((prev) => [...prev, { ...EMPTY_MANUAL_ITEM }])}>+ Add Item</Button>
      </div>

      <div className={`${historyStyles.actionGroupButtons} ${styles.sectionSpacingTop16}`}>
        <Button variant="primary" icon={<Package size={16} />} loading={busy} loadingLabel="Creating…" onClick={handleGenerate}>Create Delivery Challan</Button>
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

  function dcCompanyOverride() {
    return publicConfig
      ? {
          legalName: publicConfig.companyLegalName,
          addressLines: [publicConfig.addressLine1, publicConfig.addressLine2, publicConfig.addressLine3].filter(Boolean),
          contactPhone: publicConfig.contactPhone,
          gstNumber: publicConfig.gstNumber
        }
      : undefined;
  }

  function handleExportPdf() {
    generateDeliveryChallanPdf(dc, { companyOverride: dcCompanyOverride() });
  }

  function handlePrintPdf() {
    generateDeliveryChallanPdf(dc, { companyOverride: dcCompanyOverride(), mode: 'print' });
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
      <div className={styles.detailHeaderRow}>
        <div>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2Reset}`}>{dc.dc_number}</h2>
          <div className={calcStyles.small}>
            {dc.client_name} · Issued by {dc.issued_by} on {formatDate(dc.issued_date)}
            {dc.project_id ? (
              <>
                {' · '}
                <Link href={`/projects/${dc.project_id}`}>Project {dc.project_id}</Link>
              </>
            ) : (
              dc.custom_project_name && <>{' · '}Project: {dc.custom_project_name}</>
            )}
          </div>
        </div>
        <StatusBadge tone={DC_STATUS_TONE[dc.status]} label={DC_STATUS_LABEL[dc.status]} />
      </div>

      <div className={`${historyStyles.actionBar} ${historyStyles.actionBarTight}`}>
        <div className={historyStyles.actionGroup}>
          <div className={historyStyles.actionGroupLabel}>Secondary Actions</div>
          <div className={historyStyles.actionGroupButtons}>
            <Button variant="secondary" icon={<Download size={16} />} onClick={handleExportPdf}>Download PDF</Button>
            <Button variant="secondary" icon={<Printer size={16} />} onClick={handlePrintPdf}>Print DC</Button>
          </div>
        </div>
        {canManage && dc.status === 'prepared' && (
          <div className={historyStyles.actionGroup}>
            <div className={historyStyles.actionGroupLabel}>Danger Zone</div>
            <div className={historyStyles.actionGroupButtons}>
              <Button variant="danger" icon={<Trash2 size={16} />} loading={deleting} loadingLabel="Deleting…" onClick={handleDeleteClick}>Delete DC</Button>
            </div>
          </div>
        )}
      </div>

      <h3 className={historyStyles.h3Flush}>Materials</h3>
      <div className={historyStyles.tableWrap}>
      <table className={historyStyles.table}>
        <thead>
          <tr>
            <th>Product</th>
            <th>HSN Code</th>
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
                    value={item.hsnCode}
                    onChange={(e) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, hsnCode: e.target.value } : it)))}
                  />
                ) : (
                  item.hsnCode || '-'
                )}
              </td>
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
          <div className={`${calcStyles.row} ${calcStyles.columns} ${styles.formRowSpacingTop}`}>
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
              <Button variant="secondary" icon={<Save size={16} />} loading={busy} loadingLabel="Saving…" onClick={() => patch('updateItems', { items, assignedEngineer, expectedReturnDate })}>Save Serial Numbers</Button>
              <Button variant="primary" icon={<Truck size={16} />} loading={busy} loadingLabel="Dispatching…" onClick={handleDispatchClick}>Dispatch Material</Button>
            </div>
          </div>
        </>
      )}

      {canManage && dc.status === 'dispatched' && (
        <div className={styles.sectionSpacingTop16}>
          <h3>Material return — verification checklist</h3>
          <label className={`${styles.materialsReturnedCheckbox}`}>
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
              <div className={styles.flagsRow}>
                <label className={historyStyles.inlineCheckboxRow}>
                  <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} /> Missing
                </label>
                <label className={historyStyles.inlineCheckboxRow}>
                  <input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} /> Damaged
                </label>
                <label className={historyStyles.inlineCheckboxRow}>
                  <input type="checkbox" checked={serialNumberVerified} onChange={(e) => setSerialNumberVerified(e.target.checked)} /> Serial verified
                </label>
              </div>
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Accessories returned</label>
            <div className={styles.accessoriesRow}>
              {(['powerCable', 'remote', 'adapter', 'stand', 'packing'] as const).map((key) => (
                <label key={key} className={historyStyles.inlineCheckboxRow}>
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
            <div className={styles.remarkTagsRow}>
              {BACK_OFFICE_REMARK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`${remarkTags.includes(tag) ? historyStyles.modeToggleBtnActive : historyStyles.modeToggleBtn} ${historyStyles.pillButton}`}
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
                icon={<CheckCircle2 size={16} />}
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
        <div className={styles.sectionSpacingTop16}>
          <h3>Return verification</h3>
          <div className={historyStyles.reviewGrid}>
            <div className={historyStyles.reviewRow}><strong>Condition:</strong> {dc.material_return.condition || '-'}</div>
            <div className={historyStyles.reviewRow}><strong>Missing:</strong> {dc.material_return.missing ? 'Yes' : 'No'}</div>
            <div className={historyStyles.reviewRow}><strong>Damaged:</strong> {dc.material_return.damaged ? 'Yes' : 'No'}</div>
            <div className={historyStyles.reviewRow}><strong>Serial verified:</strong> {dc.material_return.serialNumberVerified ? 'Yes' : 'No'}</div>
            <div className={historyStyles.reviewRow}><strong>Remarks:</strong> {dc.material_return.remarkTags.map((t) => BACK_OFFICE_REMARK_LABEL[t]).join(', ') || '-'}{dc.material_return.remarks ? ` — ${dc.material_return.remarks}` : ''}</div>
          </div>
          {canManage && (
            <div className={`${historyStyles.actionGroup} ${styles.sectionSpacingTop10}`}>
              <div className={historyStyles.actionGroupLabel}>Primary Actions</div>
              <div className={historyStyles.actionGroupButtons}>
                <Button variant="success" icon={<Lock size={16} />} loading={busy} loadingLabel="Closing…" onClick={handleCloseClick}>Close DC</Button>
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
  // DC management is strictly Back Office (or Admin/Super Admin as the org's
  // ultimate override) — Manager is deliberately excluded, unlike the app's
  // usual isPrivileged convention. Matches the server-side gates in
  // app/api/delivery-challans/route.ts and [id]/route.ts.
  const canManage = currentUser.role === 'backoffice' || currentUser.role === 'admin' || currentUser.role === 'superadmin';

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

  // The "Demo(s) awaiting a Delivery Challan" attention item on the
  // Dashboard just links to plain /backoffice with no demoId — landing here
  // showed nothing actionable. This lists every such demo so that link (and
  // this page on its own) is actually useful, not just a dead end; the
  // per-demo "Generate DC ->" link on Demo Schedule stays the direct path.
  const demosAwaitingDc = useMemo(() => demos.filter((d) => d.status === 'pending_backoffice'), [demos]);

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

  const dcColumns: TableColumn<DeliveryChallanRecord>[] = [
    { key: 'dcNumber', header: 'DC Number', cellClassName: historyStyles.num, render: (dc) => dc.dc_number },
    { key: 'project', header: 'Project', render: (dc) => (dc.project_id ? <Link href={`/projects/${dc.project_id}`}>{dc.project_id}</Link> : '-') },
    { key: 'client', header: 'Client', render: (dc) => dc.client_name },
    { key: 'requestedBy', header: 'Requested By', render: (dc) => dc.assigned_engineer || '-' },
    { key: 'status', header: 'Status', render: (dc) => <StatusBadge tone={DC_STATUS_TONE[dc.status]} label={DC_STATUS_LABEL[dc.status]} /> },
    { key: 'issuedDate', header: 'Issued Date', render: (dc) => formatDate(dc.issued_date) },
    {
      key: 'actions',
      header: '',
      render: (dc) => (
        <button type="button" className={historyStyles.button} onClick={() => setOpenId(openId === dc.id ? null : dc.id)}>
          {openId === dc.id ? 'Hide' : 'View'}
        </button>
      )
    }
  ];

  return (
    <AppShell title="Back Office Operations" subtitle="Delivery Challans — materials out, dispatched, returned, and closed.">
        {!demoForGenerate && !linkedDc && demosAwaitingDc.length > 0 && (
          <div className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpacedLg}`}>
            <div className={calcStyles.h2}>Demo{demosAwaitingDc.length === 1 ? '' : 's'} awaiting a Delivery Challan</div>
            <ul className={styles.awaitingList}>
              {demosAwaitingDc.map((demo) => (
                <li key={demo.id} className={styles.awaitingListItem}>
                  <span>{demo.client_name}</span>
                  <Link className={`${historyStyles.actionBtn} ${historyStyles.actionBtnPrimary} ${historyStyles.actionBtnCompact}`} href={`/backoffice?demoId=${demo.id}`}>Generate DC →</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
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

        <h2 className={`${calcStyles.h2} ${demoForGenerate || linkedDc || showManualDc ? styles.allDcHeadingSpaced : calcStyles.h2Flush}`}>All Delivery Challans</h2>
        <FilterBar>
          {canManage && !showManualDc && <Button variant="primary" icon={<Plus size={16} />} compact onClick={() => setShowManualDc(true)}>Create Manual DC</Button>}
          <button type="button" className={historyStyles.button} onClick={load}>Refresh</button>
        </FilterBar>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <Table
            columns={dcColumns}
            rows={dcs}
            rowKey={(dc) => dc.id}
            empty={<div className={historyStyles.empty}>No Delivery Challans yet — generate one from an approved demo request.</div>}
          />
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
