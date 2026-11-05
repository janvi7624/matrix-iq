import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers, isHrDepartmentName } from '@/lib/departmentStore';
import { findUserByUsername } from '@/lib/userStore';
import { ReimbursementSheetRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const allManagers = await listDepartmentManagers();
    const isSuperRole = viewer.role === 'admin' || viewer.role === 'superadmin';

    const managedDepts = Object.entries(allManagers)
      .filter(([, managers]) => managers.some((m) => m.username === viewer.username))
      .map(([dept]) => dept);

    const isHrManager = managedDepts.some(isHrDepartmentName);
    const isAccountsManager = managedDepts.includes('Accounts') || managedDepts.includes('Finance');
    const isDeptManager = managedDepts.length > 0;

    const sheets: ReimbursementSheetRecord[] = [];
    const seen = new Set<string>();

    // Each branch also keeps that role's own *_change_requested status —
    // the sheet they themselves sent back for changes. Dropping it (the
    // previous behaviour) meant that the moment a manager or HR reviewer
    // asked for a fix, the sheet vanished from every approval queue until
    // the employee resubmitted — invisible to the reviewer waiting on them,
    // to every other reviewer, and to the employee's own notification (it
    // only points at /reimbursement, not the specific month), so a sheet
    // nobody remembered to chase could sit unresubmitted indefinitely. It
    // is included here read-only (components/ReimbursementView.tsx renders
    // no decision panel for *_change_requested — the next move is the
    // employee's), purely so the person who flagged it can still see it is
    // still waiting rather than losing track of it entirely.
    if (isDeptManager || isSuperRole) {
      const managerSheets = await reimbursementSheetStore.listForReviewer('manager', '');
      for (const s of managerSheets) {
        if (s.status !== 'submitted' && s.status !== 'manager_change_requested') continue;
        if (!isSuperRole) {
          const creator = await findUserByUsername(s.created_by);
          if (!creator || !managedDepts.includes(creator.department)) continue;
        }
        if (!seen.has(s.id)) { seen.add(s.id); sheets.push(s); }
      }
    }

    if (isHrManager || isSuperRole) {
      const hrSheets = await reimbursementSheetStore.listForReviewer('hr', '');
      for (const s of hrSheets) {
        if (s.status !== 'manager_approved' && s.status !== 'hr_change_requested') continue;
        if (!seen.has(s.id)) { seen.add(s.id); sheets.push(s); }
      }
    }

    if (isAccountsManager || isSuperRole) {
      const accSheets = await reimbursementSheetStore.listForReviewer('accounts', '');
      for (const s of accSheets) {
        if (s.status !== 'hr_approved') continue;
        if (!seen.has(s.id)) { seen.add(s.id); sheets.push(s); }
      }
    }

    // Oldest period first, not newest — this queue spans every month with
    // something outstanding (listForReviewer itself has no month filter),
    // and a reviewer who only ever looks at the top of the list must see
    // the longest-waiting claims there, not this month's fresh ones with
    // last month's still buried underneath.
    sheets.sort((a, b) => a.year - b.year || a.month - b.month || a.created_at.localeCompare(b.created_at));

    return NextResponse.json({ sheets });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
