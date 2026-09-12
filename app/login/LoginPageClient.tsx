'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import visualStyles from '@/components/auth/matrixLoginVisual.module.css';
import MatrixLoginVisual from '@/components/auth/MatrixLoginVisual';
import { BRAND } from '@/lib/branding';

// The form's fields/ids/validation/error handling/auth call are untouched
// from the original pre-redesign version — only the surrounding shell (now
// a full-page animated background with this card floating centered and
// transparent on top of it, instead of a side-by-side split) and the class
// names feeding its transparent/glassmorphic look are new. See
// components/auth/MatrixLoginVisual.tsx for the animated background.
function LoginForm() {
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Controlled validation instead of the browser's native required-field
    // popup — that popup is anchored to whichever field is invalid, not to
    // this glassmorphic card, and behaves inconsistently across browsers on
    // a full-viewport fixed layout like this one. Uses the same .formError
    // slot as the fetch's own errors below.
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }
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
    <div className={visualStyles.pageRoot}>
      <MatrixLoginVisual />
      <div className={visualStyles.centerWrap}>
        <form className={visualStyles.formCard} onSubmit={handleSubmit} noValidate>
          <Image src={BRAND.logo} alt={`${BRAND.companyName} logo`} width={96} height={96} className={visualStyles.formLogo} unoptimized />
          <h1>{BRAND.appName}</h1>
          <span className={visualStyles.formSub}>
            {BRAND.tagline}
            <br />
            Sign in with your username and password to continue.
          </span>
          <div
            className={`${visualStyles.formError} ${error ? visualStyles.formErrorVisible : ''}`}
            role="alert"
            aria-hidden={!error}
          >
            {error}
          </div>
          <div className={visualStyles.formField}>
            <label htmlFor="loginUsername">Username</label>
            <input id="loginUsername" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className={visualStyles.formField}>
            <label htmlFor="loginPassword">Password</label>
            <div className={visualStyles.formPasswordWrap}>
              <input
                id="loginPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className={visualStyles.formPasswordToggle}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          <button type="submit" className={visualStyles.formSubmit} disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPageClient() {
  return (
    <Suspense fallback={<div className={visualStyles.pageRoot} />}>
      <LoginForm />
    </Suspense>
  );
}
