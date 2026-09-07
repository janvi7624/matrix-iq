import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { HrRecurringTaskTemplateRecord, HrRecurrenceType } from './types';
import { generalTaskStore } from './generalTaskStore';

const INCLUDES = [
  { model: db.Department, as: 'department', attributes: ['id', 'name'] },
  { model: db.User, as: 'assignee', attributes: ['id', 'username', 'name'] },
  { model: db.HrTaskCategory, as: 'category', attributes: ['id', 'name'] },
  { model: db.User, as: 'creator', attributes: ['id', 'username'] }
];

function toRecord(row: Model): HrRecurringTaskTemplateRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const department = plain.department as { name?: string } | null;
  const assignee = plain.assignee as { name?: string; username?: string } | null;
  const category = plain.category as { id?: string; name?: string } | null;
  const creator = plain.creator as { username?: string } | null;
  return {
    id: plain.id as string,
    title: plain.title as string,
    description: (plain.description as string) ?? '',
    department_id: plain.department_id as string,
    department_name: department?.name ?? '',
    assignee_id: plain.assignee_id as string,
    assignee_name: assignee?.name ?? assignee?.username ?? '',
    category_id: (plain.category_id as string) ?? '',
    category_name: category?.name ?? '',
    priority: plain.priority as never,
    requires_review: !!plain.requires_review,
    recurrence_type: plain.recurrence_type as HrRecurrenceType,
    recurrence_config: (plain.recurrence_config as { weekday?: number; dayOfMonth?: number }) || {},
    active: !!plain.active,
    created_by: creator?.username ?? '',
    created_at: plain.createdAt instanceof Date ? plain.createdAt.toISOString() : String(plain.createdAt || '')
  };
}

export async function listTemplates(activeOnly = false): Promise<HrRecurringTaskTemplateRecord[]> {
  const where = activeOnly ? { active: true } : {};
  const rows = await db.HrRecurringTaskTemplate.findAll({ where: where as never, include: INCLUDES as never, order: [['title', 'ASC']] });
  return rows.map(toRecord);
}

export async function createTemplate(input: {
  title: string;
  description?: string;
  departmentId: string;
  assigneeId: string;
  categoryId?: string;
  priority: string;
  requiresReview: boolean;
  recurrenceType: HrRecurrenceType;
  recurrenceConfig: { weekday?: number; dayOfMonth?: number };
  createdByUsername: string;
}): Promise<HrRecurringTaskTemplateRecord> {
  const creator = await db.User.findOne({ where: { username: input.createdByUsername } as never, attributes: ['id'] });
  const row = await db.HrRecurringTaskTemplate.create({
    title: input.title,
    description: input.description || '',
    department_id: input.departmentId,
    assignee_id: input.assigneeId,
    category_id: input.categoryId || null,
    priority: input.priority,
    requires_review: input.requiresReview,
    recurrence_type: input.recurrenceType,
    recurrence_config: input.recurrenceConfig,
    active: true,
    created_by: creator ? creator.get('id') : null
  } as never);
  const withAssoc = await db.HrRecurringTaskTemplate.findByPk(row.get('id') as string, { include: INCLUDES as never });
  return toRecord(withAssoc as Model);
}

export async function setTemplateActive(id: string, active: boolean): Promise<HrRecurringTaskTemplateRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.HrRecurringTaskTemplate.findByPk(id);
  if (!row) return null;
  await row.update({ active } as never);
  const withAssoc = await db.HrRecurringTaskTemplate.findByPk(id, { include: INCLUDES as never });
  return toRecord(withAssoc as Model);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ISO-8601 week number — used only as a stable, unique weekly period key,
// not for any calendar display.
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(weekNo)}`;
}

function periodKeyFor(type: HrRecurrenceType, now: Date): string {
  if (type === 'daily') return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (type === 'weekly') return isoWeekKey(now);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

// "Is today the day this template should fire" — daily always; weekly on
// its configured weekday (1=Mon..7=Sun); monthly on its configured
// day-of-month, clamped to the last real day of shorter months so e.g.
// dayOfMonth=31 still fires once in February.
function isDueToday(type: HrRecurrenceType, config: { weekday?: number; dayOfMonth?: number }, now: Date): boolean {
  if (type === 'daily') return true;
  if (type === 'weekly') {
    const isoWeekday = now.getDay() === 0 ? 7 : now.getDay();
    return isoWeekday === (config.weekday || 1);
  }
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const targetDay = Math.min(config.dayOfMonth || 1, lastDayOfMonth);
  return now.getDate() === targetDay;
}

// Lazily materializes today's/this-period's instance for every active
// template that's due — called from the HR Dashboard / Daily Tasks GET,
// since there's no scheduler in this app. The DB's unique
// (recurrence_template_id, recurrence_period_key) constraint makes this
// safe under concurrent requests (a duplicate insert just fails silently
// here and the existing row is used).
export async function ensureRecurringInstancesForToday(now: Date = new Date()): Promise<void> {
  const templates = await listTemplates(true);
  for (const template of templates) {
    if (!isDueToday(template.recurrence_type, template.recurrence_config, now)) continue;
    const periodKey = periodKeyFor(template.recurrence_type, now);
    const existing = await db.GeneralTask.findOne({ where: { recurrence_template_id: template.id, recurrence_period_key: periodKey } as never });
    if (existing) continue;

    const deadline = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    try {
      await generalTaskStore.create({
        sourceModule: 'hr',
        title: template.title,
        description: template.description,
        departmentId: template.department_id,
        assigneeId: template.assignee_id,
        priority: template.priority as never,
        requiresReview: template.requires_review,
        category: template.category_name,
        deadline,
        createdByUsername: template.created_by,
        recurrenceTemplateId: template.id,
        recurrencePeriodKey: periodKey
      });
    } catch {
      // Unique-constraint race with a concurrent request — the other
      // request's insert won, nothing to do here.
    }
  }
}
