'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BRAND } from '@/lib/branding';
import styles from '@/components/quotationHistory.module.css';

export default function Error({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={styles.body} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <Image src={BRAND.logo} alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />
          <div>
            <h1>{BRAND.appName}</h1>
            <div className={styles.sub}>{BRAND.tagline}</div>
          </div>
        </div>
      </header>
      <main className={styles.main} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
        <div style={{ fontSize: 64, fontWeight: 800, color: '#dc2626' }}>500</div>
        <h2 style={{ margin: 0 }}>Something went wrong</h2>
        <p style={{ color: '#6b7280', maxWidth: 420 }}>An unexpected error occurred. You can try again, or head back to the dashboard.</p>
        {error.digest && <p style={{ color: '#9ca3af', fontSize: 12 }}>Reference: {error.digest}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => unstable_retry()}>
            Try again
          </button>
          <Link href="/" className={styles.button}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
