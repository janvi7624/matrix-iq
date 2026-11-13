import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { findFeedbackFormById, submitFeedbackFormResponse } from '@/lib/productFeedbackFormStore';
import { apiErrorResponse } from '@/lib/apiError';

// The "fill it out" side — any logged-in internal employee may open and
// answer a Product Manager's feedback form, not just the owner. The owner
// never sees who-said-what beyond respondent_name on their own responses
// list (app/api/product-manager/feedback-forms/[id]/route.ts).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const form = await findFeedbackFormById(id);
    if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    return NextResponse.json(form);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const answers = body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return NextResponse.json({ error: 'answers must be an object keyed by question id' }, { status: 400 });
  }

  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await findFeedbackFormById(id);
    if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    if (form.status === 'closed') return NextResponse.json({ error: 'This form is closed and no longer accepting responses' }, { status: 409 });

    const validIds = new Set(form.questions.map((q) => q.id));
    const cleanAnswers: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
      if (!validIds.has(key)) continue;
      if (typeof value === 'string') cleanAnswers[key] = value.slice(0, 2000);
      else if (typeof value === 'number' && Number.isFinite(value)) cleanAnswers[key] = value;
    }

    const response = await submitFeedbackFormResponse(id, user.id, user.name || user.username, cleanAnswers);
    if (!response) return NextResponse.json({ error: 'Could not submit response' }, { status: 400 });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
