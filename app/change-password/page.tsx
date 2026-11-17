'use client';

import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import base from '@/components/landing/landing.module.css';
import visualStyles from '@/components/auth/matrixLoginVisual.module.css';
import MatrixLoginVisual from '@/components/auth/MatrixLoginVisual';
import { BRAND } from '@/lib/branding';

// First-login (and any forced) password change. Same shell, animated
// background and glass card as the login page (app/login/LoginPageClient.tsx)
// so the hand-off from "sign in" to "set your password" reads as one flow.
// The validation and API call are unchanged.

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={visualStyles.formField}>
      <label htmlFor={id}>{label}</label>
      <div className={visualStyles.formPasswordWrap}>
        <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
        <button
          type="button"
          className={visualStyles.formPasswordToggle}
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please fill in all three fields.');
      return;
    }
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
      // A hard navigation, not router.push()+refresh() — the new session
      // cookie (mustChangePassword now cleared) is already set by the
      // response above, but immediately following push() with refresh()
      // races the App Router's in-flight navigation and can leave this
      // page mounted instead of completing the transition to "/". A full
      // reload sidesteps that entirely and guarantees the next request is
      // gated by proxy.ts using the fresh cookie.
      window.location.href = '/';
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${base.page} ${visualStyles.pageRoot}`}>
      <MatrixLoginVisual />
      {/* Brand only — no public-site links: this screen must be completed before anything else. */}
      <header className={base.header}>
        <span className={base.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.iconMark} alt="" width={30} height={30} />
          <span>Matrix<b>IQ</b></span>
        </span>
      </header>
      <div className={visualStyles.centerWrap}>
        <form className={visualStyles.formCard} onSubmit={handleSubmit} noValidate>
          <Image src={BRAND.logoWeb} alt={`${BRAND.companyName} logo`} width={96} height={96} className={visualStyles.formLogo} unoptimized />
          <h1>Set a new password</h1>
          <span className={visualStyles.formSub}>
            For your security, choose your own password before continuing.
            <br />
            Use the temporary password you were given as the current password.
          </span>
          <div className={`${visualStyles.formError} ${error ? visualStyles.formErrorVisible : ''}`} role="alert" aria-hidden={!error}>
            {error}
          </div>
          <PasswordField id="currentPassword" label="Current (temporary) password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" autoFocus />
          <PasswordField id="newPassword" label="New password (min. 6 characters)" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField id="confirmPassword" label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          <button type="submit" className={visualStyles.formSubmit} disabled={busy}>
            {busy ? 'Updating...' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
