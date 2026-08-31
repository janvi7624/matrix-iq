'use client';

import { useRef, useState } from 'react';
import { FileSpreadsheet, Images, Upload, CheckCircle2, XCircle, AlertTriangle, Download } from 'lucide-react';
import { preprocessCardImage, scanBusinessCard } from '@/lib/cardOcr';
import { parseCsv } from '@/lib/csv';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './leadBulkImportWizard.module.css';

// Bulk lead import — two entry paths (CSV, multiple business-card photos)
// that both converge on the same preview -> review -> commit flow against
// app/api/leads/bulk-import/{preview,commit}, mirroring the existing
// employee bulk-import's dry-run/commit shape (app/admin/users/import).
// Reuses lib/cardOcr.ts (the same OCR used by the single-image "Scan
// Business Card" flow) in a client-side loop — there's no server-side OCR
// in this app and this doesn't add one.

interface BulkRowDraft {
  name: string;
  mobile: string;
  email: string;
  designation: string;
  company: string;
  city: string;
  cardImageUrl: string;
  budget: string;
  notes: string;
}

const EMPTY_ROW: BulkRowDraft = { name: '', mobile: '', email: '', designation: '', company: '', city: '', cardImageUrl: '', budget: '', notes: '' };

type PreviewStatus = 'valid' | 'duplicate' | 'invalid';

interface PreviewRow {
  index: number;
  row: BulkRowDraft;
  status: PreviewStatus;
  reason?: string;
  existingLead?: { id: string; name: string; company: string; mobile: string; email: string; created_by: string };
  selected: boolean;
  sourceLabel: string; // CSV row number, or image filename
}

type TargetField = keyof BulkRowDraft | 'skip';

const TARGET_FIELD_OPTIONS: { key: TargetField; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company' },
  { key: 'designation', label: 'Designation' },
  { key: 'mobile', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' },
  { key: 'budget', label: 'Budget' },
  { key: 'notes', label: 'Notes (any extra column — e.g. Address, Website — can map here too)' },
  { key: 'skip', label: '— Skip this column —' }
];

// Alias -> target field, matched after stripping everything but letters/digits.
// cardImageUrl is deliberately excluded — CSV rows never carry a card image.
const FIELD_ALIASES: Record<Exclude<TargetField, 'skip' | 'cardImageUrl'>, string[]> = {
  name: ['name', 'fullname', 'contactname', 'leadname', 'clientname', 'customername', 'personname', 'contactperson', 'client', 'customer'],
  company: ['company', 'companyname', 'organisation', 'organization', 'firm', 'businessname', 'firmname', 'clientcompany', 'accountname', 'enterprise', 'organisationname', 'organizationname'],
  designation: ['designation', 'title', 'jobtitle', 'role', 'position'],
  mobile: ['mobile', 'phone', 'contact', 'contactnumber', 'mobilenumber', 'phonenumber', 'cell', 'mobileno', 'contactno', 'whatsapp', 'whatsappnumber', 'telephone'],
  email: ['email', 'emailid', 'mail', 'emailaddress', 'emailidid'],
  city: ['city', 'location', 'town', 'place'],
  budget: ['budget', 'value', 'dealvalue', 'estimatedvalue'],
  notes: ['remarks', 'notes', 'comment', 'comments', 'address', 'website', 'url', 'source', 'description']
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function guessTargetField(header: string): TargetField {
  const norm = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => normalizeHeader(a) === norm)) return field as TargetField;
  }
  return 'skip';
}

type Screen = 'choose' | 'csv-upload' | 'csv-map' | 'images-select' | 'images-processing' | 'review' | 'done';

interface ImageJobStatus {
  file: File;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error?: string;
  row?: BulkRowDraft;
}

interface LeadBulkImportWizardProps {
  onImportComplete: () => void;
  onCancel: () => void;
}

export default function LeadBulkImportWizard({ onImportComplete, onCancel }: LeadBulkImportWizardProps) {
  const toast = useToast();
  const [screen, setScreen] = useState<Screen>('choose');
  const [importType, setImportType] = useState<'csv' | 'images'>('csv');

  // CSV state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvDataRows, setCsvDataRows] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, TargetField>>({});

  // Image state
  const [imageJobs, setImageJobs] = useState<ImageJobStatus[]>([]);

  // Shared review state
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [commitSummary, setCommitSummary] = useState<{ created: number; merged: number; failed: number } | null>(null);

  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------
  // CSV path
  // ---------------------------------------------------------------------

  // Modern .xlsx/.xlsm are ZIP archives — first 4 bytes "PK\x03\x04" (or,
  // rarely, one of the other PK-prefixed empty/spanned-archive signatures).
  // Legacy "Excel 97-2003" .xls is a completely different container (OLE
  // Compound File Binary Format), signature D0 CF 11 E0 A1 B1 1A E1.
  // Sniffing the actual bytes instead of trusting the file's name/extension
  // catches the real-world case that caused garbled "PK...[Content_Types].xml"
  // column headers: someone selecting (or the OS file picker allowing) a
  // genuine Excel workbook into the "Import CSV" flow, whether it's actually
  // named .csv or not.
  async function looksLikeXlsx(file: File): Promise<boolean> {
    if (/\.xlsx?$|\.xlsm$/i.test(file.name)) return true;
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
    const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0 && head[4] === 0xa1 && head[5] === 0xb1 && head[6] === 0x1a && head[7] === 0xe1;
    return isZip || isOle;
  }

  function applyParsedRows(rows: string[][]) {
    if (rows.length < 2) {
      toast.error('That file has no data rows.');
      return;
    }
    const [headerRow, ...dataRows] = rows;
    setCsvHeaders(headerRow);
    setCsvDataRows(dataRows);
    const guessed: Record<string, TargetField> = {};
    headerRow.forEach((h) => { guessed[h] = guessTargetField(h); });
    setColumnMapping(guessed);
    setImportType('csv');
    setScreen('csv-map');
  }

  async function handleCsvSelected(file: File | undefined) {
    if (!file) return;
    if (await looksLikeXlsx(file)) {
      setBusy(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/leads/bulk-import/parse-xlsx', { method: 'POST', body: formData });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body) {
          toast.error(body?.error || 'Could not read that Excel file.');
          return;
        }
        applyParsedRows([body.headers, ...body.rows]);
      } catch {
        toast.error('Could not read that Excel file.');
      } finally {
        setBusy(false);
      }
      return;
    }
    const text = await file.text();
    applyParsedRows(parseCsv(text));
  }

  function buildRowsFromCsvMapping(): { row: BulkRowDraft; sourceLabel: string }[] {
    return csvDataRows.map((dataRow, i) => {
      const row: BulkRowDraft = { ...EMPTY_ROW };
      const notesParts: string[] = [];
      csvHeaders.forEach((header, colIndex) => {
        const target = columnMapping[header];
        const value = (dataRow[colIndex] || '').trim();
        if (!value || target === 'skip' || !target) return;
        if (target === 'notes') notesParts.push(`${header}: ${value}`);
        else (row as unknown as Record<string, string>)[target] = value;
      });
      if (notesParts.length) row.notes = row.notes ? `${row.notes}; ${notesParts.join('; ')}` : notesParts.join('; ');
      return { row, sourceLabel: `Row ${i + 2}` }; // +2: 1-indexed and header row already consumed
    });
  }

  const hasNameOrCompanyMapped = Object.values(columnMapping).some((t) => t === 'name' || t === 'company');

  async function handleConfirmMapping() {
    if (!hasNameOrCompanyMapped) {
      toast.error('Map at least one column to Name or Company — every row needs one or the other.');
      return;
    }
    const mapped = buildRowsFromCsvMapping();
    await runPreview(mapped, 'csv');
  }

  // ---------------------------------------------------------------------
  // Multi-image OCR path
  // ---------------------------------------------------------------------

  async function handleImagesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, 50); // sane upper bound — OCR is slow, not a hard product rule
    setImportType('images');
    setImageJobs(files.map((file) => ({ file, status: 'pending' })));
    setScreen('images-processing');

    const CONCURRENCY = 2;
    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        const i = cursor++;
        const file = files[i];
        setImageJobs((prev) => prev.map((j, idx) => (idx === i ? { ...j, status: 'processing' } : j)));
        try {
          const [preprocessed, uploadRes] = await Promise.all([
            preprocessCardImage(file),
            (async () => {
              const body = new FormData();
              body.append('folder', 'leads');
              body.append('files', file);
              const r = await fetch('/api/uploads', { method: 'POST', body });
              if (!r.ok) throw new Error('upload failed');
              const data: { urls: string[] } = await r.json();
              return data.urls[0] || '';
            })()
          ]);
          const fields = await scanBusinessCard(preprocessed);
          const row: BulkRowDraft = {
            name: fields.name,
            mobile: fields.mobile,
            email: fields.email,
            designation: fields.designation,
            company: fields.company,
            city: fields.city,
            cardImageUrl: uploadRes,
            budget: '',
            notes: ''
          };
          setImageJobs((prev) => prev.map((j, idx) => (idx === i ? { ...j, status: 'ready', row } : j)));
        } catch {
          setImageJobs((prev) => prev.map((j, idx) => (idx === i ? { ...j, status: 'error', error: 'Could not read this image' } : j)));
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  }

  async function handleImagesContinue() {
    setImageJobs((current) => {
      const ready = current.filter((j) => j.status === 'ready' && j.row);
      const mapped = ready.map((j) => ({ row: j.row as BulkRowDraft, sourceLabel: j.file.name }));
      void runPreview(mapped, 'images');
      return current;
    });
  }

  // ---------------------------------------------------------------------
  // Shared preview -> review -> commit
  // ---------------------------------------------------------------------

  async function runPreview(mapped: { row: BulkRowDraft; sourceLabel: string }[], type: 'csv' | 'images') {
    if (mapped.length === 0) {
      toast.error('No rows to import.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/leads/bulk-import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: mapped.map((m) => m.row) })
      });
      if (!response.ok) throw new Error(String(response.status));
      const data: { results: { index: number; row: BulkRowDraft; status: PreviewStatus; reason?: string; existingLead?: PreviewRow['existingLead'] }[] } = await response.json();
      setPreviewRows(
        data.results.map((r) => ({
          index: r.index,
          row: r.row,
          status: r.status,
          reason: r.reason,
          existingLead: r.existingLead,
          selected: r.status !== 'invalid',
          sourceLabel: mapped[r.index]?.sourceLabel || `Row ${r.index + 1}`
        }))
      );
      setImportType(type);
      setScreen('review');
    } catch {
      toast.error('Could not validate these rows. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function toggleRowSelected(index: number) {
    setPreviewRows((prev) => prev.map((r) => (r.index === index ? { ...r, selected: !r.selected } : r)));
  }

  async function handleCommit() {
    const selected = previewRows.filter((r) => r.selected && r.status !== 'invalid');
    if (selected.length === 0) {
      toast.error('Select at least one row to import.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/leads/bulk-import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: selected.map((r) => r.row), importType })
      });
      if (!response.ok) throw new Error(String(response.status));
      const summary: { created: number; merged: number; failed: number } = await response.json();
      setCommitSummary(summary);
      setScreen('done');
      onImportComplete();
    } catch {
      toast.error('Could not complete the import. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setScreen('choose');
    setCsvHeaders([]);
    setCsvDataRows([]);
    setColumnMapping({});
    setImageJobs([]);
    setPreviewRows([]);
    setCommitSummary(null);
  }

  const summaryCounts = {
    total: previewRows.length,
    valid: previewRows.filter((r) => r.status === 'valid').length,
    duplicates: previewRows.filter((r) => r.status === 'duplicate').length,
    invalid: previewRows.filter((r) => r.status === 'invalid').length
  };

  return (
    <div className={historyStyles.wizardCard}>
      {screen === 'choose' && (
        <>
          <h2 className={historyStyles.wizardCardTitle}><Upload size={20} /> Import Leads / Inquiries</h2>
          <div className={historyStyles.wizardCardHint}>Bring in many leads at once from a spreadsheet, or from a batch of business-card photos.</div>
          <div className={`${calcStyles.row} ${styles.choiceRow}`}>
            <button type="button" className={`${calcStyles.sectionPanel} ${styles.choiceCard}`} disabled={busy} onClick={() => csvFileInputRef.current?.click()}>
              <FileSpreadsheet size={22} className={styles.brandIcon} />
              <div className={styles.choiceCardTitle}>{busy ? 'Reading file…' : 'Import CSV / Excel'}</div>
              <div className={calcStyles.small}>Upload a CSV or Excel (.xlsx) spreadsheet of leads — column mapping to MatrixIQ&apos;s fields comes next.</div>
            </button>
            <button type="button" className={`${calcStyles.sectionPanel} ${styles.choiceCard}`} onClick={() => imageFileInputRef.current?.click()}>
              <Images size={22} className={styles.brandIcon} />
              <div className={styles.choiceCardTitle}>Import Multiple Images</div>
              <div className={calcStyles.small}>Select several business-card photos — each one is scanned automatically.</div>
            </button>
          </div>
          <div className={styles.topActions}>
            <a className={historyStyles.button} href="/api/leads/bulk-import/template.csv">
              <Download size={14} className={styles.iconMarginRight} /> Download Sample CSV
            </a>
            <button type="button" className={`${historyStyles.button} ${styles.cancelBtnSpaced}`} onClick={onCancel}>Cancel</button>
          </div>
          <input ref={csvFileInputRef} type="file" accept=".csv,.xlsx,.xls" className={styles.hiddenInput} onChange={(e) => handleCsvSelected(e.target.files?.[0])} />
          <input ref={imageFileInputRef} type="file" accept="image/*" multiple className={styles.hiddenInput} onChange={(e) => handleImagesSelected(e.target.files)} />
        </>
      )}

      {screen === 'csv-map' && (
        <>
          <h2 className={historyStyles.wizardCardTitle}><FileSpreadsheet size={20} /> Map CSV Columns</h2>
          <div className={historyStyles.wizardCardHint}>{csvDataRows.length} record{csvDataRows.length === 1 ? '' : 's'} found. Confirm which column maps to which field — we've guessed based on your headers.</div>
          {!hasNameOrCompanyMapped && (
            <div className={styles.mappingWarning}>
              <AlertTriangle size={16} />
              None of your columns are mapped to Name or Company yet — set at least one below, or every row will be rejected as invalid.
            </div>
          )}
          <table className={`${historyStyles.table} ${styles.mappingTable}`}>
            <thead>
              <tr>
                <th>CSV Column</th>
                <th>Sample Value</th>
                <th>Maps To</th>
              </tr>
            </thead>
            <tbody>
              {csvHeaders.map((header, i) => (
                <tr key={header + i}>
                  <td className={styles.headerCell}>{header}</td>
                  <td className={calcStyles.small}>{csvDataRows[0]?.[i] || '-'}</td>
                  <td>
                    <select
                      className={calcStyles.formControl}
                      value={columnMapping[header] || 'skip'}
                      onChange={(e) => setColumnMapping((prev) => ({ ...prev, [header]: e.target.value as TargetField }))}
                    >
                      {TARGET_FIELD_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.actionsRow16}>
            <button type="button" className={calcStyles.btn} disabled={busy || !hasNameOrCompanyMapped} onClick={handleConfirmMapping}>{busy ? 'Validating...' : 'Preview Records'}</button>
            <button type="button" className={historyStyles.button} onClick={reset}>Back</button>
          </div>
        </>
      )}

      {screen === 'images-processing' && (
        <>
          <h2 className={historyStyles.wizardCardTitle}><Images size={20} /> Processing Images</h2>
          <div className={historyStyles.wizardCardHint}>Scanning each card — this runs in your browser and can take a few seconds per image.</div>
          <div className={styles.jobList}>
            {imageJobs.map((job, i) => (
              <div key={i} className={styles.jobRow}>
                {job.status === 'ready' && <CheckCircle2 size={16} className={styles.successColor} />}
                {job.status === 'error' && <XCircle size={16} className={calcStyles.dangerText} />}
                {(job.status === 'pending' || job.status === 'processing') && <AlertTriangle size={16} className={styles.mutedColor} />}
                <span className={styles.jobFileName}>{job.file.name}</span>
                <span className={calcStyles.small}>
                  {job.status === 'pending' && 'Waiting...'}
                  {job.status === 'processing' && 'Processing...'}
                  {job.status === 'ready' && `Ready — ${job.row?.name || job.row?.company || 'no name detected'}`}
                  {job.status === 'error' && (job.error || 'Could not read')}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.actionsRow16}>
            <button
              type="button"
              className={calcStyles.btn}
              disabled={busy || imageJobs.some((j) => j.status === 'pending' || j.status === 'processing')}
              onClick={handleImagesContinue}
            >
              {busy ? 'Validating...' : `Continue with ${imageJobs.filter((j) => j.status === 'ready').length} card(s)`}
            </button>
            <button type="button" className={historyStyles.button} onClick={reset}>Cancel</button>
          </div>
        </>
      )}

      {screen === 'review' && (
        <>
          <h2 className={historyStyles.wizardCardTitle}><CheckCircle2 size={20} /> Preview &amp; Confirm</h2>
          <div className={`${calcStyles.row} ${styles.summaryRow}`}>
            <div className={`${calcStyles.sectionPanel} ${styles.summaryTile}`}>
              <div className={styles.summaryTileValue}>{summaryCounts.total}</div>
              <div className={calcStyles.small}>Total Records</div>
            </div>
            <div className={`${calcStyles.sectionPanel} ${styles.summaryTile}`}>
              <div className={styles.summaryTileValueSuccess}>{summaryCounts.valid}</div>
              <div className={calcStyles.small}>Valid</div>
            </div>
            <div className={`${calcStyles.sectionPanel} ${styles.summaryTile}`}>
              <div className={styles.summaryTileValueWarning}>{summaryCounts.duplicates}</div>
              <div className={calcStyles.small}>Duplicates</div>
            </div>
            <div className={`${calcStyles.sectionPanel} ${styles.summaryTile}`}>
              <div className={styles.summaryTileValueDanger}>{summaryCounts.invalid}</div>
              <div className={calcStyles.small}>Invalid</div>
            </div>
          </div>
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr>
                  <th></th>
                  <th>Source</th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Mobile</th>
                  <th>Email</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r) => (
                  <tr key={r.index}>
                    <td>
                      <input type="checkbox" checked={r.selected} disabled={r.status === 'invalid'} onChange={() => toggleRowSelected(r.index)} />
                    </td>
                    <td className={calcStyles.small}>{r.sourceLabel}</td>
                    <td>{r.row.name || '-'}</td>
                    <td>{r.row.company || '-'}</td>
                    <td>{r.row.mobile || '-'}</td>
                    <td>{r.row.email || '-'}</td>
                    <td>
                      {r.status === 'valid' && <span className={`${historyStyles.statusBadge} ${styles.statusBadgeValid}`}>Ready</span>}
                      {r.status === 'duplicate' && (
                        <span title={r.reason} className={`${historyStyles.statusBadge} ${styles.statusBadgeDuplicate}`}>
                          Duplicate — will merge into {r.existingLead?.name || r.existingLead?.company || 'existing lead'}
                        </span>
                      )}
                      {r.status === 'invalid' && (
                        <span title={r.reason} className={`${historyStyles.statusBadge} ${styles.statusBadgeInvalid}`}>
                          {r.reason || 'Invalid'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actionsRow16}>
            <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleCommit}>
              {busy ? 'Importing...' : `Import ${previewRows.filter((r) => r.selected && r.status !== 'invalid').length} Record(s)`}
            </button>
            <button type="button" className={historyStyles.button} onClick={reset}>Start Over</button>
          </div>
        </>
      )}

      {screen === 'done' && commitSummary && (
        <div className={historyStyles.successPanel}>
          <div className={historyStyles.successIcon}><CheckCircle2 size={48} /></div>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2NoAccent}`}>Import Complete</h2>
          <div className={calcStyles.small}>
            {commitSummary.created} new lead{commitSummary.created === 1 ? '' : 's'} created
            {commitSummary.merged > 0 && `, ${commitSummary.merged} merged into existing lead${commitSummary.merged === 1 ? '' : 's'}`}
            {commitSummary.failed > 0 && `, ${commitSummary.failed} skipped`}.
          </div>
          <div className={historyStyles.successActions}>
            <button type="button" className={historyStyles.bigBtn} onClick={onCancel}>View All Leads</button>
            <button type="button" className={historyStyles.bigBtnGhost} onClick={reset}>Import More</button>
          </div>
        </div>
      )}
    </div>
  );
}
