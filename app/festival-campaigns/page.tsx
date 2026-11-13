import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import FestivalCampaignsView from '@/components/FestivalCampaignsView';

// Who may actually see/act is decided by the API (canApproveCampaigns:
// HR festival module, Marketing manager, or Admin) — the view shows a plain
// "no access" line on a 403, same as the HR festivals screen.
export default async function FestivalCampaignsPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');
  return <FestivalCampaignsView />;
}
