import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { buildReuploadNotice, formatBillDate, formatRupees, groupByPerson, listMissingBillClaims } from '@/lib/missingBills';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMissingBillsEmail } from '@/lib/email/notifications';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// Who can see everyone's missing bills and ask people to re-send them: Admin/
// Manager, HR, and Accounts (they're the ones who can't pay a claim without
// its bill).
async function canManage(viewer: { username: string; role: string; isPrivileged: boolean }): Promise<boolean> {
  if (viewer.role === 'hr') return true;
  return isAccountsPaymentActor(viewer as Parameters<typeof isAccountsPaymentActor>[0]);
}

// Default: the viewer's OWN claims that need a bill uploaded again.
// ?scope=all: every affected person, for whoever can manage this.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    if (request.nextUrl.searchParams.get('scope') === 'all') {
      if (!(await canManage(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const people = groupByPerson(await listMissingBillClaims());
      return NextResponse.json({
        people,
        totalBills: people.reduce((n, p) => n + p.billCount, 0),
        totalClaims: people.reduce((n, p) => n + p.claims.length, 0)
      });
    }
    const claims = await listMissingBillClaims({ usernames: [viewer.username] });
    return NextResponse.json({ claims, canManage: await canManage(viewer) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Asks the affected people to upload their bills again — an in-app notification
// plus an email each. `usernames` limits it to some people; `dryRun` reports who
// WOULD be asked without sending anything (the page's confirmation uses the
// same numbers). Inactive accounts are listed but never messaged.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManage(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const usernames = Array.isArray(body?.usernames) ? body.usernames.filter((u: unknown): u is string => typeof u === 'string' && !!u.trim()) : undefined;
  const dryRun = body?.dryRun === true;

  try {
    const people = groupByPerson(await listMissingBillClaims({ usernames }));
    const reachable = people.filter((p) => p.active);
    const skipped = people.filter((p) => !p.active).map((p) => ({ username: p.username, name: p.name, reason: 'account is inactive' }));
    const summary = {
      people: people.length,
      bills: people.reduce((n, p) => n + p.billCount, 0),
      willNotify: reachable.map((p) => ({ username: p.username, name: p.name, bills: p.billCount, hasEmail: !!p.email })),
      skipped
    };
    if (dryRun || !reachable.length) return NextResponse.json({ dryRun, notified: 0, emailed: 0, ...summary });

    let emailed = 0;
    for (const person of reachable) {
      const notice = buildReuploadNotice(person);
      await notifyUsers([person.username], {
        title: notice.title,
        body: notice.body,
        type: 'reimbursement_bills_missing',
        entityType: 'reimbursement_bill',
        entityId: person.claims[0].claimId
      });
      if (person.email) {
        emailed += 1;
        void sendMissingBillsEmail({
          email: person.email,
          name: person.name,
          bills: person.claims.map((c) => ({ date: formatBillDate(c.date), description: c.description, amount: formatRupees(c.amount) }))
        });
      }
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'reimbursement',
      entityId: reachable[0].claims[0].claimId,
      action: `Asked ${reachable.length} employee${reachable.length === 1 ? '' : 's'} to upload ${summary.bills} missing reimbursement bill${summary.bills === 1 ? '' : 's'} again`,
      previousStatus: '',
      newStatus: '',
      remarks: reachable.map((p) => `${p.username}: ${p.billCount}`).join(', '),
      ip: getClientIp(request)
    });

    return NextResponse.json({ dryRun: false, notified: reachable.length, emailed, ...summary });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
