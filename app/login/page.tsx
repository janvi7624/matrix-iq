'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import styles from '@/components/quotationHistory.module.css';
import { BRAND } from '@/lib/branding';

function LoginForm() {
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error || 'Invalid username or password.');
        return;
      }
      // Hard navigation, not router.push()+refresh() — a client-side push
      // here is an RSC fetch, and if proxy.ts's mustChangePassword gate
      // redirects it (temp-password accounts get sent to /change-password
      // instead of `next`), the redirected request still carries RSC
      // headers, so the server returns raw flight-payload text instead of
      // rendered HTML. A full navigation always gets real HTML back.
      const next = searchParams.get('next') || '/';
      window.location.href = next;
    } catch {
      setError('Could not reach the login API.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.loginWrap}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <Image src={BRAND.logo} alt={`${BRAND.companyName} logo`} width={96} height={96} className={styles.loginLogo} unoptimized />
        <h1>{BRAND.appName}</h1>
        <span className={styles.sub}>
          {BRAND.tagline}
          <br />
          Sign in with your username and password to continue.
        </span>
        {error && <div className={styles.loginError}>{error}</div>}
        <div className={styles.loginField}>
          <label htmlFor="loginUsername">Username</label>
          <input id="loginUsername" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </div>
        <div className={styles.loginField}>
          <label htmlFor="loginPassword">Password</label>
          <input id="loginPassword" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button type="submit" className={styles.loginSubmit} disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className={styles.loginWrap} />}>
      <LoginForm />
    </Suspense>
  );
}
