import Link from 'next/link';
import Image from 'next/image';
import { BRAND } from '@/lib/branding';
import styles from '@/components/quotationHistory.module.css';

export default function NotFound() {
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
        <div style={{ fontSize: 64, fontWeight: 800, color: '#dc2626' }}>404</div>
        <h2 style={{ margin: 0 }}>Page not found</h2>
        <p style={{ color: '#6b7280', maxWidth: 420 }}>The page you're looking for doesn't exist or may have moved.</p>
        <Link href="/" className={`${styles.button} ${styles.primary}`}>
          &larr; Back to Dashboard
        </Link>
      </main>
    </div>
  );
}
