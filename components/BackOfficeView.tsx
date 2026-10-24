'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuditLogEntry, BackOfficeRemarkTag, DcLineItem, DcStatus, DeliveryChallanRecord, DemoScheduleRecord, ProjectRecord, PublicAppConfig } from '@/lib/types';
import { CheckCircle2, Download, Lock, Package, Pencil, Plus, Printer, Save, Trash2, Truck, X } from 'lucide-react';
import PhoneInput from '@/components/ui/PhoneInput';
import SegmentedToggle from '@/components/ui/SegmentedToggle';
import StatTile from '@/components/ui/StatTile';
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
import { formatMoney } from '@/lib/format';
import styles from './backOffice.module.css';
import FilterBar from './ui/FilterBar';
import Modal, { ModalOkButton } from './ui/Modal';
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

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

interface ActiveEmployeeOption {
  id: string;
  username: string;
  name: string;
  department: string;
  designation: string;
}

const REQUESTED_BY_OTHER = '__other__';

// "Requested By" — a dropdown of real active employees (/api/backoffice/employees)
// rather than bare free text, everywhere it's editable. An option's value is
// a USERNAME, matching the demo-generation path's existing convention
// (assigned_engineer: demo.assigned_rep || demo.created_by) and the
// findUserByUsername lookup the dispatch/close notification already makes —
// using anything else here would silently break that email.
//
// 'Other' is the escape hatch: a manual DC is explicitly for "a walk-in or
// custom dispatch" (see ManualDcPanel's own subtitle below) — the requester
// may genuinely not be an employee at all, so the picker can't be a hard
// allowlist. Picking it (or already holding a value that matches no active
// employee — historical free text, or someone who's since left) reveals a
// plain text box; whatever's typed there is sent exactly as is.
function RequestedBySelect({ employees, value, onChange }: { employees: ActiveEmployeeOption[]; value: string; onChange: (v: string) => void }) {
  const [otherJustSelected, setOtherJustSelected] = useState(false);
  const matchesEmployee = employees.some((e) => e.username === value);
  const otherMode = otherJustSelected || (!!value && !matchesEmployee);

  return (
    <>
      <select
        className={calcStyles.formControl}
        value={otherMode ? REQUESTED_BY_OTHER : value}
        onChange={(e) => {
          if (e.target.value === REQUESTED_BY_OTHER) {
            setOtherJustSelected(true);
            onChange('');
          } else {
            setOtherJustSelected(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">— Select employee —</option>
        {employees.map((e) => (
          <option key={e.username} value={e.username}>{e.name}{e.department ? ` — ${e.department}` : ''}</option>
        ))}
        <option value={REQUESTED_BY_OTHER}>Other (type a name)…</option>
      </select>
      {otherMode && (
        <input
          className={`${calcStyles.formControl} ${styles.formRowSpacingTop}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type a name"
          autoFocus
        />
      )}
    </>
  );
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
function ManualDcPanel({ projects, employees, onGenerated, onCancel }: { projects: ProjectRecord[]; employees: ActiveEmployeeOption[]; onGenerated: (dc: DeliveryChallanRecord) => void; onCancel: () => void }) {
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
          <RequestedBySelect employees={employees} value={assignedEngineer} onChange={setAssignedEngineer} />
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

function DcDetail({ dc, canManage, employees, onUpdated, onDelete, onClose }: { dc: DeliveryChallanRecord; canManage: boolean; employees: ActiveEmployeeOption[]; onUpdated: (dc: DeliveryChallanRecord) => void; onDelete: (id: string) => Promise<void>; onClose: () => void }) {
  const [items, setItems] = useState<DcLineItem[]>(dc.items);
  const [assignedEngineer, setAssignedEngineer] = useState(dc.assigned_engineer);
  const [expectedReturnDate, setExpectedReturnDate] = useState(dc.expected_return_date);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Correcting a mistake after close (Back Office's own request) — a typo'd
  // client name, a wrong serial number — never a status change. Off by
  // default so opening a closed DC never looks editable by accident; the
  // fields below only matter once "Edit" is clicked.
  const [editingClosed, setEditingClosed] = useState(false);
  const [clientName, setClientName] = useState(dc.client_name);
  const [clientAddress, setClientAddress] = useState(dc.client_address);
  const [clientPhone, setClientPhone] = useState(dc.client_phone);
  const [issuedDate, setIssuedDate] = useState(dc.issued_date);
  const [editCostAmount, setEditCostAmount] = useState(String(dc.demo_cost_amount ?? ''));

  // Who changed what, and when — every lifecycle action on this DC already
  // writes an audit row (dispatch, return, close); this just surfaces that
  // trail, which no DC screen showed before. Fetched here rather than lifted
  // into the parent's list load because the list of all DCs has no reason to
  // carry every DC's full history — only the one dialog that's actually open
  // does.
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  async function loadActivity() {
    try {
      const response = await fetch(`/api/delivery-challans/${dc.id}`);
      const data = response.ok ? await response.json() : null;
      setActivity(Array.isArray(data?.activity) ? data.activity : []);
    } catch {
      setActivity([]);
    }
  }
  useEffect(() => { loadActivity(); }, [dc.id]);

  const [returned, setReturned] = useState(dc.material_return.returned);
  const [condition, setCondition] = useState(dc.material_return.condition);
  const [missing, setMissing] = useState(dc.material_return.missing);
  const [damaged, setDamaged] = useState(dc.material_return.damaged);
  const [accessories, setAccessories] = useState(dc.material_return.accessories);
  const [serialNumberVerified, setSerialNumberVerified] = useState(dc.material_return.serialNumberVerified);
  const [remarkTags, setRemarkTags] = useState<BackOfficeRemarkTag[]>(dc.material_return.remarkTags);
  const [remarks, setRemarks] = useState(dc.material_return.remarks);
  const [publicConfig, setPublicConfig] = useState<PublicAppConfig | null>(null);
  // The close flow is two steps: "Close DC" reveals the cost question, and
  // only "Confirm close" writes. Deliberately not a confirm() dialog — see
  // the note on handleConfirmClose.
  const [closing, setClosing] = useState(false);
  const [hadCost, setHadCost] = useState<'' | 'no' | 'yes'>('');
  const [costAmount, setCostAmount] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    fetch('/api/config/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PublicAppConfig | null) => setPublicConfig(data))
      .catch(() => setPublicConfig(null));
  }, []);

  // Returns whether the write landed, so the caller can decide what to do
  // next — closing a DC dismisses the dialog, but only if it actually closed.
  async function patch(action: string, extra: Record<string, unknown>): Promise<boolean> {
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
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this change.');
      return false;
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

  /**
   * Finalises the DC, recording what the demo cost.
   *
   * Inline rather than a confirm() over the dialog, for two reasons that are
   * both structural: ConfirmDialog never registers in modalStack, so Escape
   * over the confirm would close the Modal underneath it and leave the
   * confirm orphaned; and ConfirmOptions has no slot for a number input, so
   * the amount would need a form in the dialog AND a confirm on top of it.
   *
   * An empty string is sent for "no cost" on purpose — the server stores
   * NULL for that, which stays distinguishable from a recorded 0.
   */
  async function handleConfirmClose() {
    const amount = hadCost === 'yes' ? costAmount.trim() : '';
    if (hadCost === 'yes') {
      const parsed = Number(amount);
      if (!amount || !Number.isFinite(parsed) || parsed < 0) {
        toast.error('Enter the demo cost as a number of 0 or more.');
        return;
      }
    }
    const saved = await patch('close', { demoCostAmount: amount });
    // The closed section below has nothing further to reveal once this
    // succeeds, so staying open would leave the person looking at a dialog
    // that just finished doing the one thing it was for.
    if (saved) onClose();
  }

  async function handleSaveClosedEdit() {
    const saved = await patch('editClosed', {
      items,
      assignedEngineer,
      expectedReturnDate,
      clientName,
      clientAddress,
      clientPhone,
      issuedDate,
      demoCostAmount: editCostAmount.trim()
    });
    if (saved) {
      setEditingClosed(false);
      loadActivity();
    }
  }

  function cancelClosedEdit() {
    // Drop back to whatever is currently on `dc` — discards anything typed,
    // same as leaving the form without saving should.
    setItems(dc.items);
    setAssignedEngineer(dc.assigned_engineer);
    setExpectedReturnDate(dc.expected_return_date);
    setClientName(dc.client_name);
    setClientAddress(dc.client_address);
    setClientPhone(dc.client_phone);
    setIssuedDate(dc.issued_date);
    setEditCostAmount(String(dc.demo_cost_amount ?? ''));
    setEditingClosed(false);
  }

  return (
    // No .detailPanel, no heading and no status badge of its own: this
    // renders inside a Modal now, which carries the card, the DC number and
    // the status. Keeping them would be a panel inside a panel showing the
    // same number twice.
    <div>
      <div className={styles.detailHeaderRow}>
        <div>
          <div className={calcStyles.small}>
            {dc.client_name} · Issued by {dc.issued_by} on {formatDate(dc.issued_date)}
            {dc.project_id ? (
              <>
                {' · '}
                {/* The name, not the id — this line printed the raw UUID too. */}
                <Link href={`/projects/${dc.project_id}`}>{dc.project_name || 'Project'}</Link>
              </>
            ) : (
              dc.custom_project_name && <>{' · '}Project: {dc.custom_project_name}</>
            )}
          </div>
        </div>
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
                {canManage && (dc.status === 'prepared' || editingClosed) ? (
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
                {canManage && (dc.status === 'prepared' || editingClosed) ? (
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
                {canManage && (dc.status === 'prepared' || editingClosed) ? (
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
              <RequestedBySelect employees={employees} value={assignedEngineer} onChange={setAssignedEngineer} />
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
              {!closing ? (
                <div className={historyStyles.actionGroupButtons}>
                  <Button variant="success" icon={<Lock size={16} />} onClick={() => setClosing(true)}>Close DC</Button>
                </div>
              ) : (
                <div className={styles.dcCloseStep}>
                  <div className={calcStyles.label}>Did anything cost money during this demo?</div>
                  <div className={styles.dcCloseChoices}>
                    <label className={styles.dcCloseChoice}>
                      <input
                        type="radio"
                        name="dc-had-cost"
                        checked={hadCost === 'no'}
                        onChange={() => { setHadCost('no'); setCostAmount(''); }}
                      />
                      No
                    </label>
                    <label className={styles.dcCloseChoice}>
                      <input
                        type="radio"
                        name="dc-had-cost"
                        checked={hadCost === 'yes'}
                        onChange={() => setHadCost('yes')}
                      />
                      Yes
                    </label>
                  </div>
                  {hadCost === 'yes' && (
                    <div className={calcStyles.field}>
                      <label className={calcStyles.label} htmlFor="dc-demo-cost">Amount (₹)</label>
                      <input
                        id="dc-demo-cost"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className={calcStyles.formControl}
                        value={costAmount}
                        onChange={(e) => setCostAmount(e.target.value)}
                      />
                    </div>
                  )}
                  <div className={historyStyles.actionGroupButtons}>
                    <Button
                      variant="success"
                      icon={<Lock size={16} />}
                      loading={busy}
                      loadingLabel="Closing…"
                      disabled={!hadCost || (hadCost === 'yes' && !costAmount.trim())}
                      onClick={handleConfirmClose}
                    >
                      Confirm close
                    </Button>
                    <Button variant="ghost" onClick={() => { setClosing(false); setHadCost(''); setCostAmount(''); }}>Cancel</Button>
                  </div>
                  <div className={calcStyles.small}>Closing finalises this Delivery Challan and cannot be undone.</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {dc.status === 'closed' && (
        <div className={styles.sectionSpacingTop16}>
          <div className={styles.detailHeaderRow}>
            <h3 className={historyStyles.h3Flush}>Closed — final record</h3>
            {canManage && !editingClosed && (
              <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditingClosed(true)}>Edit</Button>
            )}
          </div>

          {!editingClosed ? (
            <div className={historyStyles.reviewGrid}>
              <div className={historyStyles.reviewRow}><strong>Client:</strong> {dc.client_name}</div>
              <div className={historyStyles.reviewRow}><strong>Address:</strong> {dc.client_address || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Phone:</strong> {dc.client_phone || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Requested By:</strong> {dc.assigned_engineer || '-'}</div>
              <div className={historyStyles.reviewRow}><strong>Expected Return:</strong> {formatDate(dc.expected_return_date)}</div>
              <div className={historyStyles.reviewRow}><strong>Condition:</strong> {dc.material_return.condition || '-'}</div>
              <div className={historyStyles.reviewRow}>
                <strong>Demo Cost:</strong> {dc.demo_cost_amount === '' ? 'Not recorded' : `₹${Number(dc.demo_cost_amount).toLocaleString('en-IN')}`}
              </div>
            </div>
          ) : (
            <>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Client Name</label>
                  <input className={calcStyles.formControl} value={clientName} onChange={(e) => setClientName(e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Client Phone</label>
                  <PhoneInput value={clientPhone} onChange={setClientPhone} />
                </div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Client Address</label>
                <input className={calcStyles.formControl} value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns} ${styles.formRowSpacingTop}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Requested By</label>
                  <RequestedBySelect employees={employees} value={assignedEngineer} onChange={setAssignedEngineer} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Issued Date</label>
                  <input type="date" className={calcStyles.formControl} value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Expected return date</label>
                  <input type="date" className={calcStyles.formControl} value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} />
                </div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Demo Cost (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className={calcStyles.formControl}
                  value={editCostAmount}
                  placeholder="Not recorded"
                  onChange={(e) => setEditCostAmount(e.target.value)}
                />
              </div>
              <div className={`${historyStyles.actionGroup} ${styles.sectionSpacingTop10}`}>
                <div className={historyStyles.actionGroupLabel}>Primary Actions</div>
                <div className={historyStyles.actionGroupButtons}>
                  <Button variant="success" icon={<Save size={16} />} loading={busy} loadingLabel="Saving…" onClick={handleSaveClosedEdit}>Save Changes</Button>
                  <Button variant="ghost" icon={<X size={16} />} onClick={cancelClosedEdit}>Cancel</Button>
                </div>
              </div>
              <div className={calcStyles.small}>Saving records who made this change and when in the Activity Log below.</div>
            </>
          )}
        </div>
      )}

      <div className={styles.sectionSpacingTop16}>
        <h3 className={historyStyles.h3Flush}>Activity Log</h3>
        {activity.length === 0 ? (
          <div className={calcStyles.small}>No activity recorded yet.</div>
        ) : (
          <div className={styles.activityList}>
            {activity.map((a) => (
              <div key={a.id} className={styles.activityItem}>
                <div className={styles.activityAction}>{a.action}</div>
                <div className={styles.activityMeta}>{a.by || 'system'} · {formatDateTime(a.at)}</div>
                {a.remarks && <div className={styles.activityRemarks}>{a.remarks}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface DemoSummaryRow {
  username: string;
  name: string;
  demoCount: number;
  costRecordedCount: number;
  totalExpense: number;
}

interface DemoSummaryTrendRow {
  monthKey: string;
  label: string;
  demoCount: number;
  costRecordedCount: number;
  totalExpense: number;
}

interface DemoSummaryReport {
  from: string;
  to: string;
  label: string;
  rows: DemoSummaryRow[];
  totals: { demoCount: number; costRecordedCount: number; totalExpense: number };
  monthlyTrend: DemoSummaryTrendRow[];
}

type SummaryPeriod = 'this_month' | 'last_month' | 'all';

const SUMMARY_PERIOD_OPTIONS: { value: SummaryPeriod; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'all', label: 'All Time' }
];

function expenseCell(costRecordedCount: number, demoCount: number, totalExpense: number) {
  if (costRecordedCount === 0) return <span className={styles.dcExpenseNone}>—</span>;
  return (
    <>
      {formatMoney(totalExpense)}
      {costRecordedCount < demoCount && <span className={calcStyles.small}> ({costRecordedCount}/{demoCount} recorded)</span>}
    </>
  );
}

// "Which sales person did how many demos (DCs), what did they cost, and a
// monthly summary too" — the dashboard requested alongside the existing flat
// DC list. Reads the same aggregation (lib/backOfficeDemoSummary.ts) the
// monthly email job sends, so the two can never disagree.
function DemoExpenseSummaryPanel() {
  const [period, setPeriod] = useState<SummaryPeriod>('this_month');
  const [data, setData] = useState<DemoSummaryReport | null>(null);
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    let active = true;
    setStatus('Loading...');
    setData(null);
    fetch(`/api/backoffice/demo-summary?period=${period}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((body: DemoSummaryReport) => {
        if (!active) return;
        setData(body);
        setStatus('');
      })
      .catch(() => { if (active) setStatus('Could not load the demo & expense summary.'); });
    return () => { active = false; };
  }, [period]);

  const salesPersonCount = data?.rows.filter((r) => r.username).length ?? 0;

  const salesColumns: TableColumn<DemoSummaryRow>[] = [
    { key: 'name', header: 'Sales Person', render: (r) => r.name },
    { key: 'demos', header: 'Demos (DCs)', render: (r) => r.demoCount },
    { key: 'expense', header: 'Expense', cellClassName: styles.dcExpenseCell, render: (r) => expenseCell(r.costRecordedCount, r.demoCount, r.totalExpense) }
  ];

  const trendColumns: TableColumn<DemoSummaryTrendRow>[] = [
    { key: 'month', header: 'Month', render: (r) => r.label },
    { key: 'demos', header: 'Demos (DCs)', render: (r) => r.demoCount },
    { key: 'expense', header: 'Expense', cellClassName: styles.dcExpenseCell, render: (r) => expenseCell(r.costRecordedCount, r.demoCount, r.totalExpense) }
  ];

  return (
    <div>
      <div className={styles.detailHeaderRow}>
        <h2 className={calcStyles.h2Flush}>Demo & Expense Summary{data?.label ? ` — ${data.label}` : ''}</h2>
        <SegmentedToggle options={SUMMARY_PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      </div>
      <div className={historyStyles.status}>{status}</div>

      {data && (
        <>
          <div className={styles.summaryTilesRow}>
            <StatTile value={data.totals.demoCount} label="Total Demos (DCs)" />
            <StatTile value={data.totals.costRecordedCount === 0 ? '—' : formatMoney(data.totals.totalExpense)} label="Total Expense" tone="accent" />
            <StatTile value={salesPersonCount} label="Sales People" />
          </div>

          <h3 className={historyStyles.h3Flush}>By Sales Person</h3>
          <Table
            columns={salesColumns}
            rows={data.rows}
            rowKey={(r) => r.username || 'unattributed'}
            empty={<div className={historyStyles.empty}>No Delivery Challans in this period.</div>}
          />

          <h3 className={`${historyStyles.h3Flush} ${styles.sectionSpacingTop16}`}>Monthly Summary</h3>
          <Table columns={trendColumns} rows={data.monthlyTrend} rowKey={(r) => r.monthKey} />
        </>
      )}
    </div>
  );
}

function BackOfficeContent({ canManage }: { canManage: boolean }) {
  const searchParams = useSearchParams();
  const demoIdParam = searchParams.get('demoId') || '';
  // Deep-links a specific DC open — e.g. from the Person Performance
  // Dashboard's "DCs moved past preparation" / "Still awaiting dispatch"
  // drill-down (lib/departmentScoring.ts). Read once on mount, same as
  // demoIdParam above.
  const dcIdParam = searchParams.get('dc') || '';
  // ?dc= always means "show me this challan", so it forces the Delivery
  // Challans tab open regardless of which tab was last active — otherwise a
  // drilldown link (e.g. from the Person Performance Dashboard) could land
  // on the Summary tab with nothing visibly happening.
  const [view, setView] = useState<'challans' | 'summary'>('challans');

  const [dcs, setDcs] = useState<DeliveryChallanRecord[]>([]);
  const [demos, setDemos] = useState<DemoScheduleRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [employees, setEmployees] = useState<ActiveEmployeeOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [openId, setOpenId] = useState<string | null>(dcIdParam || null);
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
    fetch('/api/backoffice/employees').then((r) => (r.ok ? r.json() : [])).then(setEmployees).catch(() => setEmployees([]));
  }, []);

  const demoForGenerate = useMemo(() => {
    if (!demoIdParam) return null;
    const existingDc = dcs.find((d) => d.demo_id === demoIdParam);
    if (existingDc) return null;
    const demo = demos.find((d) => d.id === demoIdParam);
    return demo && demo.status === 'pending_backoffice' ? demo : null;
  }, [demoIdParam, demos, dcs]);

  const linkedDc = useMemo(() => (demoIdParam ? dcs.find((d) => d.demo_id === demoIdParam) : null), [demoIdParam, dcs]);

  // Which Project cells have been clicked open. A Set rather than a single
  // id so two long names can be read at once, matching how ProjectsView
  // handles its clamped Remark column.
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  function toggleProjectExpanded(id: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // The record the dialog shows, re-derived from the list so an edit saved
  // inside it is reflected immediately (handleUpdated replaces the row).
  const openDc = useMemo(() => dcs.find((d) => d.id === openId) ?? null, [dcs, openId]);

  // A ?demoId= deep link that resolves to an existing DC opens it. Keyed on
  // the ID and not the record: handleUpdated swaps in a fresh object on every
  // save, so depending on the object would re-open the dialog the instant
  // someone dismissed it after an edit.
  const linkedDcId = linkedDc?.id ?? '';
  useEffect(() => {
    if (linkedDcId) { setOpenId(linkedDcId); setView('challans'); }
  }, [linkedDcId]);

  // The "Demo(s) awaiting a Delivery Challan" attention item on the
  // Dashboard just links to plain /backoffice with no demoId — landing here
  // showed nothing actionable. This lists every such demo so that link (and
  // this page on its own) is actually useful, not just a dead end; the
  // per-demo "Generate DC ->" link on Demo Schedule stays the direct path.
  const demosAwaitingDc = useMemo(() => demos.filter((d) => d.status === 'pending_backoffice'), [demos]);

  // Deleting from inside the dialog has to dismiss it too. The old inline
  // panel disappeared with the row it was rendered under; a dialog gated on
  // a record that no longer exists would otherwise just blank out.
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
    {
      key: 'project',
      header: 'Project',
      render: (dc) => {
        // The project NAME, resolved server-side (see
        // lib/deliveryChallanStore.ts projectLabelOf). This used to print
        // dc.project_id — a raw UUID — as its own link text.
        //
        // custom_project_name is the fallback that manual DCs depend on:
        // they have no linked project at all, so a label is all there is.
        const label = dc.project_name || dc.custom_project_name || '';
        if (!label) return '-';
        const expanded = expandedProjects.has(dc.id);
        return (
          <button
            type="button"
            className={`${styles.dcProjectCell} ${expanded ? styles.dcProjectCellExpanded : ''}`}
            title={label}
            onClick={() => toggleProjectExpanded(dc.id)}
            aria-expanded={expanded}
          >
            {label}
          </button>
        );
      }
    },
    { key: 'client', header: 'Client', render: (dc) => dc.client_name },
    { key: 'requestedBy', header: 'Requested By', render: (dc) => dc.assigned_engineer || '-' },
    {
      key: 'expense',
      header: 'Expense',
      cellClassName: styles.dcExpenseCell,
      // An em dash, not ₹0: no cost recorded is a different fact from a
      // recorded zero, and the column would otherwise claim every DC closed
      // before this existed had been checked and cost nothing.
      render: (dc) =>
        dc.demo_cost_amount === '' ? <span className={styles.dcExpenseNone}>—</span> : formatMoney(dc.demo_cost_amount)
    },
    { key: 'status', header: 'Status', render: (dc) => <StatusBadge tone={DC_STATUS_TONE[dc.status]} label={DC_STATUS_LABEL[dc.status]} /> },
    { key: 'issuedDate', header: 'Issued Date', render: (dc) => formatDate(dc.issued_date) },
    {
      key: 'actions',
      header: '',
      render: (dc) => (
        <button type="button" className={historyStyles.button} onClick={() => setOpenId(dc.id)}>
          View
        </button>
      )
    }
  ];

  return (
    <AppShell title="Back Office Operations" subtitle="Delivery Challans — materials out, dispatched, returned, and closed.">
        <SegmentedToggle
          options={[
            { value: 'challans', label: 'Delivery Challans' },
            { value: 'summary', label: 'Demo & Expense Summary' }
          ]}
          value={view}
          onChange={setView}
        />

        {view === 'summary' ? (
          <div className={styles.sectionSpacingTop16}>
            <DemoExpenseSummaryPanel />
          </div>
        ) : (
        <div className={styles.sectionSpacingTop16}>
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

        {canManage && showManualDc && (
          <ManualDcPanel
            projects={projects}
            employees={employees}
            onCancel={() => setShowManualDc(false)}
            onGenerated={(dc) => { setDcs((prev) => [dc, ...prev]); setShowManualDc(false); toast.success(`${dc.dc_number} created.`); }}
          />
        )}

        <h2 className={`${calcStyles.h2} ${demoForGenerate || showManualDc ? styles.allDcHeadingSpaced : calcStyles.h2Flush}`}>All Delivery Challans</h2>
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
        </div>
        )}
        {/* One dialog for both entry paths — the View button and a ?demoId=
            deep link. Previously the deep link rendered its own inline panel
            AND suppressed this one via `!linkedDc`, so arriving with
            ?demoId= left the View button dead on every row. Rendered outside
            the tab switch above (not just the Delivery Challans branch) so
            switching tabs can never strand an already-open dialog.

            Gated on the record found in `dcs`, never on `openId` alone, so a
            stale id cannot hold an empty dialog open. `key` re-mounts the
            detail per DC, which matters because it seeds eleven useState
            values from its props.

            The footer says "Done", deliberately not "Close": "Close DC" is
            an irreversible status change sitting a few pixels away in the
            body, and two buttons both reading Close is how someone
            finalises a challan they only meant to dismiss. Modal has no
            close button of its own, so without this there is none. */}
        {openDc && (
          <Modal
            title={(
              <span className={styles.dcDialogTitle}>
                {openDc.dc_number}
                <StatusBadge tone={DC_STATUS_TONE[openDc.status]} label={DC_STATUS_LABEL[openDc.status]} />
              </span>
            )}
            ariaLabel={`Delivery Challan ${openDc.dc_number}`}
            size="wide"
            onClose={() => setOpenId(null)}
            footer={<ModalOkButton onClick={() => setOpenId(null)}>Done</ModalOkButton>}
          >
            <DcDetail
              key={openDc.id}
              dc={openDc}
              canManage={canManage}
              employees={employees}
              onUpdated={handleUpdated}
              onDelete={handleDelete}
              onClose={() => setOpenId(null)}
            />
          </Modal>
        )}
    </AppShell>
  );
}

// DC management is strictly Back Office (or Admin/Super Admin as the org's
// ultimate override), or whoever is configured as the Back Office
// department's own manager — Manager is otherwise deliberately excluded,
// unlike the app's usual isPrivileged convention. Resolved server-side (see
// app/backoffice/page.tsx, lib/backOfficeAccess.ts) since this client
// component only ever gets {username, role} for currentUser, with no
// Department Master lookup available in the browser.
export default function BackOfficeView({ canManage }: { canManage: boolean }) {
  return (
    <Suspense fallback={<AppShell title="Back Office Operations" subtitle="Delivery Challans — prepare, dispatch, verify returns, close.">{null}</AppShell>}>
      <BackOfficeContent canManage={canManage} />
    </Suspense>
  );
}
