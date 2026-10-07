import { redirect } from 'next/navigation';

// Merged into /tms/team (see components/TmsTeamView.tsx) — kept as a redirect
// so any existing bookmark/link to this URL still lands on the right tab.
export default function TmsTabAccessPage() {
  redirect('/tms/team?tab=tab-access');
}
