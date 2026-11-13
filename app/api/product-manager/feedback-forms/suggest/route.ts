import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { aiSuggestionsAvailable, suggestQuestionsWithAi } from '@/lib/aiFeedbackSuggestions';
import { suggestFeedbackQuestions } from '@/lib/productFeedbackSuggestions';
import { apiErrorResponse } from '@/lib/apiError';

// Tries Groq's free-tier LLM first (lib/aiFeedbackSuggestions.ts); falls
// back to the deterministic rule-based bank whenever GROQ_API_KEY isn't
// set, the call fails, or the model's output isn't usable — the client
// never has to know which path it got.
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const productName = typeof body?.productName === 'string' ? body.productName.slice(0, 200) : '';
  const category = typeof body?.category === 'string' ? body.category.slice(0, 120) : '';
  const pendingValue = Number(body?.pendingValue) || 0;
  const wonValue = Number(body?.wonValue) || 0;
  const lostValue = Number(body?.lostValue) || 0;

  try {
    const ai = await suggestQuestionsWithAi({ productName, category, pendingValue, wonValue, lostValue });
    if (ai) return NextResponse.json({ questions: ai, source: 'ai' });

    const fallback = suggestFeedbackQuestions(category, { pending_value: pendingValue, won_value: wonValue, lost_value: lostValue });
    return NextResponse.json({ questions: fallback, source: 'rules' });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET() {
  return NextResponse.json({ aiAvailable: aiSuggestionsAvailable() });
}
