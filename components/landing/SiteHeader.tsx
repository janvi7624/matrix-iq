import Link from '@/components/ui/AppLink';
import { BRAND } from '@/lib/branding';
import { CHAPTERS } from '@/lib/landingContent';
import base from './landing.module.css';

// The one header every public (pre-login) page shares: Pricing, Request a
// demo and Login. The homepage renders the same links itself, with in-page
// scroll-spy, so all four read identically.
export default function SiteHeader({
  current,
  transparent = false
}: {
  current?: 'pricing' | 'login' | 'request-demo';
  transparent?: boolean;
}) {
  return (
    <header className={`${base.header} ${transparent ? '' : base.headerScrolled}`}>
      <Link href="/" className={base.brand} aria-label={`${BRAND.appName} home`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND.iconMark} alt="" width={30} height={30} />
        <span>Matrix<b>IQ</b></span>
      </Link>
      <nav className={base.nav} aria-label="Main">
        {CHAPTERS.slice(1, 5).map((c) => (
          <Link key={c.id} href={`/#${c.id}`}>{c.label}</Link>
        ))}
        <Link
          href="/pricing"
          className={current === 'pricing' ? base.navCurrent : undefined}
          aria-current={current === 'pricing' ? 'page' : undefined}
        >
          Pricing
        </Link>
      </nav>
      <div className={base.headerCtas}>
        <Link href="/login" className={base.ghostBtn} aria-current={current === 'login' ? 'page' : undefined}>Login</Link>
        <Link href="/request-demo" className={base.primaryBtn} aria-current={current === 'request-demo' ? 'page' : undefined}>Request a demo</Link>
      </div>
    </header>
  );
}
