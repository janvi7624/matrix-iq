import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { createFeedbackForm, listMyFeedbackForms } from '@/lib/productFeedbackFormStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any logged-in user's own list of Google-Forms-style feedback forms they've
// created asking the team about their product — and creating a new one.
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const forms = await listMyFeedbackForms(user.id);
    return NextResponse.json(forms);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const questions = Array.isArray(body?.questions) ? body.questions : [];
  if (!title) return NextResponse.json({ error: 'A form title is required' }, { status: 400 });
  if (!questions.length) return NextResponse.json({ error: 'Add at least one question' }, { status: 400 });

  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const form = await createFeedbackForm(user.id, title.slice(0, 255), description.slice(0, 2000), questions);
    return NextResponse.json(form, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
