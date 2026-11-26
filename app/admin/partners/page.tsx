'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { PartnerRecord, PartnerStatus } from '@/lib/types';
import { PROJECT_DEPARTMENTS, PROJECT_DEPARTMENT_LABEL } from '@/lib/projectDepartmentOptions';
import AppShell from '@/components/AppShell';
import CommonButton from '@/components/ui/CommonButton';
import StateCitySelect from '@/components/ui/StateCitySelect';
import SearchInput from '@/components/ui/SearchInput';
import Dropdown, { inSelection } from '@/components/ui/Dropdown';
import PartnerGuideModal, { usePartnerGuideAutoShow } from '@/components/PartnerGuideModal';
import guideStyles from '@/components/partnerGuideModal.module.css';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import pageStyles from './partnersPage.module.css';
import { fetchCached } from '@/lib/fetchCached';
import { SkeletonTable } from '@/components/ui/Skeleton';
import Select from '@/components/ui/Select';

const STATUS_LABEL: Record<PartnerStatus, string> = {
  pending: 'Pending setup',
  active: 'Active',
  suspended: 'Suspended',
  inactive: 'Inactive'
};

function statusClass(status: PartnerStatus): string {
  if (status === 'active') return historyStyles.statusPillActive;
  if (status === 'pending') return pageStyles.statusPillPending;
  if (status === 'suspended') return pageStyles.statusPillSuspended;
  return historyStyles.statusPillInactive;
}

export default function PartnerManagementPage() {
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<PartnerStatus[]>([]);
  const [users, setUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showForm, setShowForm] = useState(false);
  // Shows once per browser, and stays reachable afterwards from the link
  // below — same arrangement as TMS.
  const [autoShowGuide, dismissAutoGuide] = usePartnerGuideAutoShow('internal');
  const [showGuide, setShowGuide] = useState(false);

  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    gst_number: '',
    relationship_manager_id: '',
    departments: [] as string[]
  });

  // No synchronous setState here: the initial `status` already reads
  // "Loading...", and every re-load follows a user action that has already
  // repainted. Setting it at the top of this function would fire a cascading
  // render straight out of the mount effect below.
  async function load() {
    try {
      const response = await fetch('/api/admin/partners');
      if (!response.ok) throw new Error(String(response.status));
      const data: PartnerRecord[] = await response.json();
      setPartners(data);
      setStatus(data.length ? `${data.length} partner${data.length === 1 ? '' : 's'}.` : 'No partners yet. Add the first one above.');
    } catch {
      setStatus('Could not load partners. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
    fetchCached('/api/users/lite')
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return partners.filter((p) => {
      if (!inSelection(p.status, statusFilter)) return false;
      if (!needle) return true;
      return (
        p.company_name.toLowerCase().includes(needle) ||
        p.partner_code.toLowerCase().includes(needle) ||
        p.contact_person.toLowerCase().includes(needle) ||
        p.city.toLowerCase().includes(needle)
      );
    });
  }, [partners, q, statusFilter]);

  function toggleDepartment(key: string) {
    setForm((prev) => ({
      ...prev,
      departments: prev.departments.includes(key) ? prev.departments.filter((d) => d !== key) : [...prev.departments, key]
    }));
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const response = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setCreateError(body?.error || 'Could not add partner.');
        return;
      }
      setForm({ company_name: '', contact_person: '', email: '', phone: '', city: '', state: '', gst_number: '', relationship_manager_id: '', departments: [] });
      setShowForm(false);
      await load();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell fillPage={!showForm} title="Partner Management" subtitle="Sales › channel partners, distributors and dealers who collaborate with us through MatrixIQ.">
      <div className={guideStyles.guideLinkRow}>
        <CommonButton variant="link" size="sm" onClick={() => setShowGuide(true)}>
          How Partner Management Works
        </CommonButton>
      </div>
      {(autoShowGuide || showGuide) && (
        <PartnerGuideModal
          audience="internal"
          onClose={() => {
            dismissAutoGuide();
            setShowGuide(false);
          }}
        />
      )}
      <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Add partner</h2>
      {!showForm ? (
        <div className={calcStyles.sectionPanel}>
          <p className={calcStyles.small}>
            Creating a partner records the company only. Issue their login from the partner&apos;s own page — the account stays
            in <strong>Pending setup</strong> until you do, and partners can never register themselves.
          </p>
          <CommonButton variant="primary" size="md" leadingIcon={<Plus />} onClick={() => setShowForm(true)}>New partner</CommonButton>
        </div>
      ) : (
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          {createError && <div className={historyStyles.loginError}>{createError}</div>}
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="companyName">Company name *</label>
              <input id="companyName" className={calcStyles.formControl} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="contactPerson">Contact person</label>
              <input id="contactPerson" className={calcStyles.formControl} value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerEmail">Email</label>
              <input id="partnerEmail" type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerPhone">Phone</label>
              <input id="partnerPhone" className={calcStyles.formControl} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <StateCitySelect
              state={form.state}
              city={form.city}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
              idPrefix="partner"
            />
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerGst">GST number</label>
              <input id="partnerGst" className={calcStyles.formControl} value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerRm">Relationship manager</label>
              <Select id="partnerRm" value={form.relationship_manager_id} onChange={(e) => setForm({ ...form, relationship_manager_id: e.target.value })}>
                <option value="">Not assigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.username}</option>
                ))}
              </Select>
            </div>
            <div className={calcStyles.field}>
              <span className={calcStyles.label}>Departments</span>
              <div className={pageStyles.actionsRow}>
                {PROJECT_DEPARTMENTS.map((d) => (
                  <label key={d} className={calcStyles.small}>
                    <input type="checkbox" checked={form.departments.includes(d)} onChange={() => toggleDepartment(d)} /> {PROJECT_DEPARTMENT_LABEL[d]}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className={pageStyles.actionsRow}>
            <CommonButton type="submit" variant="primary" size="md" disabled={creating}>{creating ? 'Adding...' : 'Add partner'}</CommonButton>
            <CommonButton variant="secondary" size="md" onClick={() => { setShowForm(false); setCreateError(''); }}>Cancel</CommonButton>
          </div>
        </form>
      )}

      <h2 className={calcStyles.h2}>Partners</h2>
      <div className={historyStyles.toolbar}>
        <SearchInput placeholder="Search by company, code, contact or city..." value={q} onChange={(v) => setQ(v)} />
        <Dropdown<PartnerStatus>
          multiple
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All statuses"
          label="Status"
          options={(Object.keys(STATUS_LABEL) as PartnerStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        />
      </div>
      {status === 'Loading...' ? (
        <SkeletonTable rows={6} columns={7} />
      ) : (
      <>
      <div className={historyStyles.status}>{status}</div>
      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Company</th>
              <th>Contact</th>
              <th>Location</th>
              <th>Relationship manager</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id}>
                <td className={pageStyles.codeCell}>{p.partner_code}</td>
                <td>{p.company_name}</td>
                <td>{p.contact_person || <span className={pageStyles.muted}>-</span>}</td>
                <td>{[p.city, p.state].filter(Boolean).join(', ') || <span className={pageStyles.muted}>-</span>}</td>
                <td>{p.relationship_manager_name || <span className={pageStyles.muted}>Not assigned</span>}</td>
                <td>
                  <span className={`${historyStyles.statusPill} ${statusClass(p.status)}`}>{STATUS_LABEL[p.status]}</span>
                </td>
                <td>
                  <CommonButton variant="secondary" size="sm" href={`/admin/partners/${p.id}`}>Open</CommonButton>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className={pageStyles.muted}>
                  {partners.length ? 'No partners match this filter.' : 'No partners yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}
    </AppShell>
  );
}
