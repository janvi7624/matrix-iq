'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import styles from './quotationHistory.module.css';

interface PortalHeaderProps {
  title: string;
  subtitle: string;
}

export default function PortalHeader({ title, subtitle }: PortalHeaderProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <header className={styles.header}>
      <div className={styles.headerBrand}>
        <Image src="/NANTA.png" alt="NANTA logo" width={38} height={38} className={styles.headerLogo} unoptimized />
        <div>
          <h1>{title}</h1>
          <div className={styles.sub}>{subtitle}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Link className={styles.button} href="/">
          &larr; Back to Dashboard
        </Link>
        <button type="button" className={styles.button} onClick={handleLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
