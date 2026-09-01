import Link from 'next/link';
import Image from 'next/image';
import { BRAND } from '@/lib/branding';
import styles from '@/components/quotationHistory.module.css';

export default function NotFound() {
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
        <div className={styles.errorCode}>404</div>
        <h2 className={styles.errorHeading}>Page not found</h2>
        <p className={styles.errorBody}>The page you're looking for doesn't exist or may have moved.</p>
        <Link href="/" className={`${styles.button} ${styles.primary}`}>
          &larr; Back to Dashboard
        </Link>
      </main>
    </div>
  );
}
