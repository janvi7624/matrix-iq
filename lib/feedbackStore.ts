import { db } from './db';
import { Model } from 'sequelize';

// Staff feedback on MatrixIQ, collected during a fixed window
// (lib/feedbackWindow.ts). The window is enforced at the API layer, not
// here, so an admin reading responses after it closes still works — closing
// the drive must stop new answers, not hide the answers already given.

export interface ModuleFeedbackEntry {
  key: string;
  label: string;
  section: string;
  /** 1-5, or null when they commented without scoring. */
  rating: number | null;
  comment: string;
}

export interface FeedbackResponseRecord {
  id: string;
  username: string;
  name: string;
  role: string;
  department: string;
  designation: string;
  overallRating: number | null;
  overallComment: string;
  moduleFeedback: ModuleFeedbackEntry[];
  worksWell: string;
  slowsMeDown: string;
  missingFeatures: string;
  submittedAt: string;
}

export interface SubmitFeedbackInput {
  userId: string;
  username: string;
  name: string;
  role: string;
  department: string;
  designation: string;
  overallRating: number | null;
  overallComment: string;
  moduleFeedback: ModuleFeedbackEntry[];
  worksWell: string;
  slowsMeDown: string;
  missingFeatures: string;
}

function toRecord(row: Model): FeedbackResponseRecord {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const raw = p.module_feedback;
  return {
    id: p.id as string,
    username: (p.username as string) ?? '',
    name: (p.name as string) ?? '',
    role: (p.role as string) ?? '',
    department: (p.department as string) ?? '',
    designation: (p.designation as string) ?? '',
    overallRating: p.overall_rating === null || p.overall_rating === undefined ? null : Number(p.overall_rating),
    overallComment: (p.overall_comment as string) ?? '',
    // Defensive: JSONB can hold anything a past version wrote.
    moduleFeedback: Array.isArray(raw) ? (raw as ModuleFeedbackEntry[]) : [],
    worksWell: (p.works_well as string) ?? '',
    slowsMeDown: (p.slows_me_down as string) ?? '',
    missingFeatures: (p.missing_features as string) ?? '',
    submittedAt: p.submitted_at instanceof Date ? (p.submitted_at as Date).toISOString() : String(p.submitted_at ?? '')
  };
}

/**
 * Save one person's feedback, replacing their previous answer if they come
 * back and change it.
 *
 * findOne + update/create rather than findOrCreate or upsert: this database
 * role has no CREATE TEMP privilege, and Sequelize's findOrCreate needs it
 * for the transaction it wraps itself in — it type-checks, passes review,
 * and throws the first time it actually runs. The unique index on username
 * is the real guard against a double-click creating two rows; this is the
 * ordinary path.
 */
export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackResponseRecord> {
  const attrs = {
    user_id: input.userId || null,
    username: input.username,
    name: input.name,
    role: input.role,
    department: input.department || null,
    designation: input.designation || null,
    overall_rating: input.overallRating,
    overall_comment: input.overallComment || null,
    module_feedback: input.moduleFeedback,
    works_well: input.worksWell || null,
    slows_me_down: input.slowsMeDown || null,
    missing_features: input.missingFeatures || null,
    submitted_at: new Date()
  };

  const existing = await db.FeedbackResponse.findOne({ where: { username: input.username } as never });
  if (existing) {
    await existing.update(attrs as never);
    return toRecord(existing);
  }
  const created = await db.FeedbackResponse.create(attrs as never);
  return toRecord(created);
}

/** This person's own answer, so the form can show it filled in again. */
export async function findMyFeedback(username: string): Promise<FeedbackResponseRecord | null> {
  const row = await db.FeedbackResponse.findOne({ where: { username } as never });
  return row ? toRecord(row) : null;
}

/** Every response, newest first. Admin only — gated at the route. */
export async function listAllFeedback(): Promise<FeedbackResponseRecord[]> {
  const rows = await db.FeedbackResponse.findAll({ order: [['submitted_at', 'DESC']] });
  return rows.map(toRecord);
}
