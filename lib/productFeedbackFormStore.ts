import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { ProductFeedbackFormRecord, ProductFeedbackQuestion, ProductFeedbackResponseRecord } from './types';

const ownerInclude = { model: db.User, as: 'owner', attributes: ['id', 'username', 'name'] };

function toFormRecord(row: Model, responseCount: number): ProductFeedbackFormRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const owner = plain.owner as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    product_manager_id: plain.product_manager_id as string,
    pm_name: owner?.name || owner?.username || '',
    title: plain.title as string,
    description: (plain.description as string) ?? '',
    questions: Array.isArray(plain.questions) ? (plain.questions as ProductFeedbackQuestion[]) : [],
    status: plain.status === 'closed' ? 'closed' : 'open',
    response_count: responseCount,
    created_at: plain.created_at instanceof Date ? (plain.created_at as Date).toISOString() : String(plain.created_at ?? '')
  };
}

function toResponseRecord(row: Model): ProductFeedbackResponseRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    form_id: plain.form_id as string,
    respondent_id: (plain.respondent_id as string) ?? null,
    respondent_name: (plain.respondent_name as string) ?? '',
    answers: (plain.answers as Record<string, string | number>) ?? {},
    submitted_at: plain.submitted_at instanceof Date ? (plain.submitted_at as Date).toISOString() : String(plain.submitted_at ?? '')
  };
}

function sanitizeQuestions(input: unknown): ProductFeedbackQuestion[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((q): ProductFeedbackQuestion | null => {
      if (!q || typeof q !== 'object') return null;
      const id = typeof (q as Record<string, unknown>).id === 'string' ? (q as Record<string, unknown>).id as string : '';
      const label = typeof (q as Record<string, unknown>).label === 'string' ? ((q as Record<string, unknown>).label as string).trim() : '';
      const type = (q as Record<string, unknown>).type;
      if (!id || !label || !['text', 'rating', 'choice'].includes(type as string)) return null;
      const options = Array.isArray((q as Record<string, unknown>).options)
        ? ((q as Record<string, unknown>).options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        : undefined;
      return { id, label, type: type as ProductFeedbackQuestion['type'], ...(type === 'choice' ? { options: options || [] } : {}) };
    })
    .filter((q): q is ProductFeedbackQuestion => q !== null);
}

async function countResponses(formIds: string[]): Promise<Map<string, number>> {
  if (!formIds.length) return new Map();
  const rows = await db.ProductFeedbackResponse.findAll({
    attributes: ['form_id'],
    where: { form_id: formIds } as never
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const formId = row.get('form_id') as string;
    counts.set(formId, (counts.get(formId) ?? 0) + 1);
  }
  return counts;
}

export async function createFeedbackForm(ownerId: string, title: string, description: string, questions: unknown): Promise<ProductFeedbackFormRecord> {
  const clean = sanitizeQuestions(questions);
  const row = await db.ProductFeedbackForm.create({
    product_manager_id: ownerId,
    title,
    description: description || '',
    questions: clean,
    status: 'open'
  } as never);
  const full = await db.ProductFeedbackForm.findByPk(row.get('id') as string, { include: [ownerInclude] });
  return toFormRecord(full as Model, 0);
}

/** Every form a Product Manager has created, newest first. */
export async function listMyFeedbackForms(ownerId: string): Promise<ProductFeedbackFormRecord[]> {
  const rows = await db.ProductFeedbackForm.findAll({
    where: { product_manager_id: ownerId } as never,
    include: [ownerInclude],
    order: [['created_at', 'DESC']]
  });
  const counts = await countResponses(rows.map((r) => r.get('id') as string));
  return rows.map((r) => toFormRecord(r, counts.get(r.get('id') as string) ?? 0));
}

/** Any logged-in internal employee may open a form to fill it — not owner-gated. */
export async function findFeedbackFormById(id: string): Promise<ProductFeedbackFormRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.ProductFeedbackForm.findByPk(id, { include: [ownerInclude] });
  if (!row) return null;
  const counts = await countResponses([id]);
  return toFormRecord(row, counts.get(id) ?? 0);
}

export async function setFeedbackFormStatus(id: string, ownerId: string, status: 'open' | 'closed'): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.ProductFeedbackForm.findOne({ where: { id, product_manager_id: ownerId } as never });
  if (!row) return false;
  await row.update({ status } as never);
  return true;
}

export async function deleteFeedbackForm(id: string, ownerId: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db.ProductFeedbackForm.destroy({ where: { id, product_manager_id: ownerId } as never });
  return deleted > 0;
}

/** Owner-only: every answer submitted to one of their forms, newest first. */
export async function listFeedbackFormResponses(formId: string, ownerId: string): Promise<ProductFeedbackResponseRecord[] | null> {
  if (!isUuid(formId)) return null;
  const form = await db.ProductFeedbackForm.findOne({ where: { id: formId, product_manager_id: ownerId } as never });
  if (!form) return null;
  const rows = await db.ProductFeedbackResponse.findAll({ where: { form_id: formId } as never, order: [['submitted_at', 'DESC']] });
  return rows.map(toResponseRecord);
}

/**
 * One person's answer to one form — replacing their previous answer if they
 * resubmit, same pattern as lib/feedbackStore.ts's submitFeedback (findOne +
 * update/create: this DB role has no CREATE TEMP privilege, so
 * findOrCreate/upsert fail at runtime).
 */
export async function submitFeedbackFormResponse(
  formId: string,
  respondentId: string,
  respondentName: string,
  answers: Record<string, string | number>
): Promise<ProductFeedbackResponseRecord | null> {
  if (!isUuid(formId) || !isUuid(respondentId)) return null;
  const form = await db.ProductFeedbackForm.findByPk(formId);
  if (!form || form.get('status') !== 'open') return null;

  const existing = await db.ProductFeedbackResponse.findOne({ where: { form_id: formId, respondent_id: respondentId } as never });
  const attrs = { form_id: formId, respondent_id: respondentId, respondent_name: respondentName, answers, submitted_at: new Date() };
  if (existing) {
    await existing.update(attrs as never);
    return toResponseRecord(existing);
  }
  const created = await db.ProductFeedbackResponse.create(attrs as never);
  return toResponseRecord(created);
}
