import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import { PARTNER_HOME } from '@/lib/partnerRoles';
import PartnerTeamView from '@/components/PartnerTeamView';

export const metadata: Metadata = { title: 'Team Logins' };

export default async function PartnerTeamPage() {
  const viewer = await requirePartnerPage('partner-team');
  // The module's visibleToRoles already hides the tile from a Partner User,
  // and the API refuses them — but a hidden tile is not a guard, and someone
  // who types the URL should land somewhere sensible rather than on an empty
  // screen that fails every fetch.
  if (viewer.role !== 'partner-admin') redirect(PARTNER_HOME);

  return (
    <PartnerTeamView
      companyName={viewer.partner.company_name}
      partnerCode={viewer.partner.partner_code}
      currentUserId={viewer.id}
    />
  );
}
