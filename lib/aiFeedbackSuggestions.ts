import { ProductFeedbackQuestion, ProductFeedbackQuestionType } from './types';

// Free-tier AI question suggestions via Groq (console.groq.com) — no cost,
// but a GROQ_API_KEY must be set in .env.local. Returns null (never throws)
// whenever the key is missing, the call fails, or the model's reply isn't
// usable JSON, so the caller always has a safe path back to the
// deterministic rule-based bank in lib/productFeedbackSuggestions.ts.
// llama-3.3-70b-versatile was retired from Groq's free tier — gpt-oss-120b
// is the current free-tier model with the best instruction-following for
// this JSON-only task (verified against /v1/models for this account).
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function aiSuggestionsAvailable(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

interface RawQuestion {
  label?: unknown;
  type?: unknown;
  options?: unknown;
}

function sanitize(raw: unknown): Omit<ProductFeedbackQuestion, 'id'>[] {
  if (!Array.isArray(raw)) return [];
  const out: Omit<ProductFeedbackQuestion, 'id'>[] = [];
  for (const item of raw as RawQuestion[]) {
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    const type = item?.type;
    if (!label || !['text', 'rating', 'choice'].includes(type as string)) continue;
    const options = Array.isArray(item?.options)
      ? (item.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, 8)
      : undefined;
    out.push({ label: label.slice(0, 200), type: type as ProductFeedbackQuestionType, ...(type === 'choice' ? { options: options?.length ? options : ['Yes', 'No'] } : {}) });
  }
  return out.slice(0, 8);
}

export async function suggestQuestionsWithAi(params: {
  productName: string;
  category: string;
  pendingValue: number;
  wonValue: number;
  lostValue: number;
}): Promise<Omit<ProductFeedbackQuestion, 'id'>[] | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const { productName, category, pendingValue, wonValue, lostValue } = params;
  const prompt = `You are helping a Product Manager at a company selling "${productName}" (category: ${category || 'general'}) write an internal feedback survey for their own sales/support team (NOT the end customer). Context on this product so far: pending deal value ${pendingValue}, won value ${wonValue}, lost value ${lostValue}.

Write 5-6 short, specific survey questions the internal team would actually know the answer to (based on talking to clients), covering things like pricing feedback, common objections, feature gaps, and reasons deals are won/lost. Mix question types.

Respond with ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"label": "...", "type": "text"}, {"label": "...", "type": "rating"}, {"label": "...", "type": "choice", "options": ["A","B","C"]}]
type must be one of "text", "rating", "choice". Only "choice" questions have "options".`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 800
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) return null;
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;

    // The model sometimes wraps JSON in ```json fences despite the
    // instruction not to — strip those before parsing instead of failing.
    const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    const clean = sanitize(parsed);
    return clean.length ? clean : null;
  } catch {
    return null;
  }
}
