'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/branding';
import styles from './quotationHistory.module.css';

interface PortalHeaderProps {
  title: string;
  subtitle: string;
  showBackLink?: boolean;
}

export default function PortalHeader({ title, subtitle, showBackLink = true }: PortalHeaderProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
        <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />
        <div>
          <h1>{title}</h1>
          <div className={styles.sub}>{subtitle}</div>
        </div>
      </Link>
      <div style={{ display: 'flex', gap: 10 }}>
        {showBackLink && (
          <Link className={styles.button} href="/">
            &larr; Back to Dashboard
          </Link>
        )}
        <button type="button" className={styles.button} onClick={handleLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
