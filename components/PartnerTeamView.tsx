'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import PartnerShell from './PartnerShell';
import { useToast } from './ui/ToastProvider';
import { PARTNER_ROLE_LABEL } from '@/lib/partnerRoles';
import calcStyles from './calculator.module.css';
import styles from './partnerProfile.module.css';

interface TeamUser {
  id: string;
  username: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string;
}

interface Props {
  companyName: string;
  partnerCode: string;
  /** So the one row the API refuses to change is also non-interactive here. */
  currentUserId: string;
}

const BLANK = { username: '', name: '', email: '', phone: '', role: 'partner-user' };

export default function PartnerTeamView({ companyName, partnerCode, currentUserId }: Props) {
  const toast = useToast();
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [failed, setFailed] = useState('');
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  // Shown until dismissed, not as a toast: this is the only time the password
  // is ever visible, and it has to be passed on to the colleague by hand.
  const [issued, setIssued] = useState<{ name: string; username: string; tempPassword: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/team');
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setFailed(body?.error || 'Could not load your team.');
      setUsers([]);
      return;
    }
    setFailed('');
    setUsers(body.users || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function set(key: keyof typeof BLANK, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/partner/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error || 'Could not create the login.');
        return;
      }
      setIssued({ name: form.name, username: form.username, tempPassword: body.tempPassword });
      setForm(BLANK);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function patch(user: TeamUser, change: { status?: 'active' | 'inactive'; resetPassword?: boolean }) {
    setBusyId(user.id);
    try {
      const res = await fetch('/api/partner/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, ...change })
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error || 'Could not update that login.');
        return;
      }
      if (body.tempPassword) {
        setIssued({ name: user.name, username: user.username, tempPassword: body.tempPassword });
      } else {
        toast.success(change.status === 'inactive' ? `${user.name} can no longer sign in.` : `${user.name} can sign in again.`);
      }
      await load();
    } finally {
      setBusyId('');
    }
  }

  return (
    <PartnerShell
      title="Team Logins"
      subtitle="Portal accounts for your own colleagues."
      partnerName={companyName}
      partnerCode={partnerCode}
    >
      {failed && <div className={calcStyles.sectionPanel}><p className={calcStyles.small}>{failed}</p></div>}

      {issued && (
        <div className={calcStyles.sectionPanel}>
          <h2 className={calcStyles.h2}>Share this password with {issued.name}</h2>
          <p className={calcStyles.small}>
            Username <strong>{issued.username}</strong> · temporary password <strong>{issued.tempPassword}</strong>
          </p>
          <p className={calcStyles.small}>
            They will be asked to set their own password when they first sign in. This is the only time it is shown —
            if it is lost, use “Reset password” below.
          </p>
          <button type="button" className={calcStyles.btn} onClick={() => setIssued(null)}>
            Done — I have shared it
          </button>
        </div>
      )}

      <form className={calcStyles.sectionPanel} onSubmit={submit}>
        <h2 className={calcStyles.h2}>Add a colleague</h2>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="name">Full name</label>
            <input id="name" className={calcStyles.formControl} value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="username">Username</label>
            <input id="username" className={calcStyles.formControl} value={form.username} onChange={(e) => set('username', e.target.value)} required />
          </div>
        </div>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="email">Email</label>
            <input id="email" type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => set('email', e.target.value)} required />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="phone">Phone (optional)</label>
            <input id="phone" className={calcStyles.formControl} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label} htmlFor="role">Access level</label>
          <select id="role" className={calcStyles.formControl} value={form.role} onChange={(e) => set('role', e.target.value)}>
            <option value="partner-user">{PARTNER_ROLE_LABEL['partner-user'] || 'Partner User'}</option>
            <option value="partner-admin">{PARTNER_ROLE_LABEL['partner-admin'] || 'Partner Admin'}</option>
          </select>
          <p className={calcStyles.small}>A Partner Admin can also manage these logins.</p>
        </div>
        <button type="submit" className={calcStyles.btn} disabled={saving}>
          {saving ? 'Creating…' : 'Create login'}
        </button>
      </form>

      <div className={calcStyles.sectionPanel}>
        <h2 className={calcStyles.h2}>Your team</h2>
        {!users ? (
          <p className={calcStyles.small}>Loading…</p>
        ) : users.length === 0 ? (
          <p className={calcStyles.small}>No logins yet.</p>
        ) : (
          users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <div key={u.id} className={styles.teamRow}>
                <dl className={styles.readOnlyFacts}>
                  <div className={styles.readOnlyFact}>
                    <dt className={styles.readOnlyLabel}>Name</dt>
                    <dd className={styles.readOnlyValue}>{u.name}{isSelf ? ' (you)' : ''}</dd>
                  </div>
                  <div className={styles.readOnlyFact}>
                    <dt className={styles.readOnlyLabel}>Username</dt>
                    <dd className={styles.readOnlyValue}>{u.username}</dd>
                  </div>
                  <div className={styles.readOnlyFact}>
                    <dt className={styles.readOnlyLabel}>Email</dt>
                    <dd className={styles.readOnlyValue}>{u.email || '—'}</dd>
                  </div>
                  <div className={styles.readOnlyFact}>
                    <dt className={styles.readOnlyLabel}>Access</dt>
                    <dd className={styles.readOnlyValue}>{PARTNER_ROLE_LABEL[u.role] || u.role}</dd>
                  </div>
                  <div className={styles.readOnlyFact}>
                    <dt className={styles.readOnlyLabel}>Status</dt>
                    <dd className={styles.readOnlyValue}>
                      {u.status === 'active' ? 'Active' : 'No access'}
                      {u.mustChangePassword ? ' · password not set yet' : ''}
                    </dd>
                  </div>
                  <div className={styles.readOnlyFact}>
                    <dt className={styles.readOnlyLabel}>Last sign-in</dt>
                    <dd className={styles.readOnlyValue}>
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                    </dd>
                  </div>
                </dl>
                {/* Your own row has no controls: the API refuses both actions
                    on yourself, so offering them would only produce an error. */}
                {!isSelf && (
                  <div className={styles.teamActions}>
                    <button
                      type="button"
                      className={calcStyles.btnSecondary || calcStyles.btn}
                      disabled={busyId === u.id}
                      onClick={() => void patch(u, { resetPassword: true })}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className={calcStyles.btnSecondary || calcStyles.btn}
                      disabled={busyId === u.id}
                      onClick={() => void patch(u, { status: u.status === 'active' ? 'inactive' : 'active' })}
                    >
                      {u.status === 'active' ? 'Remove access' : 'Restore access'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </PartnerShell>
  );
}
