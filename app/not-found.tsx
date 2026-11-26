import Image from 'next/image';
import { LayoutDashboard } from 'lucide-react';
import { BRAND } from '@/lib/branding';
import styles from '@/components/quotationHistory.module.css';
import CommonHeader from '@/components/ui/CommonHeader';
import CommonButton from '@/components/ui/CommonButton';

export default function NotFound() {
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
        <div className={styles.errorCode}>404</div>
        <h2 className={styles.errorHeading}>Page not found</h2>
        <p className={styles.errorBody}>The page you&apos;re looking for doesn&apos;t exist or may have moved.</p>
        <CommonButton href="/" variant="primary" leadingIcon={<LayoutDashboard />}>
          Go to Dashboard
        </CommonButton>
      </main>
    </div>
  );
}
