'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { UserRole } from '@/lib/types';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import TmsUsersView from './TmsUsersView';
import TmsTabAccessView from './TmsTabAccessView';

interface TmsTeamViewProps {
  currentUser: { username: string; role: UserRole };
  /** False when the viewer's role can't see Tab Access at all — hides that
      tab instead of rendering a dead end (see app/tms/team/page.tsx). */
  canSeeTabAccess: boolean;
}

const TABS = [
  { key: 'users' as const, label: 'Team' },
  { key: 'tab-access' as const, label: 'Permissions' }
];

// Merges what used to be two separate TMS sidebar entries (Users, Tab Access)
// into one — they operate on different data (a user row vs. a role's
// permissions JSON) but are functionally linked (Tab Access decides what this
// same page's Users tab lets you do), so one page with two tabs reads better
// than two adjacent-but-unrelated-looking nav items.
export default function TmsTeamView({ currentUser, canSeeTabAccess }: TmsTeamViewProps) {
  // Only read once, as the initial value — a redirect from the old
  // /tms/tab-access URL (?tab=tab-access) lands on that tab; switching tabs
  // afterward is plain client state, same as every other in-page tab bar here.
  const initialTab = useSearchParams().get('tab') === 'tab-access' ? 'tab-access' : 'users';
  const [tab, setTab] = useState<'users' | 'tab-access'>(initialTab);

  return (
    <AppShell title="Users & Tab Access" subtitle="Manage technical team accounts and which TMS roles can view, create, edit, delete, approve, or manage each tab.">
      {canSeeTabAccess && (
        <div className={historyStyles.tabBar}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${historyStyles.tabBtn} ${tab === t.key ? historyStyles.tabBtnActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === 'users' || !canSeeTabAccess ? (
        <TmsUsersView currentUser={currentUser} embedded />
      ) : (
        <TmsTabAccessView currentUser={currentUser} embedded />
      )}
    </AppShell>
  );
}
