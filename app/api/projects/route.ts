import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listLastRemarks, projectStore } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { ProjectPriority, ProjectRecord, UserRecord } from '@/lib/types';
import { findUserById } from '@/lib/userStore';
import { requestTechnicalPerson } from '@/lib/projectTechnicalRequest';
import { findSalesPersonCandidate, notifySalesPersonAssigned, SalesOwnerError } from '@/lib/projectSalesOwner';
import { isTechnicalRole } from '@/lib/technicalRoles';
import { getClientIp } from '@/lib/requestIp';

const VALID_PRIORITY: ProjectPriority[] = ['low', 'medium', 'high'];

// '' (not given) is valid — only reject an actual out-of-range/non-integer
// value. Accepts a number OR a numeric string (the New Project form's plain
// <input type="number"> value round-trips as a string through JSON, same as
// every other form field on this page). Returns undefined for "invalid",
// '' for "blank/unset".
function parseClosingProbability(value: unknown): number | '' | undefined {
  if (value === '' || value === undefined || value === null) return '';
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(num) || num < 0 || num > 100) return undefined;
  return num;
}

// Approx. Project Price — mandatory on manual creation. Accepts a number or
// a numeric string (same `<input type="number">`-round-trips-as-string
// pattern as parseClosingProbability above); rejects anything non-numeric,
// zero, or negative. Never accepts a pre-formatted currency string (e.g.
// "₹12,50,000") — the UI formats for display only, the raw number is what's
// ever sent/stored.
function parseApproxPrice(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return num;
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await projectStore.listLight(viewer.username, viewer.isPrivileged);
    const lastRemarks = await listLastRemarks(records.map((r) => r.id));
    const withRemarks = records.map((r) => {
      const last = lastRemarks[r.id];
      return last ? { ...r, last_remark: last.remark, last_remark_at: last.at, last_remark_by: last.by } : r;
    });
    return NextResponse.json(withRemarks);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Technical staff (engineers included) may originate a Sales project when
  // needed, but always FOR a sales person — see the salesPersonId handling
  // below. Technical staff with a privileged role keep the privileged path.
  const isTechnicalCreator = !viewer.isPrivileged && isTechnicalRole(viewer.role);

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const company = typeof body.company === 'string' ? body.company.trim() : '';
  if (!clientName && !company) {
    return NextResponse.json({ error: 'Client name or company is required' }, { status: 400 });
  }

  const source = typeof body.source === 'string' ? body.source.trim() : '';
  if (!source) {
    return NextResponse.json({ error: 'Source is required' }, { status: 400 });
  }

  const closingProbabilityPercent = parseClosingProbability(body.closingProbabilityPercent);
  if (closingProbabilityPercent === undefined) {
    return NextResponse.json({ error: 'Closing probability must be a whole number between 0 and 100' }, { status: 400 });
  }

  const approxPrice = parseApproxPrice(body.approxPrice);
  if (approxPrice === undefined) {
    return NextResponse.json({ error: 'Approx. Project Price is required and must be a positive number' }, { status: 400 });
  }

  const now = new Date().toISOString();
  // Only a privileged role may attribute a project to someone else (e.g. an
  // Admin entering data on a sales rep's behalf) — otherwise created_by IS
  // the ownership/visibility key (see projectStore.list). This resolves the
  // sales person from an actual user id (the UI now offers a picker, not
  // free text) so a typo/case mismatch can never silently drop created_by
  // to null and make the project invisible to its own owner — previously
  // `salesPerson` was a free-text string matched case-sensitively against
  // usernames in projectStore.create(), and any mismatch (e.g. "Pankaj" vs
  // the real username "pankaj") resolved to a NULL owner with no error.
  //
  // A technical creator MUST name the sales person (an active Sales / GEM -
  // Sales member): the project is theirs — pipeline, KPIs, follow-ups — and a
  // project owned by technical staff would be invisible to the Sales side.
  const requestedSalesPersonId = typeof body.salesPersonId === 'string' ? body.salesPersonId.trim() : '';
  let requestedSalesPersonUser: UserRecord | undefined;
  if (isTechnicalCreator) {
    try {
      requestedSalesPersonUser = await findSalesPersonCandidate(requestedSalesPersonId);
    } catch (error) {
      if (error instanceof SalesOwnerError) return NextResponse.json({ error: error.message }, { status: error.status });
      return apiErrorResponse(error);
    }
  } else if (viewer.isPrivileged && requestedSalesPersonId) {
    requestedSalesPersonUser = await findUserById(requestedSalesPersonId);
  }
  const salesPerson = requestedSalesPersonUser ? requestedSalesPersonUser.username : viewer.username;
  const assignedTechnicalPersonId = typeof body.assignedTechnicalPersonId === 'string' ? body.assignedTechnicalPersonId.trim() : '';
  const record: ProjectRecord = {
    id: `${Date.now()}`,
    created_at: now,
    created_by: salesPerson,
    client_name: clientName,
    company,
    contact_person: typeof body.contactPerson === 'string' ? body.contactPerson.trim() : '',
    alt_contact_phone: typeof body.altContactPhone === 'string' ? body.altContactPhone.trim() : '',
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
    email: typeof body.email === 'string' ? body.email.trim() : '',
    address: typeof body.address === 'string' ? body.address.trim() : '',
    sales_person: salesPerson,
    source,
    status: 'active',
    stage: 'cold_call',
    cold_call_responded: '',
    priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
    expected_closing_date: typeof body.expectedClosingDate === 'string' ? body.expectedClosingDate : '',
    next_follow_up_date: typeof body.nextFollowUpDate === 'string' ? body.nextFollowUpDate : '',
    remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
    closing_probability_percent: closingProbabilityPercent,
    approx_price: approxPrice,
    notes: [],
    attachments: [],
    // Never set on creation — see the technical-person request below.
    assigned_technical_person_id: '',
    assigned_technical_person_name: '',
    tms_project_id: '',
    lead_confirmation_status: '',
    confirmed_by: '',
    confirmed_at: '',
    // `by` is the true originator even after ownership moves to a sales
    // person — lib/projectSalesOwner.ts reads it back.
    // "for <sales person>" goes in the label, not remarks — remarks surface
    // as the project's "Last Remark" on the dashboard.
    timeline: [{
      id: `${Date.now()}`, at: now, by: viewer.username, stage: 'created',
      label: requestedSalesPersonUser && requestedSalesPersonUser.username !== viewer.username ? `Project created for ${requestedSalesPersonUser.name}` : 'Project created',
      remarks: ''
    }],
    updated_at: now,
    last_remark: '',
    last_remark_at: '',
    last_remark_by: ''
  };

  try {
    let created = await projectStore.create(record);
    // A technical person picked at creation goes through the same approval as
    // one picked later (lib/projectTechnicalRequest.ts): assigned now only if
    // this viewer may commit that person's time, otherwise requested. A
    // technical creator is the project's technical person themselves — that
    // is also what keeps it in their list once the sales person owns it.
    const technicalPersonId = isTechnicalCreator ? viewer.userId : assignedTechnicalPersonId;
    let warning = '';
    if (technicalPersonId) {
      try {
        const result = await requestTechnicalPerson(created, technicalPersonId, viewer, { note: '', neededBy: '' }, getClientIp(request));
        if (result.mode === 'assigned' && result.project) created = result.project;
      } catch (error) {
        // The Sales project above was already created either way.
        if (isTechnicalCreator) {
          console.error(`[projects] Could not add ${viewer.username} as technical person on new project ${created.id}:`, error instanceof Error ? error.message : error);
          warning = 'The project was created, but you could not be added as its technical person — ask an admin to add you.';
        }
      }
    }
    if (requestedSalesPersonUser) await notifySalesPersonAssigned(created, requestedSalesPersonUser, viewer);
    return NextResponse.json(warning ? { ...created, warning } : created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
