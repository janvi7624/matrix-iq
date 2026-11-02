import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerOnboardingView from '@/components/PartnerOnboardingView';

// The one portal page a partner can reach before their documents are
// approved — allowDuringOnboarding is what exempts it from the gate every
// other partner page is behind (lib/partnerPageGuard.ts).
//
// Still reachable AFTER onboarding, on purpose: it is where a partner goes
// to see what is on file and to replace an expired agreement. The view
// changes tone rather than disappearing.
export default async function PartnerOnboardingPage() {
  const viewer = await requirePartnerPage(undefined, { allowDuringOnboarding: true });

  return (
    <PartnerOnboardingView
      companyName={viewer.partner.company_name}
      partnerCode={viewer.partner.partner_code}
      alreadyOnboarded={!!viewer.partner.onboarded_at}
    />
  );
}
