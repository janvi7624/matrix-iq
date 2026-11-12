'use client';

import { useEffect, useState } from 'react';
import { Building2, FileSignature, FolderKanban, BarChart3, Send, Monitor, FileText, LifeBuoy } from 'lucide-react';
import notifyStyles from './ui/notify.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerGuideModal.module.css';

// Same guided-intro pattern as components/TmsGuideModal.tsx — deliberately
// the same shape and the same chrome so the two read as one product rather
// than two people's ideas of a help modal.
//
// One component, two audiences. The chrome is identical; the content is not,
// and must not be: an internal manager and an external partner are looking at
// opposite sides of the same workflow, and showing either of them the other's
// steps would be worse than showing nothing. Two localStorage keys so the two
// are dismissed independently — a staff member who also has a partner login
// should see each one once.

export type PartnerGuideAudience = 'internal' | 'partner';

const SEEN_KEY: Record<PartnerGuideAudience, string> = {
  internal: 'partner_mgmt_guide_seen',
  partner: 'partner_portal_guide_seen'
};

const CONTENT: Record<
  PartnerGuideAudience,
  {
    title: string;
    intro: string;
    steps: { icon: typeof Building2; title: string; body: string }[];
    howHeading: string;
    how: string[];
  }
> = {
  internal: {
    title: 'Welcome to Partner Management',
    intro: 'Partner Management is where channel partners, distributors and dealers are set up and everything they send you is tracked.',
    steps: [
      { icon: Building2, title: 'Onboard', body: 'Add a partner company, assign their relationship manager, and issue a portal login for their team.' },
      { icon: FileSignature, title: 'Documents', body: 'Agreement, NDA and the listing documents (GST, PAN) are tracked per partner until each one is approved.' },
      { icon: FolderKanban, title: 'Submissions', body: 'Leads, demo requests and quotation requests they send arrive here for your team to act on.' },
      { icon: BarChart3, title: 'Performance', body: 'Partner Analytics compares partners on submissions, conversion, demos and business won.' }
    ],
    howHeading: 'How Partner Management Works',
    how: [
      'You add the partner company and assign a relationship manager',
      'You issue a portal login for their team',
      'They upload the Agreement, NDA, GST and PAN',
      'They submit leads and request demos through their portal',
      'Your team converts a lead into a project and prepares a quotation',
      'You share the quotation back to them',
      'Partner Analytics tracks what each partner brings in'
    ]
  },
  partner: {
    title: 'Welcome to the Partner Portal',
    intro: 'This portal is where you send us opportunities, follow their progress, and get support — all in one place.',
    steps: [
      { icon: Send, title: 'Submit', body: 'Send a new lead or opportunity from My Leads / Projects, and track every one you have sent us.' },
      { icon: Monitor, title: 'Demos', body: 'Request a product demonstration for your customer and follow it through to completion.' },
      { icon: FileText, title: 'Quotations', body: 'Quotations we prepare for you appear here with their versions and validity dates.' },
      { icon: LifeBuoy, title: 'Support', body: 'Raise an after-sales support ticket and track it until it is resolved.' }
    ],
    howHeading: 'How the Partner Portal Works',
    how: [
      'You submit a lead or opportunity',
      'Our team reviews and confirms it',
      'You request a demo for your customer if one is needed',
      'We prepare a quotation for the opportunity',
      'The quotation is shared with you here',
      'You close the deal with your customer',
      'Raise a support ticket any time afterwards'
    ]
  }
};

/**
 * Shows the guide once per browser, per audience.
 *
 * "Seen" is per-browser (localStorage), not per-account — the same accepted
 * simplification TMS makes, and consistent with how this app already stores
 * per-viewer convenience state. Every read and write is wrapped because
 * localStorage throws in a private window or with site data blocked, and a
 * help modal must never be the thing that breaks a page.
 */
export function usePartnerGuideAutoShow(audience: PartnerGuideAudience): [boolean, () => void] {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY[audience])) setShow(true);
    } catch {
      // Fail safe by simply not auto-showing.
    }
  }, [audience]);

  function dismiss() {
    setShow(false);
  }

  return [show, dismiss];
}

export default function PartnerGuideModal({
  audience,
  onClose,
  dontShowAgainDefault = true
}: {
  audience: PartnerGuideAudience;
  onClose: () => void;
  dontShowAgainDefault?: boolean;
}) {
  const [dontShowAgain, setDontShowAgain] = useState(dontShowAgainDefault);
  const content = CONTENT[audience];

  function close() {
    try {
      if (dontShowAgain) localStorage.setItem(SEEN_KEY[audience], '1');
    } catch {
      // best-effort only
    }
    onClose();
  }

  return (
    <div className={notifyStyles.overlay} role="presentation" onClick={close}>
      <div
        className={notifyStyles.wideCard}
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={notifyStyles.confirmTitle}>{content.title}</div>
        <p className={styles.intro}>{content.intro}</p>

        <div className={styles.stepsGrid}>
          {content.steps.map(({ icon: Icon, title, body }) => (
            <div key={title} className={styles.stepCard}>
              <Icon size={18} color="var(--mx-brand)" className={styles.stepIcon} />
              <div>
                <div className={styles.stepTitle}>{title}</div>
                <div className={styles.stepBody}>{body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className={`${calcStyles.h2} ${styles.sectionHeadingCompact}`}>{content.howHeading}</div>
        <ol className={styles.stepsList}>
          {content.how.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <label className={styles.dontShowLabel}>
          <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
          Don&apos;t show again
        </label>

        <div className={`${notifyStyles.confirmActions} ${styles.actionsSpaced}`}>
          <button type="button" className={notifyStyles.confirmOk} onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}
