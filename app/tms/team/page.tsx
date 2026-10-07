import { Suspense } from 'react';
import { requireTmsPage } from '@/lib/tmsPageGuard';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import TmsTeamView from '@/components/TmsTeamView';

export default async function TmsTeamPage() {
  // Users is the primary gate — every seeded role with tms-tab-access also
  // has tms-users (both sit behind the identical TMS_MANAGER_ONLY_ROLES), so
  // this redirects correctly for every real role today. canSeeTabAccess is
  // still checked independently so a future custom role scoped to only one
  // of the two still sees a sane one-tab page instead of a dead Permissions tab.
  const viewer = await requireTmsPage('tms-users');
  const canSeeTabAccess = await isModuleAccessAllowed('tms-tab-access', viewer);
  return (
    <Suspense fallback={null}>
      <TmsTeamView currentUser={{ username: viewer.username, role: viewer.role }} canSeeTabAccess={canSeeTabAccess} />
    </Suspense>
  );
}
