import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listUsers } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

interface CelebrationEntry {
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  date: string;
  daysAway: number;
  isToday: boolean;
  years?: number;
}

function getUpcoming(
  users: { name: string; employeeId: string; department: string; designation: string; birthday: string; dateOfJoining: string; status: string }[],
  today: Date
): { birthdays: CelebrationEntry[]; anniversaries: CelebrationEntry[] } {
  const birthdays: CelebrationEntry[] = [];
  const anniversaries: CelebrationEntry[] = [];

  const todayMonth = today.getMonth();
  const todayDate = today.getDate();
  const todayYear = today.getFullYear();

  for (const u of users) {
    if (u.status !== 'active') continue;

    if (u.birthday) {
      const bd = new Date(u.birthday + 'T00:00:00');
      const bdMonth = bd.getMonth();
      const bdDate = bd.getDate();

      const nextOccurrence = new Date(todayYear, bdMonth, bdDate);
      if (nextOccurrence < new Date(todayYear, todayMonth, todayDate)) {
        nextOccurrence.setFullYear(todayYear + 1);
      }
      const diffMs = nextOccurrence.getTime() - new Date(todayYear, todayMonth, todayDate).getTime();
      const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (daysAway <= 30) {
        birthdays.push({
          name: u.name, employeeId: u.employeeId, department: u.department,
          designation: u.designation, date: u.birthday,
          daysAway, isToday: daysAway === 0,
        });
      }
    }

    if (u.dateOfJoining) {
      const doj = new Date(u.dateOfJoining + 'T00:00:00');
      const dojMonth = doj.getMonth();
      const dojDate = doj.getDate();
      const dojYear = doj.getFullYear();

      if (dojYear >= todayYear) continue;

      const nextOccurrence = new Date(todayYear, dojMonth, dojDate);
      if (nextOccurrence < new Date(todayYear, todayMonth, todayDate)) {
        nextOccurrence.setFullYear(todayYear + 1);
      }
      const diffMs = nextOccurrence.getTime() - new Date(todayYear, todayMonth, todayDate).getTime();
      const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24));
      const years = nextOccurrence.getFullYear() - dojYear;

      if (daysAway <= 30) {
        anniversaries.push({
          name: u.name, employeeId: u.employeeId, department: u.department,
          designation: u.designation, date: u.dateOfJoining,
          daysAway, isToday: daysAway === 0, years,
        });
      }
    }
  }

  birthdays.sort((a, b) => a.daysAway - b.daysAway);
  anniversaries.sort((a, b) => a.daysAway - b.daysAway);

  return { birthdays, anniversaries };
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const users = await listUsers();
    const today = new Date();
    const result = getUpcoming(users, today);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
