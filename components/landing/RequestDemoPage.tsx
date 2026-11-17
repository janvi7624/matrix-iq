'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock, Mail, Phone, Sparkles } from 'lucide-react';
import { BRAND } from '@/lib/branding';
import { INTEREST_OPTIONS, SITE, TEAM_SIZE_OPTIONS } from '@/lib/landingContent';
import { SiteFooter } from './LandingPage';
import base from './landing.module.css';
import styles from './requestDemo.module.css';

const EMPTY = {
  name: '',
  company: '',
  designation: '',
  mobile: '',
  email: '',
  city: '',
  teamSize: '',
  interests: [] as string[],
  preferredDate: '',
  message: '',
  consent: false,
  website: '' // honeypot
};

export default function RequestDemoPage() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/public/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(data.fields || {});
        setError(data.error || 'Could not send your request.');
        return;
      }
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError('Could not reach the server. Please call or email us.');
    } finally {
      setBusy(false);
    }
  }

  const field = (k: 'name' | 'company' | 'designation' | 'mobile' | 'email' | 'city', label: string, opts: { required?: boolean; type?: string; auto?: string; placeholder?: string } = {}) => (
    <label className={styles.field}>
      <span>{label}{opts.required && <em> *</em>}</span>
      <input
        type={opts.type || 'text'}
        autoComplete={opts.auto}
        placeholder={opts.placeholder}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={!!errors[k]}
        className={errors[k] ? styles.invalid : ''}
        required={opts.required}
      />
      {errors[k] && <small className={styles.err}>{errors[k]}</small>}
    </label>
  );

  return (
    <div className={base.page}>
      <header className={`${base.header} ${base.headerScrolled}`}>
        <Link href="/" className={base.brand} aria-label={`${BRAND.appName} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.iconMark} alt="" width={30} height={30} />
          <span>Matrix<b>IQ</b></span>
        </Link>
        <div className={base.headerCtas} style={{ marginLeft: 'auto' }}>
          <Link href="/login" className={base.ghostBtn}>Login</Link>
        </div>
      </header>

      <main className={styles.main}>
        <div className={base.glowA} aria-hidden />
        <div className={styles.layout}>
          <aside className={styles.aside}>
            <Link href="/" className={styles.back}><ArrowLeft size={16} /> Back to home</Link>
            <span className={base.badge}><Sparkles size={14} /> Free walkthrough</span>
            <h1 className={styles.title}>See MatrixIQ on <span>your</span> workflow.</h1>
            <p className={styles.lead}>Tell us a little about your team. We will map your sales, delivery and back-office process onto MatrixIQ — live, in about 30 minutes.</p>
            <ul className={styles.perks}>
              <li><CheckCircle2 size={18} /> Personalised to your departments</li>
              <li><CheckCircle2 size={18} /> AI lead intelligence, quotations, projects, HR & accounts</li>
              <li><Clock size={18} /> We reply within one working day</li>
            </ul>
            <div className={styles.contact}>
              <a href={SITE.phoneHref}><Phone size={16} /> {SITE.phoneDisplay}</a>
              <a href={`mailto:${SITE.email}`}><Mail size={16} /> {SITE.email}</a>
            </div>
          </aside>

          <section className={styles.card} aria-live="polite">
            {done ? (
              <div className={styles.done}>
                <CheckCircle2 size={56} />
                <h2>Request received!</h2>
                <p>Thank you, {form.name.split(' ')[0]}. Our team will contact you shortly to fix a time. A confirmation is on its way to <strong>{form.email}</strong>.</p>
                <div className={base.heroCtas} style={{ justifyContent: 'center' }}>
                  <Link href="/" className={base.ghostBtnLg}>Back to home</Link>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <h2 className={styles.formTitle}>Request a demo</h2>
                <div className={styles.grid}>
                  {field('name', 'Full name', { required: true, auto: 'name' })}
                  {field('company', 'Company', { required: true, auto: 'organization' })}
                  {field('mobile', 'Mobile', { required: true, type: 'tel', auto: 'tel', placeholder: '+91' })}
                  {field('email', 'Work email', { required: true, type: 'email', auto: 'email' })}
                  {field('designation', 'Designation', { auto: 'organization-title' })}
                  {field('city', 'City', { auto: 'address-level2' })}
                  <label className={styles.field}>
                    <span>Team size</span>
                    <select value={form.teamSize} onChange={(e) => set('teamSize', e.target.value)}>
                      <option value="">Select…</option>
                      {TEAM_SIZE_OPTIONS.map((t) => <option key={t} value={t}>{t} people</option>)}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Preferred demo date</span>
                    <input type="date" value={form.preferredDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set('preferredDate', e.target.value)} />
                  </label>
                </div>

                <fieldset className={styles.interests}>
                  <legend>What would you like to see?</legend>
                  <div className={styles.chips}>
                    {INTEREST_OPTIONS.map((o) => {
                      const on = form.interests.includes(o);
                      return (
                        <label key={o} className={`${styles.chip} ${on ? styles.chipOn : ''}`}>
                          <input type="checkbox" checked={on} onChange={() => set('interests', on ? form.interests.filter((x) => x !== o) : [...form.interests, o])} />
                          {on ? '✓' : '+'} {o}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <label className={styles.field}>
                  <span>Anything we should know?</span>
                  <textarea rows={3} value={form.message} onChange={(e) => set('message', e.target.value)} placeholder="Your current tools, team structure, what slows you down…" />
                </label>

                {/* Honeypot — hidden from people, filled by bots. */}
                <label className={styles.hp} aria-hidden>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
                </label>

                <label className={styles.consent}>
                  <input type="checkbox" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
                  <span>I agree to be contacted by {SITE.company} about MatrixIQ.</span>
                </label>
                {errors.consent && <small className={styles.err}>{errors.consent}</small>}

                {error && <p className={styles.formError} role="alert">{error}</p>}

                <button type="submit" className={`${base.primaryBtnLg} ${styles.submit}`} disabled={busy}>
                  {busy ? 'Sending…' : 'Request my demo'}
                </button>
              </form>
            )}
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
