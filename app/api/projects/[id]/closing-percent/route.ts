import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import {
  appendProjectTimeline,
  canAccessProject,
  clearClosingPercentOverride,
  findProjectById,
  resolveProjectDeadlineTier,
  setClosingPercentOverride
} from '@/lib/projectStore';
import { resolveClosingPercent } from '@/lib/salesStageRules';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// The ONLY way a Closing % can be set by hand.
//
// Everywhere else it is derived from the stage (lib/salesStageRules.ts), and
// the column is marked readOnly in projectStore's FIELDS so the ordinary
// project PATCH cannot reach it however the request is crafted. That matters:
// before this change, PATCH /api/projects/[id] accepted a
// closingProbabilityPercent from anyone who could edit the project — no role
// check, no reason, no audit row — which is how a Cold Call deal came to claim
// 100% and a Closed Lost deal 40%.
//
// AUTHORIZATION, and why not the obvious things:
//
//  - NOT viewer.isPrivileged: that is true for the 'manager' role as well, so
//    it cannot express "Admin only". resolveProjectDeadlineTier is this
//    module's own admin-tier predicate and its comment says exactly this.
//  - NOT the route's location: proxy.ts applies no role gate to
//    /api/projects/**, and the gate it applies to /api/admin/** is
//    isPrivileged — which would admit managers. So moving this file would
//    change nothing. The check has to be here, in the handler.
//  - NOT isModuleActionAllowed: its no-override fallback returns
//    viewer.isPrivileged, which silently grants managers.

interface Params {
  params: Promise<{ id: string }>;
}

async function requireAdminOnProject(request: NextRequest, id: string) {
  const viewer = await getViewerContext(request);
  if (!viewer) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const project = await findProjectById(id);
  // Same "does not exist" answer as a real 404, so this endpoint cannot be
  // used to discover which project ids are real.
  if (!project) return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) } as const;
  if (!(await canAccessProject(viewer.username, project))) {
    return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) } as const;
  }

  if ((await resolveProjectDeadlineTier(viewer)) !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Only an administrator can override a Closing %.' },
        { status: 403 }
      )
    } as const;
  }

  return { viewer, project } as const;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requireAdminOnProject(request, id);
  if ('error' in gate) return gate.error;
  const { viewer, project } = gate;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Send a percent and a reason.' }, { status: 400 });
    }

    const raw = (body as { percent?: unknown }).percent;
    const percent = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      return NextResponse.json(
        { error: 'Closing % must be a whole number between 0 and 100.' },
        { status: 400 }
      );
    }

    // Mandatory, and mandatory with something in it — the whole point of the
    // override being allowed at all is that an admin can be asked afterwards
    // why they did it.
    const reasonRaw = (body as { reason?: unknown }).reason;
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason is required to override the calculated Closing %.' },
        { status: 400 }
      );
    }

    // A closed deal's percentage is a fact, not a forecast: resolveClosingPercent
    // reads status first, so an override here would be silently ignored on
    // every read. Refusing is honest; accepting it would record a decision
    // that never takes effect.
    if (project.status === 'won' || project.status === 'lost') {
      return NextResponse.json(
        {
          error: `This project is already marked ${project.status}, so its Closing % is fixed at ${project.status === 'won' ? '100%' : '0%'}. Reopen it before overriding.`
        },
        { status: 400 }
      );
    }

    const before = resolveClosingPercent({
      stage: project.stage,
      status: project.status,
      closing_percent_override:
        project.closing_percent_override === '' ? null : project.closing_percent_override
    });

    const result = await setClosingPercentOverride(id, {
      percent,
      reason,
      actorUserId: viewer.userId
    });
    if (!result) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    // Two records, deliberately. The audit log is the cross-module trail an
    // admin reviews; the timeline event is what the project's own Activity Log
    // shows, so the next person to open this deal can see why the number is
    // not what the stage implies.
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'project',
      entityId: id,
      action: `Closing % overridden to ${percent}%`,
      previousStatus: before.percent === null ? 'unset' : `${before.percent}%`,
      newStatus: `${percent}%`,
      remarks: reason,
      ip: getClientIp(request)
    });

    await appendProjectTimeline(id, {
      by: viewer.username,
      stage: project.stage,
      label: `Closing % overridden to ${percent}% (was ${before.percent === null ? 'unset' : `${before.percent}%`})`,
      remarks: reason
    });

    const fresh = await findProjectById(id);
    return NextResponse.json(fresh ?? result.project);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Removes an override, so the stage's standard figure applies again. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requireAdminOnProject(request, id);
  if ('error' in gate) return gate.error;
  const { viewer, project } = gate;

  try {
    const result = await clearClosingPercentOverride(id);
    if (!result) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    // Nothing was overridden, so nothing happened — no audit row, no timeline
    // entry. Writing either would put a change in the record that a reader
    // would then go looking for.
    if (result.previousPercent === '') {
      return NextResponse.json(result.project);
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'project',
      entityId: id,
      action: 'Closing % override removed',
      previousStatus: `${result.previousPercent}%`,
      newStatus: 'stage default',
      remarks: '',
      ip: getClientIp(request)
    });

    await appendProjectTimeline(id, {
      by: viewer.username,
      stage: project.stage,
      label: `Closing % override removed (was ${result.previousPercent}%) — back to the stage default`
    });

    const fresh = await findProjectById(id);
    return NextResponse.json(fresh ?? result.project);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
