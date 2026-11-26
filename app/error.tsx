'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { LayoutDashboard, RotateCcw } from 'lucide-react';
import { BRAND } from '@/lib/branding';
import styles from '@/components/quotationHistory.module.css';
import CommonHeader from '@/components/ui/CommonHeader';
import CommonButton from '@/components/ui/CommonButton';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={`${styles.body} ${styles.fullPageColumn}`}>
      <CommonHeader
        title={BRAND.appName}
        subtitle={BRAND.tagline}
        showBackButton={false}
        reserveNavToggleSpace={false}
        brand={<Image src={BRAND.logoWeb} alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />}
      />
      <main className={`${styles.main} ${styles.centeredMain}`}>
        <div className={styles.errorCode}>500</div>
        <h2 className={styles.errorHeading}>Something went wrong</h2>
        <p className={styles.errorBody}>An unexpected error occurred. You can try again, or head back to the dashboard.</p>
        {error.digest && <p className={styles.errorReference}>Reference: {error.digest}</p>}
        <div className={styles.errorActionsRow}>
          <CommonButton variant="primary" leadingIcon={<RotateCcw />} onClick={() => reset()}>
            Try again
          </CommonButton>
          <CommonButton href="/" variant="secondary" leadingIcon={<LayoutDashboard />}>
            Go to Dashboard
          </CommonButton>
        </div>
      </main>
    </div>
  );
}
