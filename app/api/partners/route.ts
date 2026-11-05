import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canCreatePartner, canManagePartners } from '@/lib/partnerAccess';
import { resolvePartnerStakeholder } from '@/lib/partnerWorkspaceAccess';
import { createPartner, listPartners } from '@/lib/partnerStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { listPartnerDocuments } from '@/lib/partnerDocumentStore';
import { onboardingProgress } from '@/lib/partnerOnboarding';
import { apiErrorResponse } from '@/lib/apiError';
import { db, isUuid } from '@/lib/db';

// The Partner workspace's own list — a salesperson's book of partners.
//
// Deliberately NOT under /api/admin: that whole prefix is privileged-only at
// the proxy, and the people who bring partners in are ordinary sales staff.
// This route lives outside it and does its own scoping, which is both more
// honest about who these screens are for and removes the need to punch a
// hole in the admin gate.
//
// Scoping is the "no mix-ups" rule: you see the partners you created or are
// the relationship manager of. The admin tier and anyone who can manage
// partners org-wide still see all of them, because somebody has to be able
// to pick up a partner whose owner has left.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [seesAll, isStakeholder] = await Promise.all([
    canManagePartners(viewer),
    resolvePartnerStakeholder(viewer.userId)
  ]);
  if (!seesAll && !isStakeholder) {
    return NextResponse.json({ error: 'Forbidden — you are not assigned to any partner.' }, { status: 403 });
  }

  try {
    const all = await listPartners();
    const mine = seesAll
      ? all
      : all.filter((p) => p.created_by === viewer.userId || p.relationship_manager_id === viewer.userId);

    // Each row carries its onboarding state, because that is the thing the
    // owner has to act on — a partner waiting on their approval should be
    // visible from the list, not only after opening the record.
    const withProgress = await Promise.all(
      mine.map(async (partner) => {
        const documents = await listPartnerDocuments(partner.id);
        const progress = onboardingProgress(documents);
        return {
          ...partner,
          onboarding: {
            allApproved: progress.allApproved,
            approvedCount: progress.approvedCount,
            awaitingReview: progress.awaitingReview.length,
            rejected: progress.rejected.length,
            missing: progress.missing.length
          }
        };
      })
    );

    return NextResponse.json({
      partners: withProgress,
      canCreate: await canCreatePartner(viewer),
      seesAll
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Create a partner from inside the Partner module.
//
// Outside /api/admin so a non-privileged creator can reach it, and gated on
// canCreatePartner rather than on a role. The creator is recorded as
// created_by, which is what makes this partner theirs: they approve its
// onboarding documents and it appears in their workspace.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canCreatePartner(viewer))) {
    return NextResponse.json({ error: 'Forbidden — you are not set up to create partner accounts.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const companyName = typeof body?.company_name === 'string' ? body.company_name.trim() : '';
  if (!companyName) return NextResponse.json({ error: 'Company name is required' }, { status: 400 });

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  // relationship_manager_id is a UUID FK — a malformed value throws a raw
  // Postgres "invalid input syntax for type uuid" error, and a well-formed
  // but nonexistent one throws a raw FK-constraint violation; both would
  // otherwise surface as an unhandled 500 with the DB error leaked in the
  // response. Validate up front instead.
  const requestedRmId = str(body.relationship_manager_id);
  if (requestedRmId) {
    if (!isUuid(requestedRmId)) {
      return NextResponse.json({ error: 'Invalid relationship manager' }, { status: 400 });
    }
    const rmExists = await db.User.findByPk(requestedRmId);
    if (!rmExists) {
      return NextResponse.json({ error: 'Relationship manager not found' }, { status: 404 });
    }
  }

  try {
    const partner = await createPartner(
      {
        company_name: companyName,
        contact_person: str(body.contact_person),
        email: str(body.email),
        phone: str(body.phone),
        city: str(body.city),
        state: str(body.state),
        gst_number: str(body.gst_number),
        // Drives the partner code's PTR-AI-/PTR-ROB-/PTR-AV-/PTR-ALL- segment
        // — see nextPartnerCode in lib/partnerStore.ts.
        departments: list(body.departments),
        // Defaults to the creator: the person bringing the partner in is
        // normally the one who will manage the relationship, and an
        // unassigned partner is one nobody is watching.
        relationship_manager_id: requestedRmId || viewer.userId,
        // Who will maintain PAN, bank details and website — the checkbox on
        // PartnerCreateView. Anything but the literal 'partner' opt-in stays
        // 'internal' (today's behaviour), handled by createPartner's own default.
        financial_details_scope: body.financial_details_scope === 'partner' ? 'partner' : 'internal'
      },
      // The user ID, not the username — created_by is a UUID column, and
      // passing a username here fails the insert outright.
      viewer.userId
    );

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: partner.id,
      action: `Partner account created: ${partner.company_name}`,
      previousStatus: '',
      newStatus: partner.status,
      remarks: 'Awaiting onboarding documents',
      ip: getClientIp(request)
    });

    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
