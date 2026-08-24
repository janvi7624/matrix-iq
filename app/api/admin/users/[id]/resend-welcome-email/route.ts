import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { findUserById, updateUser } from '@/lib/userStore';
import { generateTempPassword } from '@/lib/passwords';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin/superadmin gating happens in proxy.ts (matcher:
// /api/admin/:path*). There's no way to recover a user's original temp
// password (only its hash is stored), so "resend" is really "issue a new
// one and email it" — the same admin-reset path PATCH .../[id] already
// uses (updateUser + passwordChangeInitiatedBy: 'admin'), just with the
// password generated here instead of typed by the admin.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const existing = await findUserById(id);
    if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (existing.role === 'superadmin' && session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Only a superadmin can resend credentials to a superadmin account' }, { status: 403 });
    }
    if (!existing.email) {
      return NextResponse.json({ error: 'This user has no email address on file — add one first' }, { status: 400 });
    }

    const tempPassword = generateTempPassword();
    const updated = await updateUser(id, { password: tempPassword, passwordChangeInitiatedBy: 'admin', mustChangePassword: true });
    if (!updated) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Returned so a caller that's already showing this user's credentials on
    // screen (e.g. the Excel import results table) can keep that display in
    // sync with the password that was actually just emailed — the admin
    // triggering this is already privileged to know it, same as the import
    // commit response that shows it the first time.
    return NextResponse.json({ ok: true, email: updated.email, tempPassword });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
