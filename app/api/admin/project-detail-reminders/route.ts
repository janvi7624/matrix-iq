import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { buildProjectDetailReminderReport, sendProjectDetailReminders } from '@/lib/projectDetailReminders';
import { apiErrorResponse } from '@/lib/apiError';

// Who still has blank mandatory project details, and the one action that tells
// them. Base auth + the isPrivileged gate happen in proxy.ts (ADMIN_ONLY_
// PREFIXES covers /api/admin), so GET needs nothing further.
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await buildProjectDetailReminderReport());
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Sending is narrowed to admin/superadmin on top of the proxy's gate: this
// mails real staff, and a department manager reaching /admin is not the same
// authority as deciding the whole sales and technical roster gets a nag today.
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden — only an admin can send reminders' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  // Absent/empty means "everyone in the report". When present it must be a
  // list of usernames the caller just saw in the preview, so a send can only
  // ever be a subset of what was on screen — never a wider blast.
  const onlyUsernames = Array.isArray(body?.usernames)
    ? (body.usernames as unknown[]).filter((u): u is string => typeof u === 'string' && !!u)
    : undefined;
  if (Array.isArray(body?.usernames) && !onlyUsernames?.length) {
    return NextResponse.json({ error: 'Select at least one person to remind' }, { status: 400 });
  }

  try {
    const result = await sendProjectDetailReminders(onlyUsernames);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
