import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext, ViewerContext } from './viewerContext';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { DailyReportValidationError, DailyReportConflictError, DailyReportNotFoundError } from './dailyReportStore';
import { DailyReportLeaveClaimError } from './dailyReportLeaveClaimStore';
import { DailyReportWarningError } from './dailyReportWarningStore';
import { InvalidDailyReportConfigError } from './dailyReportConfigStore';
import { InvalidTemplateAssignmentError } from './dailyReportTemplateStore';
import { apiErrorResponse } from './apiError';
import { DailyReportPayloadInput } from './dailyReportTemplates';
import { isIsoDate } from './dailyReportTime';

// The two things every Daily Report route needs: a resolved viewer who
// actually has the module, and one place that turns this module's typed
// errors into the right status code. Without the latter, each of the sixteen
// handlers would re-derive "a validation error is a 400, a missing record is
// a 404" and one of them would get it wrong.

export interface GuardResult {
  viewer: ViewerContext;
}

/**
 * Resolves the viewer and checks the module gate. Returns a NextResponse to
 * return immediately, or the viewer to carry on with.
 *
 * getViewerContext is what also enforces that a deactivated account's
 * already-issued session token stops working (see its own comment) — which
 * matters here because the module emails and warns people, and a departed
 * employee must drop out of it the moment their account is deactivated.
 */
export async function guardDailyReport(request: NextRequest, moduleKey: string): Promise<{ response: NextResponse } | GuardResult> {
  const viewer = await getViewerContext(request);
  if (!viewer) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!(await isModuleAccessAllowed(moduleKey, viewer))) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { viewer };
}

export function isGuardFailure(result: { response: NextResponse } | GuardResult): result is { response: NextResponse } {
  return 'response' in result;
}

/**
 * One error translation for the whole module.
 *
 * Validation issues are returned as a LIST alongside the message, so the
 * client can mark the offending fields rather than showing one toast for a
 * form with four problems. 409 for the duplicate-report case specifically,
 * because the client's correct response there is to reload and show the
 * report that already exists, not to retry the write.
 */
export function dailyReportErrorResponse(error: unknown): NextResponse {
  if (error instanceof DailyReportValidationError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
  }
  if (error instanceof DailyReportConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof DailyReportNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof DailyReportLeaveClaimError ||
    error instanceof DailyReportWarningError ||
    error instanceof InvalidDailyReportConfigError ||
    error instanceof InvalidTemplateAssignmentError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return apiErrorResponse(error);
}

/** 'YYYY-MM-DD' from a query string, or undefined. Rejects anything else. */
export function readDateParam(request: NextRequest, key = 'date'): string | undefined {
  const value = request.nextUrl.searchParams.get(key);
  if (!value) return undefined;
  return isIsoDate(value) ? value : undefined;
}

/**
 * Coerces a posted body into the payload shape the validator expects.
 *
 * Shape-only — it does not decide whether anything is valid, that is
 * validateReportPayload's job against the department's template. What it
 * does guarantee is that a hostile or malformed body becomes an empty
 * structure rather than something that throws deep inside the validator.
 */
export function readPayload(body: unknown): DailyReportPayloadInput | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const input = body as Record<string, unknown>;
  if (!('header' in input) && !('entries' in input) && !('matrix' in input)) return undefined;
  return {
    header: input.header && typeof input.header === 'object' ? (input.header as Record<string, unknown>) : {},
    entries: Array.isArray(input.entries)
      ? input.entries.map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}))
      : [],
    matrix: input.matrix && typeof input.matrix === 'object' ? (input.matrix as Record<string, Record<string, unknown>>) : {}
  };
}

export function readPagination(request: NextRequest): { page: number; pageSize: number } {
  const page = Number(request.nextUrl.searchParams.get('page')) || 1;
  const pageSize = Number(request.nextUrl.searchParams.get('pageSize')) || 50;
  return { page: Math.max(1, page), pageSize: Math.min(200, Math.max(1, pageSize)) };
}
