import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { deleteFeedbackForm, listFeedbackFormResponses, setFeedbackFormStatus } from '@/lib/productFeedbackFormStore';
import { apiErrorResponse } from '@/lib/apiError';

// Owner-only: the responses collected on one of MY forms, plus closing/
// deleting it. Filling the form out as a respondent is the separate
// /api/feedback-forms/[id] route — deliberately not owner-gated.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const responses = await listFeedbackFormResponses(id, user.id);
    if (responses === null) return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    return NextResponse.json(responses);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (status !== 'open' && status !== 'closed') return NextResponse.json({ error: "status must be 'open' or 'closed'" }, { status: 400 });
  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const ok = await setFeedbackFormStatus(id, user.id, status);
    if (!ok) return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const ok = await deleteFeedbackForm(id, user.id);
    if (!ok) return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
