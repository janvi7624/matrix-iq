import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageTargets } from '@/lib/targetAccess';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { buildPeriod, currentFiscalYear, periodContainingDate, periodEndExclusive, PeriodRange, TargetPeriodType } from '@/lib/targetPeriod';
import { findSalesTarget, updateSalesTargetNotes } from '@/lib/salesTargetStore';
import { updateQuotationStatus } from '@/lib/quotationStore';
import { appendProjectTimeline, findProjectById } from '@/lib/projectStore';
import { db } from '@/lib/db';
import { Op } from 'sequelize';
import { PROJECT_STAGES, ProjectStage, QuotationStatus } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

const VALID_PERIOD_TYPES: TargetPeriodType[] = ['monthly', 'quarterly', 'half_yearly', 'annual'];
const VALID_QUOTATION_STATUSES: QuotationStatus[] = ['draft', 'sent', 'approved', 'rejected'];

function resolvePeriod(periodType: TargetPeriodType, fiscalYear: string, periodKey: string | null): PeriodRange {
  return periodKey !== null ? buildPeriod(periodType, fiscalYear, periodKey || undefined) : periodContainingDate(periodType);
}

async function buildPayload(employeeId: string, period: PeriodRange) {
  const target = await findSalesTarget(employeeId, period.periodType, period.periodStart);

  const rows = await db.Quotation.findAll({
    where: {
      created_by: employeeId,
      created_at: { [Op.gte]: period.periodStart, [Op.lt]: periodEndExclusive(period.periodEnd) }
    } as never,
    include: [{ model: db.Project, as: 'project', attributes: ['id', 'client_name', 'company', 'stage', 'status'] }] as never,
    order: [['created_at', 'DESC']]
  });

  const quotations = rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const project = plain.project as { id?: string; client_name?: string; company?: string; stage?: string; status?: string } | null;
    return {
      id: plain.id as string,
      quotationNumber: (plain.quotation_number as string) ?? '',
      clientName: (plain.client_name as string) || (plain.client_company as string) || '',
      status: plain.status as string,
      total: Number(plain.total) || 0,
      project: project ? { id: project.id, label: project.client_name || project.company || '', stage: project.stage, status: project.status } : null
    };
  });

  return {
    target: target
      ? { id: target.id, periodType: target.periodType, displayPeriod: target.displayPeriod, targetAmount: target.targetAmount, notes: target.notes }
      : { id: null, periodType: period.periodType, displayPeriod: period.displayPeriod, targetAmount: 0, notes: '' },
    quotations
  };
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const employeeId = url.searchParams.get('employeeId') || '';
  if (!employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });

  try {
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(employeeId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const periodTypeParam = url.searchParams.get('periodType');
    const periodType: TargetPeriodType = VALID_PERIOD_TYPES.includes(periodTypeParam as TargetPeriodType) ? (periodTypeParam as TargetPeriodType) : 'monthly';
    const fiscalYear = url.searchParams.get('fiscalYear') || currentFiscalYear();
    const period = resolvePeriod(periodType, fiscalYear, url.searchParams.get('periodKey'));

    return NextResponse.json(await buildPayload(employeeId, period));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Discriminated write — never touches an achievement amount directly. Each
// action delegates to the existing authoritative store function for that
// record type, so the target's own achievement (always computed live) picks
// up the change on its very next read with no separate figure to keep in sync.
export async function PATCH(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const scope = await resolveVisibilityScope(viewer.username);
    const inScope = (employeeId: string) => scope.seesOrgWide || (scope.scopedUserIds ?? []).includes(employeeId);

    let employeeId = '';
    let period: PeriodRange;

    if (body.action === 'quotation_status') {
      if (!VALID_QUOTATION_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid quotation status' }, { status: 400 });
      const quotation = await db.Quotation.findByPk(body.quotationId, { attributes: ['id', 'created_by', 'createdAt'] });
      if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
      employeeId = quotation.get('created_by') as string;
      if (!inScope(employeeId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      await updateQuotationStatus(body.quotationId, body.status, viewer.username);
      period = periodContainingDate('monthly', quotation.get('createdAt') as Date);
    } else if (body.action === 'project_stage') {
      const stage: ProjectStage | undefined = PROJECT_STAGES.includes(body.stage) ? body.stage : undefined;
      if (!stage) return NextResponse.json({ error: 'Invalid project stage' }, { status: 400 });
      const project = await findProjectById(body.projectId);
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      const projectRow = await db.Project.findByPk(body.projectId, { attributes: ['created_by'] });
      employeeId = (projectRow?.get('created_by') as string) ?? '';
      if (!inScope(employeeId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      await appendProjectTimeline(body.projectId, { by: viewer.username, stage, label: `Stage moved to ${stage.replace(/_/g, ' ')}` }, stage);
      period = periodContainingDate('monthly');
    } else if (body.action === 'notes') {
      const target = await db.SalesTarget.findByPk(body.targetId);
      if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
      employeeId = target.get('employee_id') as string;
      if (!inScope(employeeId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      await updateSalesTargetNotes(body.targetId, typeof body.notes === 'string' ? body.notes : '', viewer.userId);
      period = {
        periodType: target.get('period_type') as TargetPeriodType,
        fiscalYear: target.get('fiscal_year') as string,
        periodKey: '',
        periodStart: target.get('period_start') as string,
        periodEnd: target.get('period_end') as string,
        displayPeriod: target.get('display_period') as string
      };
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    // A caller can still request a specific period to view after the write
    // (e.g. re-render the period the form was already showing).
    if (body.periodType && VALID_PERIOD_TYPES.includes(body.periodType) && body.fiscalYear) {
      period = resolvePeriod(body.periodType, body.fiscalYear, body.periodKey ?? null);
    }

    return NextResponse.json(await buildPayload(employeeId, period));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
