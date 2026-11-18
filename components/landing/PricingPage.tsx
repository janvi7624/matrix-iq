import Link from 'next/link';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { GST_RATE, MODULE_GROUPS, PLANS, TRIAL_DAYS, formatInr, planIncludesModule, type Plan } from '@/lib/plans';
import { SiteFooter } from './LandingPage';
import SiteHeader from './SiteHeader';
import base from './landing.module.css';
import styles from './pricing.module.css';

// Public pricing page — same look as the landing page (shares its tokens,
// header, buttons and footer). Plan data comes from lib/plans.ts.

function limit(value: number | null): string {
  return value === null ? 'Unlimited' : value.toLocaleString('en-IN');
}

function PlanCard({ plan }: { plan: Plan }) {
  const quoted = plan.monthlyPrice === null;
  return (
    <article className={`${styles.plan} ${plan.featured ? styles.planFeatured : ''}`}>
      {plan.featured && <span className={styles.ribbon}>Most popular</span>}
      <h2 className={styles.planName}>{plan.name}</h2>
      <p className={styles.planTagline}>{plan.tagline}</p>
      <div>
        <span className={styles.price}>{quoted ? 'Custom' : formatInr(plan.monthlyPrice!)}</span>
        {!quoted && <span className={styles.per}> /month</span>}
      </div>
      <div className={styles.yearly}>
        {plan.yearlyPrice !== null ? `${formatInr(plan.yearlyPrice)}/year — 2 months free` : 'Annual contract'}
      </div>
      <Link href="/request-demo" className={`${plan.featured ? base.primaryBtn : base.ghostBtn} ${styles.planCta}`}>
        {quoted ? 'Talk to sales' : `Choose ${plan.name}`}
      </Link>
      <ul className={styles.points}>
        {plan.highlights.map((h) => (
          <li key={h}>
            <Check size={16} aria-hidden />
            {h}
          </li>
        ))}
        <li>
          <Check size={16} aria-hidden />
          {plan.support}
        </li>
      </ul>
      <div className={styles.planFoot}>
        {plan.extraUserPrice !== null ? `Extra users ${formatInr(plan.extraUserPrice)}/user/month` : 'Volume pricing on request'}
      </div>
    </article>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do we pay?',
    a: 'There is no online checkout. After you choose a plan we send a GST invoice; you pay by bank transfer, UPI or cheque and share the payment reference. Our team confirms the payment and activates your organization — usually within one business day.',
  },
  {
    q: 'Is there a trial?',
    a: `Yes — every new organization gets a ${TRIAL_DAYS}-day guided trial with the modules of the plan it requested, so your team can use real data before the first invoice.`,
  },
  {
    q: 'What counts as a user?',
    a: 'Any active login in your organization. Deactivated employees and exited staff do not count. Partner-portal accounts are included in your user count.',
  },
  {
    q: 'What happens if we go over our user limit?',
    a: 'You can keep adding users at the per-user rate for your plan; it is added to your next invoice. Or move up a plan whenever it becomes cheaper.',
  },
  {
    q: 'What happens if an invoice is not paid?',
    a: 'After the due date there is a 7-day grace period with reminders. After that the workspace becomes read-only until payment is confirmed — your data is never deleted for non-payment.',
  },
  {
    q: 'Can we change plans later?',
    a: 'Yes. Upgrades apply immediately and are billed pro-rata; downgrades take effect at the next billing period.',
  },
];

export default function PricingPage() {
  return (
    <div className={base.page}>
      <a href="#main" className={base.skip}>Skip to content</a>

      <SiteHeader current="pricing" />

      <main id="main" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="pricing-title">
          <div className={base.glowA} aria-hidden />
          <div className={base.grid} aria-hidden />
          <div className={base.container}>
            <div className={styles.badgeRow}>
              <span className={base.badge}><Sparkles size={14} /> Simple, per-organization pricing</span>
            </div>
            <h1 id="pricing-title" className={styles.title}>
              Pick the plan that <span>fits your team.</span>
            </h1>
            <p className={styles.lead}>
              Priced by users and the modules you need. All prices in INR, exclusive of {Math.round(GST_RATE * 100)}% GST.
              Paid by invoice — no card required.
            </p>
          </div>
        </section>

        <section className={base.section} style={{ paddingTop: 40 }}>
          <div className={base.container}>
            <div className={styles.plans}>
              {PLANS.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          </div>
        </section>

        <section className={`${base.section} ${base.sectionLight}`}>
          <div className={base.container}>
            <div className={base.sectionHead}>
              <span className={base.eyebrow}>Compare</span>
              <h2 className={base.h2}>Usage limits and modules, side by side.</h2>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    {PLANS.map((p) => (
                      <th key={p.id} scope="col" className={p.featured ? styles.colFeatured : undefined}>
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className={styles.group}>
                    <td colSpan={PLANS.length + 1}>Usage</td>
                  </tr>
                  <tr>
                    <td>Users included</td>
                    {PLANS.map((p) => <td key={p.id}>{limit(p.includedUsers)}</td>)}
                  </tr>
                  <tr>
                    <td>Extra user / month</td>
                    {PLANS.map((p) => <td key={p.id}>{p.extraUserPrice === null ? 'Custom' : formatInr(p.extraUserPrice)}</td>)}
                  </tr>
                  <tr>
                    <td>File storage</td>
                    {PLANS.map((p) => <td key={p.id}>{p.storageGb === null ? 'Custom' : `${p.storageGb} GB`}</td>)}
                  </tr>
                  <tr>
                    <td>Departments</td>
                    {PLANS.map((p) => <td key={p.id}>{limit(p.maxDepartments)}</td>)}
                  </tr>
                  <tr>
                    <td>Support</td>
                    {PLANS.map((p) => <td key={p.id}>{p.support}</td>)}
                  </tr>
                  {MODULE_GROUPS.map((group) => (
                    <ModuleRows key={group.title} title={group.title} modules={group.modules} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className={base.section}>
          <div className={base.container}>
            <div className={base.sectionHead}>
              <span className={base.eyebrow}>Billing</span>
              <h2 className={base.h2}>Questions about paying.</h2>
            </div>
            <div className={styles.faq}>
              {FAQ.map((item) => (
                <details key={item.q} className={styles.faqItem}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={base.cta}>
          <div className={base.glowA} aria-hidden />
          <div className={base.container}>
            <h2 className={base.ctaTitle}>Not sure which plan fits?</h2>
            <p className={base.ctaBody}>Tell us your team size and departments — we will walk you through MatrixIQ and recommend one.</p>
            <div className={base.heroCtas} style={{ justifyContent: 'center' }}>
              <Link href="/request-demo" className={base.primaryBtnLg}>Request a demo <ArrowRight size={18} /></Link>
              <Link href="/" className={base.ghostBtnLg}>Explore MatrixIQ</Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function ModuleRows({ title, modules }: { title: string; modules: (typeof MODULE_GROUPS)[number]['modules'] }) {
  return (
    <>
      <tr className={styles.group}>
        <td colSpan={PLANS.length + 1}>{title}</td>
      </tr>
      {modules.map((m) => (
        <tr key={m.key}>
          <td>{m.name}</td>
          {PLANS.map((p) => (
            <td key={p.id}>
              {planIncludesModule(p, m.key) ? (
                <Check size={18} className={styles.tick} aria-label="Included" />
              ) : (
                <span className={styles.dash} aria-label="Not included">—</span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
