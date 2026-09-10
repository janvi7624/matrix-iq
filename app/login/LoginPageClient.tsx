'use client';

import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import visualStyles from '@/components/auth/matrixLoginVisual.module.css';
import MatrixLoginVisual from '@/components/auth/MatrixLoginVisual';
import { BRAND } from '@/lib/branding';

interface DodgePosition { top: number; left: number; width: number; height: number }

// How close the cursor can get (px, from the button's center) before it
// teleports away — and how far the new spot must land from the cursor so
// the jump actually reads as an escape instead of a tiny nudge.
const DODGE_TRIGGER_RADIUS = 90;
const DODGE_MIN_LANDING_DISTANCE = 220;
// Kept a bit longer than the .formSubmit CSS transition's own 0.38s so a
// fast chase can't re-trigger a jump before the current slide finishes —
// that would cut the animation short and read as jittery instead of smooth.
const DODGE_THROTTLE_MS = 400;

function pickDodgeSpot(mouseX: number, mouseY: number, width: number, height: number): DodgePosition {
  const margin = 16;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  let left = margin;
  let top = margin;
  for (let attempt = 0; attempt < 12; attempt++) {
    left = margin + Math.random() * (maxLeft - margin);
    top = margin + Math.random() * (maxTop - margin);
    const dist = Math.hypot(left + width / 2 - mouseX, top + height / 2 - mouseY);
    if (dist >= DODGE_MIN_LANDING_DISTANCE) break;
  }
  return { top, left, width, height };
}

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
  const [dodgePos, setDodgePos] = useState<DodgePosition | null>(null);
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const lastDodgeAtRef = useRef(0);

  // Deliberately playful/punitive: while credentials are blank or the last
  // attempt failed, the Sign In button flees the cursor instead of sitting
  // still — only once both fields have something in them AND there's no
  // outstanding error does it stop moving and become clickable normally.
  const shouldDodge = !busy && (!username.trim() || !password.trim() || !!error);
  // True only once it's actually jumped away at least once (a proximity
  // trigger, not just shouldDodge alone) — governs both the button's own
  // fixed positioning/glow and the ghost placeholder left in its old spot,
  // so the two never show at the same time as each other or duplicate.
  const isAwayDodging = shouldDodge && !!dodgePos;

  useEffect(() => {
    // No setDodgePos(null) reset here — the style below only ever applies
    // dodgePos while shouldDodge is true (see the button's style prop), so
    // a stale position from a previous dodge spell is simply never read
    // once it ends, without needing an effect-driven state reset.
    if (!shouldDodge) return;

    function handleMove(event: MouseEvent) {
      const btn = submitBtnRef.current;
      if (!btn) return;
      const now = performance.now();
      if (now - lastDodgeAtRef.current < DODGE_THROTTLE_MS) return;
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (Math.hypot(event.clientX - cx, event.clientY - cy) < DODGE_TRIGGER_RADIUS) {
        lastDodgeAtRef.current = now;
        setDodgePos(pickDodgeSpot(event.clientX, event.clientY, rect.width, rect.height));
      }
    }

    // Re-clamp into view on resize so a jump made at a wider viewport never
    // strands the button off-screen after the window shrinks.
    function handleResize() {
      setDodgePos((prev) => {
        if (!prev) return prev;
        const margin = 16;
        return {
          ...prev,
          left: Math.min(prev.left, Math.max(margin, window.innerWidth - prev.width - margin)),
          top: Math.min(prev.top, Math.max(margin, window.innerHeight - prev.height - margin))
        };
      });
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('resize', handleResize);
    };
  }, [shouldDodge]);

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
          {error && (
            <div className={visualStyles.formError} role="alert">
              {error}
            </div>
          )}
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
          {/* Left behind in the button's normal slot while it's off
              dodging elsewhere — a "target lost" outline instead of the
              dead empty gap a plain removal would leave, and instead of
              an apologetic caption explaining the gag in words. */}
          {isAwayDodging && <div className={visualStyles.dodgeGhost} aria-hidden="true" />}
          <button
            ref={submitBtnRef}
            type="submit"
            className={`${visualStyles.formSubmit} ${isAwayDodging ? visualStyles.formSubmitDodging : ''}`}
            disabled={busy}
            style={isAwayDodging && dodgePos ? { position: 'fixed', top: dodgePos.top, left: dodgePos.left, width: dodgePos.width, height: dodgePos.height, margin: 0, zIndex: 50 } : undefined}
          >
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
