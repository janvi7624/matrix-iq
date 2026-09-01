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
    <div className={`${styles.body} ${styles.fullPageColumn}`}>
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <Image src={BRAND.logo} alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />
          <div>
            <h1>{BRAND.appName}</h1>
            <div className={styles.sub}>{BRAND.tagline}</div>
          </div>
        </div>
      </header>
      <main className={`${styles.main} ${styles.centeredMain}`}>
        <div className={styles.errorCode}>500</div>
        <h2 className={styles.errorHeading}>Something went wrong</h2>
        <p className={styles.errorBody}>An unexpected error occurred. You can try again, or head back to the dashboard.</p>
        {error.digest && <p className={styles.errorReference}>Reference: {error.digest}</p>}
        <div className={styles.errorActionsRow}>
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
