import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The actual bug report: an employee gets their department manager's
// approval to edit an already-submitted report, but every save through
// their own Daily Report page still failed with "This report has already
// been filed" — including adding a new task, the thing they actually
// wanted to do. Root cause: POST /api/daily-reports (the ONLY endpoint the
// employee's own page ever saves through — app/api/daily-reports/route.ts)
// never looked up the approved grant or passed editAuthority to
// saveReport() at all, unlike PATCH /api/daily-reports/[id] (used for a
// manager's own edit), which always did. This pins the fix: POST now looks
// up the live grant itself and passes it through.

vi.mock('@/lib/dailyReportApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dailyReportApi')>();
  return { ...actual, guardDailyReport: vi.fn(), dailyReportErrorResponse: vi.fn((e: unknown) => new Response(JSON.stringify({ error: String(e) }), { status: 500 })) };
});
vi.mock('@/lib/dailyReportService', () => ({ resolveEmployeeIdentity: vi.fn() }));
vi.mock('@/lib/dailyReportStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dailyReportStore')>();
  return { ...actual, findReportForDate: vi.fn(), saveReport: vi.fn() };
});
vi.mock('@/lib/dailyReportEditRequestStore', () => ({ findLiveEditRequest: vi.fn() }));
vi.mock('@/lib/dailyReportNotify', () => ({ notifyReportSubmitted: vi.fn() }));
vi.mock('@/lib/dailyReportAccess', () => ({ resolveReportManagers: vi.fn() }));
vi.mock('@/lib/dailyReportTemplateStore', () => ({ findAssignmentByDepartmentId: vi.fn() }));
vi.mock('@/lib/auditLogStore', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/requestIp', () => ({ getClientIp: vi.fn(() => '') }));

import { guardDailyReport } from '@/lib/dailyReportApi';
import { resolveEmployeeIdentity } from '@/lib/dailyReportService';
import { findReportForDate, saveReport } from '@/lib/dailyReportStore';
import { findLiveEditRequest } from '@/lib/dailyReportEditRequestStore';
import { POST } from '@/app/api/daily-reports/route';

const guardMock = vi.mocked(guardDailyReport);
const identityMock = vi.mocked(resolveEmployeeIdentity);
const findReportMock = vi.mocked(findReportForDate);
const saveReportMock = vi.mocked(saveReport);
const findGrantMock = vi.mocked(findLiveEditRequest);

const VIEWER = { userId: 'emp-1', username: 'alice', role: 'user', isPrivileged: false };

function request(body: Record<string, unknown>) {
  return new NextRequest('https://app.example.com/api/daily-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function savedReportResult(over: Record<string, unknown> = {}) {
  return {
    report: { id: 'report-1', entries: [], submission_status: 'SUBMITTED', submitted_at: '', deadline_at: '', is_late: false, ...over },
    justSubmitted: false,
    wasEdited: false
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  guardMock.mockResolvedValue({ viewer: VIEWER } as never);
  identityMock.mockResolvedValue({ id: 'emp-1', departmentId: 'dept-1', departmentName: 'AI', name: 'Alice' } as never);
  saveReportMock.mockResolvedValue(savedReportResult() as never);
});

describe('POST /api/daily-reports — passes editAuthority through for an already-submitted report', () => {
  it('passes editAuthority: "grant" when the employee holds a live, APPROVED grant', async () => {
    findReportMock.mockResolvedValue({ id: 'report-1', submission_status: 'SUBMITTED' } as never);
    findGrantMock.mockResolvedValue({ status: 'APPROVED' } as never);

    const res = await POST(request({ reportDate: '2026-10-29', mode: 'draft', entries: [{ task_description: 'A new task' }] }));

    expect(res.status).toBeLessThan(400);
    expect(saveReportMock).toHaveBeenCalledWith(expect.objectContaining({ editAuthority: 'grant' }));
  });

  it('passes no editAuthority when there is no live grant — the pre-fix behavior, and still correct without one', async () => {
    findReportMock.mockResolvedValue({ id: 'report-1', submission_status: 'SUBMITTED' } as never);
    findGrantMock.mockResolvedValue(undefined);

    await POST(request({ reportDate: '2026-10-29', mode: 'draft', entries: [] }));

    expect(saveReportMock).toHaveBeenCalledWith(expect.objectContaining({ editAuthority: undefined }));
  });

  it('never looks up a grant for a brand-new report (nothing submitted yet to hold one against)', async () => {
    findReportMock.mockResolvedValue(null);

    await POST(request({ reportDate: '2026-10-29', mode: 'draft', entries: [] }));

    expect(findGrantMock).not.toHaveBeenCalled();
    expect(saveReportMock).toHaveBeenCalledWith(expect.objectContaining({ editAuthority: undefined }));
  });

  it('never looks up a grant for an existing but still-DRAFT report', async () => {
    findReportMock.mockResolvedValue({ id: 'report-1', submission_status: 'DRAFT' } as never);

    await POST(request({ reportDate: '2026-10-29', mode: 'draft', entries: [] }));

    expect(findGrantMock).not.toHaveBeenCalled();
    expect(saveReportMock).toHaveBeenCalledWith(expect.objectContaining({ editAuthority: undefined }));
  });

  it('does not treat a PENDING (not yet decided) request as a usable grant', async () => {
    findReportMock.mockResolvedValue({ id: 'report-1', submission_status: 'SUBMITTED' } as never);
    findGrantMock.mockResolvedValue({ status: 'PENDING' } as never);

    await POST(request({ reportDate: '2026-10-29', mode: 'draft', entries: [] }));

    expect(saveReportMock).toHaveBeenCalledWith(expect.objectContaining({ editAuthority: undefined }));
  });
});
