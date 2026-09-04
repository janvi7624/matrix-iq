'use client';

import { useEffect, useState } from 'react';
import { useToast } from './ui/ToastProvider';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './reimbursement.module.css';

interface UserOption { id: string; username: string; name: string }

const DESCRIPTION_OPTIONS = ['Lunch', 'Dinner', 'Snacks', 'Conveyance', 'Bus Ticket', 'Train Ticket', 'Flight Ticket', 'Hotel', 'Other'];
const TRAVEL_DESCRIPTIONS = new Set(['Conveyance', 'Bus Ticket', 'Train Ticket', 'Flight Ticket']);
const VEHICLE_RATE: Record<string, number> = { '2 Wheeler': 4, '4 Wheeler': 8, 'Cab': 0 };
const MODE_OPTIONS = ['Cash', 'UPI', 'Bank Transfer', 'Credit Card', 'Debit Card', 'Cheque', 'Other'];

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `row-${Date.now()}-${keySeq}`;
}

interface BulkRow {
  key: string;
  date: string;
  descriptionType: string;
  description: string;
  vehicleType: string;
  employeeIds: string[];
  fromLocation: string;
  toLocation: string;
  kilometers: string;
  amount: string;
  modeOfPayment: string;
  attachmentUrls: string[];
  uploading: boolean;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string;
}

function emptyRow(carryFrom?: BulkRow): BulkRow {
  return {
    key: nextKey(),
    date: carryFrom?.date || '',
    descriptionType: '',
    description: '',
    vehicleType: '',
    employeeIds: carryFrom?.employeeIds || [],
    fromLocation: '',
    toLocation: '',
    kilometers: '',
    amount: '',
    modeOfPayment: carryFrom?.modeOfPayment || '',
    attachmentUrls: [],
    uploading: false,
    status: 'idle',
    error: ''
  };
}

function composeDescription(row: BulkRow): string {
  if (row.descriptionType === 'Conveyance' && row.vehicleType) return `Conveyance (${row.vehicleType})`;
  if (row.descriptionType === 'Other') return row.description.trim();
  return row.descriptionType;
}

function validateRow(row: BulkRow): string {
  if (!row.date) return 'Date is required';
  if (!row.descriptionType) return 'Description is required';
  if (row.descriptionType === 'Other' && !row.description.trim()) return 'Enter the description for "Other"';
  if (row.descriptionType === 'Conveyance') {
    if (!row.vehicleType) return 'Select vehicle type';
    if (!row.fromLocation.trim() || !row.toLocation.trim()) return 'From and To are required';
    if (row.vehicleType !== 'Cab' && !row.kilometers) return 'Kilometers is required';
  }
  if (!row.employeeIds.length) return 'Select at least one employee';
  const attachmentOptional = row.descriptionType === 'Conveyance' && (row.vehicleType === '2 Wheeler' || row.vehicleType === '4 Wheeler');
  if (!attachmentOptional && !row.attachmentUrls.length) return 'Attach a bill proof';
  if (!Number(row.amount) || Number(row.amount) <= 0) return 'Amount must be greater than zero';
  return '';
}

interface Props {
  users: UserOption[];
  myUserId: string;
  dateMin: string;
  dateMax: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function ReimbursementBulkAddForm({ users, myUserId, dateMin, dateMax, onClose, onSaved }: Props) {
  const toast = useToast();
  const [rows, setRows] = useState<BulkRow[]>(() => Array.from({ length: 5 }, () => emptyRow({ employeeIds: myUserId ? [myUserId] : [] } as BulkRow)));
  const [saving, setSaving] = useState(false);

  // myUserId comes from an async /api/users/lite fetch in the parent, which
  // can still be resolving at the instant this form mounts (its own useState
  // initializer above only runs once). Backfill any row that's still
  // employee-less once it becomes known, rather than leaving rows
  // permanently defaulted to nobody just because of that race.
  useEffect(() => {
    if (!myUserId) return;
    setRows((prev) => prev.map((r) => (r.employeeIds.length === 0 ? { ...r, employeeIds: [myUserId] } : r)));
  }, [myUserId]);

  function updateRow(key: string, patch: Partial<BulkRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, status: 'idle', error: '' } : r)));
  }

  function addRows(count: number) {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      const added = Array.from({ length: count }, () => emptyRow(last));
      return [...prev, ...added];
    });
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  async function uploadFor(key: string, files: FileList | null) {
    if (!files?.length) return;
    updateRow(key, { uploading: true });
    try {
      const fd = new FormData();
      fd.append('folder', 'reimbursement');
      for (let i = 0; i < files.length; i++) fd.append('files', files[i]);
      const res = await fetch('/api/uploads', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error || 'Upload failed. Please try again.'); return; }
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, attachmentUrls: [...r.attachmentUrls, ...(data?.urls || [])] } : r)));
    } finally {
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, uploading: false } : r)));
    }
  }

  function addCompanion(key: string, userId: string) {
    if (!userId) return;
    setRows((prev) => prev.map((r) => (r.key === key && !r.employeeIds.includes(userId) ? { ...r, employeeIds: [...r.employeeIds, userId] } : r)));
  }

  function removeCompanion(key: string, userId: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, employeeIds: r.employeeIds.filter((id) => id !== userId) } : r)));
  }

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const filledCount = rows.filter((r) => r.date || r.descriptionType || r.amount).length;

  async function handleSaveAll() {
    setSaving(true);
    let savedCount = 0;
    let errorCount = 0;
    const remaining: BulkRow[] = [];

    for (const row of rows) {
      // A still-completely-blank trailing row is just unused scratch space, not a mistake.
      const isBlank = !row.date && !row.descriptionType && !row.amount && !row.attachmentUrls.length;
      if (isBlank) continue;

      const validationError = validateRow(row);
      if (validationError) {
        remaining.push({ ...row, status: 'error', error: validationError });
        errorCount++;
        continue;
      }

      try {
        const res = await fetch('/api/reimbursement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: row.date,
            description: composeDescription(row),
            employeeIds: row.employeeIds,
            fromLocation: row.fromLocation,
            toLocation: row.toLocation,
            kilometers: Number(row.kilometers) || 0,
            amount: Number(row.amount),
            modeOfPayment: row.modeOfPayment,
            attachmentUrls: row.attachmentUrls
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          remaining.push({ ...row, status: 'error', error: data?.error || 'Could not save this row.' });
          errorCount++;
        } else {
          savedCount++;
        }
      } catch {
        remaining.push({ ...row, status: 'error', error: 'Could not reach the server.' });
        errorCount++;
      }
    }

    setSaving(false);
    if (savedCount > 0) onSaved();

    if (errorCount === 0) {
      toast.success(`${savedCount} ${savedCount === 1 ? 'entry' : 'entries'} added.`);
      onClose();
    } else {
      setRows(remaining.length ? remaining : [emptyRow({ employeeIds: myUserId ? [myUserId] : [] } as BulkRow)]);
      toast.error(`${savedCount} added, ${errorCount} need fixing — see the highlighted row${errorCount === 1 ? '' : 's'} below.`);
    }
  }

  return (
    <>
      <h2 className={`${calcStyles.h2} ${styles.h2SpacedTop}`}>Add Multiple Entries</h2>
      <div className={calcStyles.sectionPanel}>
        <div className={styles.bulkTableWrap}>
          <table className={styles.bulkTable}>
            <thead>
              <tr>
                <th className={styles.bulkColNum}>#</th>
                <th className={styles.bulkColDate}>Date *</th>
                <th className={styles.bulkColType}>Description *</th>
                <th className={styles.bulkColAmount}>Amount (₹) *</th>
                <th className={styles.bulkColMode}>Payment</th>
                <th className={styles.bulkColBill}>Bill Proof</th>
                <th className={styles.bulkColEmployee}>For</th>
                <th className={styles.bulkColRemove}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <BulkRowView
                  key={row.key}
                  index={i + 1}
                  row={row}
                  users={users}
                  myUserId={myUserId}
                  dateMin={dateMin}
                  dateMax={dateMax}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onUpload={(files) => uploadFor(row.key, files)}
                  onAddCompanion={(id) => addCompanion(row.key, id)}
                  onRemoveCompanion={(id) => removeCompanion(row.key, id)}
                  onRemoveRow={() => removeRow(row.key)}
                  canRemove={rows.length > 1}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.bulkFooterRow}>
          <button type="button" className={historyStyles.button} onClick={() => addRows(1)}>+ Add Row</button>
          <button type="button" className={historyStyles.button} onClick={() => addRows(5)}>+ Add 5 Rows</button>
          <span className={styles.bulkTotalText}>
            {filledCount > 0 && <>Running total: <strong>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></>}
          </span>
        </div>

        <div className={styles.formSubmitRow}>
          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={saving || filledCount === 0} onClick={handleSaveAll}>
            {saving ? 'Saving…' : `Save All${filledCount > 0 ? ` (${filledCount})` : ''}`}
          </button>
          <button type="button" className={historyStyles.button} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  );
}

function BulkRowView({
  index, row, users, myUserId, dateMin, dateMax, onChange, onUpload, onAddCompanion, onRemoveCompanion, onRemoveRow, canRemove
}: {
  index: number;
  row: BulkRow;
  users: UserOption[];
  myUserId: string;
  dateMin: string;
  dateMax: string;
  onChange: (patch: Partial<BulkRow>) => void;
  onUpload: (files: FileList | null) => void;
  onAddCompanion: (id: string) => void;
  onRemoveCompanion: (id: string) => void;
  onRemoveRow: () => void;
  canRemove: boolean;
}) {
  const [showCompanionPicker, setShowCompanionPicker] = useState(false);
  const isConveyance = row.descriptionType === 'Conveyance';
  const isOther = row.descriptionType === 'Other';
  // Bus/Train/Flight Ticket need From/To but not Conveyance's vehicle-type/KM split.
  const isSimpleTravel = TRAVEL_DESCRIPTIONS.has(row.descriptionType) && !isConveyance;
  const needsDetail = isConveyance || isOther || isSimpleTravel;
  const companions = row.employeeIds.filter((id) => id !== myUserId);

  return (
    <>
      <tr className={row.status === 'error' ? styles.bulkRowError : undefined}>
        <td className={styles.bulkColNum}>{index}</td>
        <td>
          <input type="date" className={calcStyles.formControl} min={dateMin} max={dateMax} value={row.date} onChange={(e) => onChange({ date: e.target.value })} />
        </td>
        <td>
          <select
            className={calcStyles.formControl}
            value={row.descriptionType}
            onChange={(e) => {
              const val = e.target.value;
              onChange({ descriptionType: val, description: '', vehicleType: '', fromLocation: '', toLocation: '', kilometers: '', amount: '' });
            }}
          >
            <option value="">— Select —</option>
            {DESCRIPTION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </td>
        <td>
          <input
            type="number" min="0.01" step="0.01" className={calcStyles.formControl} value={row.amount}
            readOnly={row.descriptionType === 'Conveyance' && !!row.vehicleType && row.vehicleType !== 'Cab'}
            onChange={(e) => onChange({ amount: e.target.value })} placeholder="0.00"
          />
        </td>
        <td>
          <select className={calcStyles.formControl} value={row.modeOfPayment} onChange={(e) => onChange({ modeOfPayment: e.target.value })}>
            <option value="">—</option>
            {MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </td>
        <td>
          {row.attachmentUrls.length > 0 ? (
            <span className={styles.miniTagInfo}>{row.attachmentUrls.length} file{row.attachmentUrls.length > 1 ? 's' : ''} ✓</span>
          ) : (
            <label className={styles.bulkUploadBtn}>
              {row.uploading ? 'Uploading…' : 'Upload'}
              <input type="file" multiple accept="image/*,.pdf" className={styles.hiddenFileInput} disabled={row.uploading} onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </td>
        <td>
          <button type="button" className={styles.bulkCompanionBtn} onClick={() => setShowCompanionPicker((v) => !v)}>
            You{companions.length > 0 ? ` +${companions.length}` : ''}
          </button>
        </td>
        <td>
          {canRemove && (
            <button type="button" className={styles.bulkRemoveBtn} onClick={onRemoveRow} title="Remove row" aria-label="Remove row">&times;</button>
          )}
        </td>
      </tr>

      {(needsDetail || showCompanionPicker || row.error) && (
        <tr className={row.status === 'error' ? styles.bulkRowError : undefined}>
          <td></td>
          <td colSpan={7}>
            <div className={styles.bulkDetailLine}>
              {isOther && (
                <input type="text" className={calcStyles.formControl} value={row.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Enter description" />
              )}
              {isConveyance && (
                <>
                  {Object.keys(VEHICLE_RATE).map((v) => (
                    <label key={v} className={`${styles.vehicleTypeOption} ${row.vehicleType === v ? styles.vehicleTypeOptionActive : styles.vehicleTypeOptionInactive}`}>
                      <input
                        type="radio" name={`vehicle-${row.key}`} value={v} checked={row.vehicleType === v} className={styles.hiddenRadio}
                        onChange={() => {
                          const km = Number(row.kilometers) || 0;
                          const rate = VEHICLE_RATE[v];
                          const isCab = v === 'Cab';
                          onChange({ vehicleType: v, amount: isCab ? '' : (km > 0 && rate > 0 ? String(km * rate) : ''), kilometers: isCab ? '' : row.kilometers });
                        }}
                      />
                      {v}{VEHICLE_RATE[v] > 0 ? ` (₹${VEHICLE_RATE[v]}/km)` : ''}
                    </label>
                  ))}
                  <input type="text" className={calcStyles.formControl} value={row.fromLocation} onChange={(e) => onChange({ fromLocation: e.target.value })} placeholder="From" />
                  <input type="text" className={calcStyles.formControl} value={row.toLocation} onChange={(e) => onChange({ toLocation: e.target.value })} placeholder="To" />
                  {row.vehicleType !== 'Cab' && (
                    <input
                      type="text" inputMode="decimal" className={calcStyles.formControl} value={row.kilometers} placeholder="KM"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== '' && !/^\d*\.?\d*$/.test(v)) return;
                        const km = Number(v) || 0;
                        const rate = VEHICLE_RATE[row.vehicleType] || 0;
                        onChange({ kilometers: v, amount: row.vehicleType && km > 0 ? String(km * rate) : row.amount });
                      }}
                    />
                  )}
                </>
              )}
              {isSimpleTravel && <TravelFromTo row={row} onChange={onChange} />}
              {(showCompanionPicker || companions.length > 0) && (
                <div className={styles.bulkCompanionPickerWrap}>
                  {companions.map((id) => {
                    const u = users.find((x) => x.id === id);
                    return (
                      <span key={id} className={`${historyStyles.rolePill} ${styles.employeePill} ${styles.employeePillOther}`}>
                        {u?.name || u?.username || id}
                        <button type="button" onClick={() => onRemoveCompanion(id)} className={styles.pillRemoveBtn}>&times;</button>
                      </span>
                    );
                  })}
                  <select className={calcStyles.formControl} onChange={(e) => { onAddCompanion(e.target.value); e.target.value = ''; }}>
                    <option value="">— Add companion —</option>
                    {users.filter((u) => !row.employeeIds.includes(u.id)).map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username}</option>
                    ))}
                  </select>
                </div>
              )}
              {row.error && <span className={styles.bulkRowErrorText}>{row.error}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Bus/Train/Flight tickets need From/To but not a vehicle-type/KM split.
function TravelFromTo({ row, onChange }: { row: BulkRow; onChange: (patch: Partial<BulkRow>) => void }) {
  return (
    <>
      <input type="text" className={calcStyles.formControl} value={row.fromLocation} onChange={(e) => onChange({ fromLocation: e.target.value })} placeholder="From" />
      <input type="text" className={calcStyles.formControl} value={row.toLocation} onChange={(e) => onChange({ toLocation: e.target.value })} placeholder="To" />
    </>
  );
}
