import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { findUserByUsername } from '@/lib/userStore';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const allManagers = await listDepartmentManagers();
    const isSuperRole = viewer.role === 'admin' || viewer.role === 'superadmin';

    const managedDepts = Object.entries(allManagers)
      .filter(([, managers]) => managers.some((m) => m.username === viewer.username))
      .map(([dept]) => dept);

    const isHrManager = managedDepts.includes('HR');
    const isAccountsManager = managedDepts.includes('Accounts') || managedDepts.includes('Finance');
    const isDeptManager = managedDepts.length > 0;

    const sheets: unknown[] = [];
    const seen = new Set<string>();

    if (isDeptManager || isSuperRole) {
      const managerSheets = await reimbursementSheetStore.listForReviewer('manager', '');
      for (const s of managerSheets) {
        if (s.status !== 'submitted') continue;
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
        if (s.status !== 'manager_approved') continue;
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

    return NextResponse.json({ sheets });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
