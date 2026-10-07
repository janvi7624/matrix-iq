import { redirect } from 'next/navigation';

// Merged into /tms/projects (see components/TmsProjectsView.tsx, which now
// carries the project stat tiles the old TMS Dashboard showed) — kept as a
// redirect so any existing bookmark/link to this URL still lands on the
// right page. The rest of the old Dashboard's content (My Tasks/Team
// Overview, BOM Overview, Procurement Overview) moved onto their own
// matching pages — see ABSORBED_INTO_MERGED_PAGE in lib/moduleConfigStore.ts.
export default function TmsDashboardPage() {
  redirect('/tms/projects');
}
