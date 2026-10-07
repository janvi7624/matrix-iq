import { redirect } from 'next/navigation';

// Merged into /tms/team (see components/TmsTeamView.tsx) — kept as a redirect
// so any existing bookmark/link to this URL still lands somewhere real.
export default function TmsUsersPage() {
  redirect('/tms/team');
}
