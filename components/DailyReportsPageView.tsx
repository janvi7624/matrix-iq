'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import DailyReportView from './DailyReportView';
import TeamDailyReportsView from './TeamDailyReportsView';

// Merges what used to be two sidebar entries — Daily Report and Team Daily
// Reports — into one module, with the team view as a second tab that only
// appears for someone who actually manages a team.
//
// Same arrangement as Quotations (New / Existing) and TMS Projects: the
// module KEYS stay separate and independently permission-gated in Module
// Manager, so an admin keeps per-tab control and every
// isModuleAccessAllowed('team-daily-reports', …) check in the API is
// untouched. Only the nav listing collapses — see
// ABSORBED_INTO_MERGED_PAGE in lib/moduleConfigStore.ts.
//
// `canViewTeam` is resolved on the SERVER (see requireDailyReportPage) from
// the same rule the team API enforces, rather than from a role string in the
// browser. Hiding the tab is a courtesy; the endpoints behind it do their own
// check, so a non-manager who forges ?tab=team gets an empty, forbidden
// response rather than someone else's data.
//
// The tab is read from the URL rather than held in useState, matching
// QuotationsView — it makes the tab linkable and refresh-proof, which
// matters here because the "X submitted their daily report" notification
// deep-links straight to ?tab=team&report=…, and because /daily-reports/team
// now redirects onto this page with that parameter.

interface DailyReportsPageViewProps {
  canViewTeam: boolean;
  initialDate?: string;
  initialReportId?: string;
}

export default function DailyReportsPageView({ canViewTeam, initialDate, initialReportId }: DailyReportsPageViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // A ?tab=team on an account that cannot see the team tab falls back to the
  // employee's own report instead of rendering an empty shell — the same
  // fail-closed direction the rest of the module takes.
  const tab: 'mine' | 'team' = canViewTeam && searchParams.get('tab') === 'team' ? 'team' : 'mine';

  // Captured ONCE. The inner views seed their own date state from this, and
  // pushing a date back into the URL below re-runs the server component with
  // a new prop — if that flowed through reactively, the view would reload the
  // date it had just loaded on every pick.
  const [initialDateOnce] = useState(initialDate);
  const [initialReportIdOnce] = useState(initialReportId);

  const navigate = useCallback(
    (nextTab: 'mine' | 'team', date: string | null) => {
      const query = new URLSearchParams();
      if (nextTab === 'team') query.set('tab', 'team');
      if (date) query.set('date', date);
      const suffix = query.toString();
      // replace, not push — flipping a tab or a date shouldn't fill the back
      // button with history. scroll:false keeps the viewport where it was.
      router.replace(suffix ? `/daily-reports?${suffix}` : '/daily-reports', { scroll: false });
    },
    [router]
  );

  // The date travels with the tab: a manager looking at Tuesday in their own
  // report and flipping to Team gets Tuesday, not today. That only works
  // because each view reports a user-picked date back up here (onDateChange)
  // and it is kept in the URL, which is also what makes the view linkable.
  function selectTab(next: 'mine' | 'team') {
    navigate(next, searchParams.get('date'));
  }

  const handleDateChange = useCallback((date: string) => navigate(tab, date), [navigate, tab]);

  const subtitle = canViewTeam
    ? 'Workspace › file your daily report, and track what your team has filed.'
    : 'Workspace › file your daily activity report and track your submission history.';

  return (
    <AppShell title="Daily Report" subtitle={subtitle}>
      {/* A single-tab tab bar is noise, so it only renders for someone who
          actually has a second tab to switch to. */}
      {canViewTeam && (
        <div className={historyStyles.tabBar}>
          <button
            type="button"
            className={`${historyStyles.tabBtn} ${tab === 'mine' ? historyStyles.tabBtnActive : ''}`}
            onClick={() => selectTab('mine')}
          >
            My Daily Report
          </button>
          <button
            type="button"
            className={`${historyStyles.tabBtn} ${tab === 'team' ? historyStyles.tabBtnActive : ''}`}
            onClick={() => selectTab('team')}
          >
            Team Daily Reports
          </button>
        </div>
      )}

      {tab === 'team' ? (
        <TeamDailyReportsView
          embedded
          initialDate={initialDateOnce}
          initialReportId={initialReportIdOnce}
          onDateChange={handleDateChange}
        />
      ) : (
        <DailyReportView embedded initialDate={initialDateOnce} onDateChange={handleDateChange} />
      )}
    </AppShell>
  );
}
