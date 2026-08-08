'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import styles from '@/components/quotationHistory.module.css';
import { BRAND } from '@/lib/branding';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error || 'Could not change password.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.loginWrap}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <Image src={BRAND.logo} alt={`${BRAND.companyName} logo`} width={96} height={96} className={styles.loginLogo} unoptimized />
        <h1>Change Password</h1>
        <span className={styles.sub}>
          For your security, you must set a new password before continuing.
        </span>
        {error && <div className={styles.loginError}>{error}</div>}
        <div className={styles.loginField}>
          <label htmlFor="currentPassword">Current (temporary) password</label>
          <input id="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoFocus />
        </div>
        <div className={styles.loginField}>
          <label htmlFor="newPassword">New password</label>
          <input id="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} required />
        </div>
        <div className={styles.loginField}>
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input id="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} required />
        </div>
        <button type="submit" className={styles.loginSubmit} disabled={busy}>
          {busy ? 'Updating...' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
