'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Paperclip } from 'lucide-react';
import { TmsDeliveryStatus, TmsProcurementRecord, TmsPurchaseStatus, UserRole } from '@/lib/types';
import { TMS_DELIVERY_STATUS_LABEL, TMS_DELIVERY_STATUS_TONE, TMS_PURCHASE_STATUS_LABEL, TMS_PURCHASE_STATUS_TONE } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import { useToast } from './ui/ToastProvider';
import EmptyState from './ui/EmptyState';

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function formatCurrency(value: number): string {
  return value ? `₹${value.toLocaleString('en-IN')}` : '-';
}

interface TmsProcurementDetailViewProps {
  procurementId: string;
  currentUser: { username: string; role: UserRole };
}

export default function TmsProcurementDetailView({ procurementId, currentUser }: TmsProcurementDetailViewProps) {
  void currentUser;
  const toast = useToast();
  const [record, setRecord] = useState<TmsProcurementRecord | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ vendor: '', quotedCost: '', finalCost: '', expectedDeliveryDate: '', actualDeliveryDate: '', remarks: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch(`/api/tms/procurement/${procurementId}`);
      if (response.status === 404) {
        setStatus('This procurement record could not be found.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body: TmsProcurementRecord = await response.json();
      setRecord(body);
      setForm({
        vendor: body.vendor,
        quotedCost: body.quoted_cost ? String(body.quoted_cost) : '',
        finalCost: body.final_cost ? String(body.final_cost) : '',
        expectedDeliveryDate: body.expected_delivery_date,
        actualDeliveryDate: body.actual_delivery_date,
        remarks: body.remarks
      });
      setStatus('');
    } catch {
      setStatus('Could not load this procurement record.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procurementId]);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch(`/api/tms/procurement/${procurementId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(errBody?.error || String(response.status));
      }
      await load();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save changes.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handlePurchaseStatusChange(next: TmsPurchaseStatus) {
    if (await patch({ purchaseStatus: next })) toast.success('Purchase status updated.');
  }

  async function handleDeliveryStatusChange(next: TmsDeliveryStatus) {
    if (await patch({ deliveryStatus: next })) toast.success('Delivery status updated.');
  }

  async function handleSaveDetails() {
    const ok = await patch({
      vendor: form.vendor,
      quotedCost: Number(form.quotedCost) || 0,
      finalCost: Number(form.finalCost) || 0,
      expectedDeliveryDate: form.expectedDeliveryDate,
      actualDeliveryDate: form.actualDeliveryDate,
      remarks: form.remarks
    });
    if (ok) toast.success('Procurement details saved.');
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('folder', 'tms-procurement');
      Array.from(files).forEach((f) => formData.append('files', f));
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(String(uploadRes.status));
      const { urls } = await uploadRes.json();
      const patchRes = await fetch(`/api/tms/procurement/${procurementId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addDocument', urls })
      });
      if (!patchRes.ok) throw new Error(String(patchRes.status));
      await load();
      toast.success('Document uploaded.');
    } catch {
      toast.error('Could not upload the document.');
    } finally {
      setUploading(false);
    }
  }

  if (!record) {
    return (
      <AppShell title="Procurement" subtitle="" showBackLink>
        <div className={historyStyles.status}>{status || 'Loading...'}</div>
      </AppShell>
    );
  }

  return (
    <AppShell title={record.item_name} subtitle={`${record.procurement_code} · ${record.project_name}`} showBackLink>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusBadge tone={TMS_PURCHASE_STATUS_TONE[record.purchase_status]} label={TMS_PURCHASE_STATUS_LABEL[record.purchase_status]} />
        <StatusBadge tone={TMS_DELIVERY_STATUS_TONE[record.delivery_status]} label={TMS_DELIVERY_STATUS_LABEL[record.delivery_status]} />
        <Link className={historyStyles.button} href="/tms/procurement">Back to Procurement</Link>
      </div>

      <div className={calcStyles.sectionPanel}>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Purchase status</label>
            <select className={calcStyles.formControl} value={record.purchase_status} disabled={saving} onChange={(e) => handlePurchaseStatusChange(e.target.value as TmsPurchaseStatus)}>
              {(Object.keys(TMS_PURCHASE_STATUS_LABEL) as TmsPurchaseStatus[]).map((s) => (
                <option key={s} value={s}>{TMS_PURCHASE_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Delivery status</label>
            <select className={calcStyles.formControl} value={record.delivery_status} disabled={saving} onChange={(e) => handleDeliveryStatusChange(e.target.value as TmsDeliveryStatus)}>
              {(Object.keys(TMS_DELIVERY_STATUS_LABEL) as TmsDeliveryStatus[]).map((s) => (
                <option key={s} value={s}>{TMS_DELIVERY_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Project:</strong> {record.project_name}</div>
          <div><strong>BOM Request:</strong> {record.bom_request_code || '-'}</div>
          <div><strong>Part number:</strong> {record.part_number || '-'}</div>
          <div><strong>Quantity:</strong> {record.quantity}</div>
        </div>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Request date:</strong> {formatDate(record.request_date)}</div>
          <div><strong>Required date:</strong> {formatDate(record.required_date)}</div>
          <div><strong>Estimated cost:</strong> {formatCurrency(record.estimated_cost)}</div>
        </div>

        <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginTop: 12 }}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Vendor / OEM</label>
            <input className={calcStyles.formControl} value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Quoted cost</label>
            <input type="number" min="0" className={calcStyles.formControl} value={form.quotedCost} onChange={(e) => setForm((f) => ({ ...f, quotedCost: e.target.value }))} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Final cost</label>
            <input type="number" min="0" className={calcStyles.formControl} value={form.finalCost} onChange={(e) => setForm((f) => ({ ...f, finalCost: e.target.value }))} />
          </div>
        </div>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Expected delivery date</label>
            <input type="date" className={calcStyles.formControl} value={form.expectedDeliveryDate} onChange={(e) => setForm((f) => ({ ...f, expectedDeliveryDate: e.target.value }))} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Actual delivery date</label>
            <input type="date" className={calcStyles.formControl} value={form.actualDeliveryDate} onChange={(e) => setForm((f) => ({ ...f, actualDeliveryDate: e.target.value }))} />
          </div>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Remarks</label>
          <textarea className={calcStyles.formControl} rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
        </div>
        <button type="button" className={calcStyles.btn} disabled={saving} onClick={handleSaveDetails}>
          {saving ? 'Saving…' : 'Save details'}
        </button>
      </div>

      <div className={calcStyles.sectionPanel} style={{ marginTop: 18 }}>
        <div className={calcStyles.h2}>Documents / Quotation</div>
        <input type="file" multiple disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
        {uploading && <div className={historyStyles.status}>Uploading…</div>}
        {record.documents.length === 0 ? (
          <EmptyState icon={Paperclip} title="No documents yet" message="Upload a vendor quotation or PO document above." />
        ) : (
          <ul style={{ marginTop: 12 }}>
            {record.documents.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
