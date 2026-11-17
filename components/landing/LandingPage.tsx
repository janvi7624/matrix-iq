'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Blocks,
  CalendarCheck,
  FileText,
  Handshake,
  History,
  Layers,
  Lock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stamp,
  Target,
  Users,
  type LucideIcon
} from 'lucide-react';
import { BRAND } from '@/lib/branding';
import { CHAPTERS, CONNECTED, CONTROL, DEPARTMENTS, FINAL_CTA, FLOW, HERO, MODULES, SITE } from '@/lib/landingContent';
import styles from './landing.module.css';

const ICONS: Record<string, LucideIcon> = {
  target: Target,
  sparkles: Sparkles,
  file: FileText,
  handshake: Handshake,
  layers: Layers,
  calendar: CalendarCheck,
  users: Users,
  chart: BarChart3,
  shield: ShieldCheck,
  history: History,
  lock: Lock,
  stamp: Stamp,
  blocks: Blocks,
  phone: Smartphone
};

// Department nodes on a ring around the IQ hub (viewBox 0 0 600 600).
const NODES = DEPARTMENTS.map((d, i) => {
  const a = (i / DEPARTMENTS.length) * Math.PI * 2 - Math.PI / 2;
  return { ...d, x: 300 + Math.cos(a) * 220, y: 300 + Math.sin(a) * 220 };
});
// Cross links between neighbours, so it reads as a network, not a wheel.
const LINKS = NODES.map((n, i) => [n, NODES[(i + 1) % NODES.length]] as const);
const CHAOS_POS = [
  { x: 8, y: 14, r: -8 },
  { x: 70, y: 8, r: 6 },
  { x: 82, y: 58, r: -5 },
  { x: 4, y: 66, r: 7 },
  { x: 40, y: 86, r: -4 },
  { x: 60, y: 34, r: 9 }
];

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>('top');
  const [progress, setProgress] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  // Scroll progress, header state and the active chapter.
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? window.scrollY / max : 0);
      setScrolled(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-45% 0px -50% 0px' }
    );
    CHAPTERS.forEach((c) => {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    });
    return () => {
      window.removeEventListener('scroll', onScroll);
      io.disconnect();
    };
  }, []);

  // GSAP scenes — loaded lazily so the app bundle never carries it, and
  // skipped entirely for reduced motion (the static layout is the final state).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.dataset.static = 'true';
      return;
    }
    let ctx: { revert: () => void } | undefined;
    let cancelled = false;
    (async () => {
      const { gsap } = await import('gsap');
      const { ScrollTrigger } = await import('gsap/ScrollTrigger');
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      ctx = gsap.context(() => {
        const mm = gsap.matchMedia();

        // Hero: scattered tools collapse into the connected network.
        mm.add('(min-width: 900px)', () => {
          const tl = gsap.timeline({
            scrollTrigger: { trigger: '[data-hero]', start: 'top top', end: '+=120%', scrub: 0.6, pin: true, anticipatePin: 1 }
          });
          tl.to('[data-chaos]', { left: '50%', top: '50%', xPercent: -50, yPercent: -50, rotate: 0, scale: 0.3, opacity: 0, stagger: 0.04, ease: 'power2.in' }, 0)
            .fromTo('[data-link]', { strokeDashoffset: 1 }, { strokeDashoffset: 0, stagger: 0.03, ease: 'none' }, 0.25)
            .fromTo('[data-node]', { scale: 0.4, opacity: 0, transformOrigin: 'center' }, { scale: 1, opacity: 1, stagger: 0.04, ease: 'back.out(2)' }, 0.3)
            .fromTo('[data-hub]', { scale: 0.6, opacity: 0, transformOrigin: 'center' }, { scale: 1, opacity: 1, ease: 'expo.out' }, 0.55)
            .to('[data-hero-hint]', { opacity: 0 }, 0);
          return () => tl.kill();
        });
        mm.add('(max-width: 899px)', () => {
          gsap.set('[data-chaos]', { opacity: 0 });
          gsap.from('[data-node]', { scale: 0.5, opacity: 0, stagger: 0.06, duration: 0.6, ease: 'back.out(2)', transformOrigin: 'center' });
          gsap.fromTo('[data-link]', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2, stagger: 0.05 });
        });

        // Section reveals.
        ScrollTrigger.batch('[data-reveal]', {
          start: 'top 88%',
          once: true,
          onEnter: (els) => gsap.fromTo(els, { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.08, ease: 'power3.out' })
        });

        // Flow: the progress line fills as the steps pass.
        gsap.fromTo('[data-flow-fill]', { scaleX: 0 }, {
          scaleX: 1,
          ease: 'none',
          transformOrigin: 'left center',
          scrollTrigger: { trigger: '[data-flow]', start: 'top 70%', end: 'bottom 60%', scrub: true }
        });
      }, root);
      root.dataset.motion = 'true';
    })();
    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, []);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div ref={rootRef} className={styles.page}>
      <a href="#main" className={styles.skip}>Skip to content</a>
      <div className={styles.progress} style={{ transform: `scaleX(${progress})` }} aria-hidden />

      <header className={`${styles.header} ${scrolled ? styles.headerScrolled : ''}`}>
        <a href="#top" onClick={go('top')} className={styles.brand} aria-label={`${BRAND.appName} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.iconMark} alt="" width={30} height={30} />
          <span>Matrix<b>IQ</b></span>
        </a>
        <nav className={styles.nav} aria-label="Sections">
          {CHAPTERS.slice(1, 5).map((c) => (
            <a key={c.id} href={`#${c.id}`} onClick={go(c.id)} className={active === c.id ? styles.navActive : ''}>
              {c.label}
            </a>
          ))}
          <Link href="/pricing">Pricing</Link>
        </nav>
        <div className={styles.headerCtas}>
          <Link href="/login" className={styles.ghostBtn}>Login</Link>
          <Link href="/request-demo" className={styles.primaryBtn}>Request a demo</Link>
        </div>
      </header>

      <nav className={styles.rail} aria-label="Story chapters">
        {CHAPTERS.map((c) => (
          <a key={c.id} href={`#${c.id}`} onClick={go(c.id)} aria-current={active === c.id ? 'step' : undefined} className={active === c.id ? styles.railOn : ''}>
            <span className={styles.railLabel}>{c.label}</span>
            <span className={styles.railDot} />
          </a>
        ))}
      </nav>

      <main id="main" tabIndex={-1}>
        {/* 1 — Hero */}
        <section id="top" data-hero className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.glowA} aria-hidden />
          <div className={styles.glowB} aria-hidden />
          <div className={styles.grid} aria-hidden />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.badge}><Sparkles size={14} /> {HERO.badge}</span>
              <h1 id="hero-title" className={styles.heroTitle}>
                {HERO.title[0]}<br /><span>{HERO.title[1]}</span>
              </h1>
              <p className={styles.heroLead}>{HERO.lead}</p>
              <div className={styles.heroCtas}>
                <Link href="/request-demo" className={styles.primaryBtnLg}>Request a demo <ArrowRight size={18} /></Link>
                <Link href="/login" className={styles.ghostBtnLg}>Login to MatrixIQ</Link>
              </div>
              <p className={styles.byline}>by {SITE.company}</p>
            </div>

            <div className={styles.heroVisual} aria-hidden>
              {HERO.chaos.map((c, i) => (
                <span
                  key={c}
                  data-chaos
                  className={styles.chaos}
                  style={{ left: `${CHAOS_POS[i].x}%`, top: `${CHAOS_POS[i].y}%`, transform: `rotate(${CHAOS_POS[i].r}deg)` }}
                >
                  {c}
                </span>
              ))}
              <svg viewBox="0 0 600 600" className={styles.network}>
                <defs>
                  <radialGradient id="hubGlow">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {NODES.map((n) => (
                  <line key={`s-${n.key}`} data-link pathLength={1} strokeDasharray="1" x1={300} y1={300} x2={n.x} y2={n.y} className={styles.spoke} />
                ))}
                {LINKS.map(([a, b]) => (
                  <line key={`l-${a.key}`} data-link pathLength={1} strokeDasharray="1" x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={styles.link} />
                ))}
                <g data-hub>
                  <circle cx={300} cy={300} r={120} fill="url(#hubGlow)" />
                  <circle cx={300} cy={300} r={62} className={styles.hub} />
                  <text x={300} y={312} textAnchor="middle" className={styles.hubText}>IQ</text>
                </g>
                {NODES.map((n) => (
                  <g key={n.key} data-node>
                    <circle cx={n.x} cy={n.y} r={34} className={styles.node} />
                    <circle cx={n.x} cy={n.y} r={5} className={styles.nodeDot} />
                    <text x={n.x} y={n.y + 52} textAnchor="middle" className={styles.nodeText}>{n.label}</text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
          <span data-hero-hint className={styles.scrollHint}>Scroll to connect</span>
        </section>

        {/* 2 — Connected */}
        <section id="connected" className={`${styles.section} ${styles.sectionLight}`}>
          <div className={styles.container}>
            <div className={styles.split}>
              <div data-reveal>
                <span className={styles.eyebrow}>{CONNECTED.eyebrow}</span>
                <h2 className={styles.h2}>{CONNECTED.title}</h2>
                <p className={styles.body}>{CONNECTED.body}</p>
              </div>
              <div className={styles.stats}>
                {/* Featured stat: the module count, with a sample of the
                    modules floating as bubbles. */}
                <div data-reveal className={styles.statHero}>
                  <div className={styles.statHeroHead}>
                    <strong>{CONNECTED.stats[0].value}</strong>
                    <span>{CONNECTED.stats[0].label}</span>
                  </div>
                  <ul className={styles.bubbles} aria-label="Some of the connected modules">
                    {CONNECTED.modules.map((m, i) => (
                      <li
                        key={m}
                        className={i % 5 === 0 ? styles.bubbleHot : undefined}
                        style={{ '--i': i } as React.CSSProperties}
                      >
                        {m}
                      </li>
                    ))}
                    <li className={styles.bubbleMore}>{CONNECTED.modulesMore}</li>
                  </ul>
                </div>
                <div className={styles.statRow}>
                  {CONNECTED.stats.slice(1).map((s) => (
                    <div key={s.label} data-reveal className={styles.stat}>
                      <strong>{s.value}</strong>
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3 — Modules */}
        <section id="modules" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHead} data-reveal>
              <span className={styles.eyebrow}>Modules</span>
              <h2 className={styles.h2}>Everything your business runs on.</h2>
            </div>
            <div className={styles.cards}>
              {MODULES.map((m) => {
                const Icon = ICONS[m.icon] ?? Sparkles;
                return (
                  <article key={m.title} data-reveal className={`${styles.card} ${m.icon === 'sparkles' ? styles.cardAi : ''}`}>
                    <span className={styles.cardIcon}><Icon size={22} /></span>
                    <h3>{m.title}</h3>
                    <p>{m.body}</p>
                    <ul>
                      {m.points.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* 4 — Flow */}
        <section id="flow" className={`${styles.section} ${styles.sectionLight}`}>
          <div className={styles.container}>
            <div className={styles.sectionHead} data-reveal>
              <span className={styles.eyebrow}>{FLOW.eyebrow}</span>
              <h2 className={styles.h2}>{FLOW.title}</h2>
              <p className={styles.body}>{FLOW.body}</p>
            </div>
            <div className={styles.flow} data-flow>
              <div className={styles.flowTrack} aria-hidden><div data-flow-fill className={styles.flowFill} /></div>
              <ol className={styles.flowSteps}>
                {FLOW.steps.map((s, i) => (
                  <li key={s.title} data-reveal className={styles.flowStep}>
                    <span className={styles.flowNum}>{i + 1}</span>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* 5 — Control */}
        <section id="control" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHead} data-reveal>
              <span className={styles.eyebrow}>{CONTROL.eyebrow}</span>
              <h2 className={styles.h2}>{CONTROL.title}</h2>
            </div>
            <div className={styles.controlGrid}>
              {CONTROL.items.map((c) => {
                const Icon = ICONS[c.icon] ?? ShieldCheck;
                return (
                  <div key={c.title} data-reveal className={styles.control}>
                    <Icon size={20} />
                    <div>
                      <h3>{c.title}</h3>
                      <p>{c.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 6 — Final CTA */}
        <section id="demo" className={styles.cta}>
          <div className={styles.glowA} aria-hidden />
          <div className={styles.container} data-reveal>
            <h2 className={styles.ctaTitle}>{FINAL_CTA.title}</h2>
            <p className={styles.ctaBody}>{FINAL_CTA.body}</p>
            <div className={styles.heroCtas} style={{ justifyContent: 'center' }}>
              <Link href="/request-demo" className={styles.primaryBtnLg}>{FINAL_CTA.primary} <ArrowRight size={18} /></Link>
              <Link href="/login" className={styles.ghostBtnLg}>{FINAL_CTA.secondary}</Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.container} ${styles.footerGrid}`}>
        <div>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.iconMark} alt="" width={28} height={28} />
            <span>Matrix<b>IQ</b></span>
          </div>
          <p className={styles.footerTag}>{BRAND.tagline}</p>
          <p className={styles.footerSmall}>A product of {SITE.company}</p>
        </div>
        <div>
          <h4>Contact</h4>
          <a href={SITE.phoneHref}><Phone size={15} /> {SITE.phoneDisplay}</a>
          <a href={`mailto:${SITE.email}`}><Mail size={15} /> {SITE.email}</a>
          <a href={SITE.mapsUrl} target="_blank" rel="noopener noreferrer" className={styles.address}>
            <MapPin size={15} />
            <span>{SITE.addressLines.map((l) => <span key={l}>{l}<br /></span>)}</span>
          </a>
        </div>
        <div>
          <h4>MatrixIQ</h4>
          <Link href="/request-demo">Request a demo</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Login</Link>
          <Link href="/#modules">Modules</Link>
        </div>
      </div>
      <div className={`${styles.container} ${styles.copyright}`}>© {new Date().getFullYear()} {SITE.company}. All rights reserved.</div>
    </footer>
  );
}
