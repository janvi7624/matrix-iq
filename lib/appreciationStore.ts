import { QueryTypes } from 'sequelize';
import { sequelize } from './db';

// Employee Appreciation storage (table employee_appreciations — see
// db/migrations/20261114150000-create-employee-appreciations.js). Raw SQL so
// nothing else in the app loads this table, and so a deploy that lands before
// the migration only breaks this feature (with a clear message), not others.

// Retired as form inputs (the nomination form now asks for the task dates
// below instead) but kept as read models: existing rows, and the reward a
// decided appreciation may still carry (set by HR, never by the nominating
// manager), still need to read back correctly.
export const APPRECIATION_CATEGORIES = [
  'Outstanding Performance',
  'Teamwork',
  'Customer Delight',
  'Innovation',
  'Going the Extra Mile',
  'Leadership',
  'Other'
] as const;

export const REWARD_TYPES = ['none', 'certificate', 'gift_voucher', 'cash'] as const;
export type RewardType = (typeof REWARD_TYPES)[number];
export type AppreciationStatus = 'pending' | 'approved' | 'rejected';

export const TIME_SAVINGS_UNITS = ['days', 'hours', 'mins'] as const;
export type TimeSavingsUnit = (typeof TIME_SAVINGS_UNITS)[number];

// The "Savings" block — every field optional, entered free-form by the
// nominating manager. Plain strings throughout (not numbers): a manager
// writing "~2" or "varies by site" is real data this shouldn't reject, and
// nothing downstream does arithmetic on these.
export interface AppreciationSavings {
  costSavingsPerMonth: string;
  timeSavingsValue: string;
  timeSavingsUnit: TimeSavingsUnit | '';
  energySavings: string;
  teamCostSavings: string;
  miscellaneous: string;
}

export const EMPTY_SAVINGS: AppreciationSavings = {
  costSavingsPerMonth: '',
  timeSavingsValue: '',
  timeSavingsUnit: '',
  energySavings: '',
  teamCostSavings: '',
  miscellaneous: ''
};

export interface AppreciationRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_department: string;
  employee_designation: string;
  nominated_by: string | null;
  nominated_by_name: string;
  // Retired input — see the comment above APPRECIATION_CATEGORIES. Empty on
  // every appreciation submitted since the task-dates redesign.
  category: string;
  // Retired input, same reasoning — superseded by task_completion_date.
  achievement_date: string | null;
  task_given_date: string;
  task_deadline_date: string;
  task_completion_date: string;
  savings: AppreciationSavings;
  description: string;
  attachment_url: string;
  reward_type: RewardType;
  reward_amount: number | null;
  status: AppreciationStatus;
  hr_reviewer_id: string | null;
  hr_reviewer_name: string;
  hr_remarks: string;
  decided_at: string | null;
  created_at: string;
}

export class AppreciationsUnavailableError extends Error {
  constructor() {
    super('Employee Appreciation is not set up yet — the database update has not been applied.');
  }
}

function isMissingTable(error: unknown): boolean {
  const e = error as { original?: { code?: string }; parent?: { code?: string } };
  return (e?.original?.code ?? e?.parent?.code) === '42P01';
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isMissingTable(error)) throw new AppreciationsUnavailableError();
    throw error;
  }
}

const COLUMNS = `id, employee_id, employee_name, employee_department, employee_designation, nominated_by,
  nominated_by_name, category, to_char(achievement_date, 'YYYY-MM-DD') AS achievement_date,
  to_char(task_given_date, 'YYYY-MM-DD') AS task_given_date,
  to_char(task_deadline_date, 'YYYY-MM-DD') AS task_deadline_date,
  to_char(task_completion_date, 'YYYY-MM-DD') AS task_completion_date,
  savings, description,
  attachment_url, reward_type, reward_amount::float AS reward_amount, status, hr_reviewer_id, hr_reviewer_name,
  hr_remarks, decided_at, created_at`;

export interface CreateAppreciationInput {
  employeeId: string;
  employeeName: string;
  employeeDepartment: string;
  employeeDesignation: string;
  nominatedBy: string;
  nominatedByName: string;
  taskGivenDate: string;
  taskDeadlineDate: string;
  taskCompletionDate: string;
  savings: AppreciationSavings;
  description: string;
  attachmentUrl: string;
}

export async function createAppreciation(input: CreateAppreciationInput): Promise<AppreciationRecord> {
  return run(async () => {
    const rows = await sequelize.query<AppreciationRecord>(
      `INSERT INTO employee_appreciations (employee_id, employee_name, employee_department, employee_designation,
         nominated_by, nominated_by_name, task_given_date, task_deadline_date, task_completion_date, savings,
         description, attachment_url)
       VALUES ($employeeId, $employeeName, $employeeDepartment, $employeeDesignation, $nominatedBy, $nominatedByName,
         $taskGivenDate, $taskDeadlineDate, $taskCompletionDate, $savings::jsonb, $description, $attachmentUrl)
       RETURNING ${COLUMNS}`,
      {
        bind: {
          ...input,
          savings: JSON.stringify(input.savings)
        },
        type: QueryTypes.SELECT
      }
    );
    return rows[0];
  });
}

export async function findAppreciation(id: string): Promise<AppreciationRecord | null> {
  return run(async () => {
    const rows = await sequelize.query<AppreciationRecord>(`SELECT ${COLUMNS} FROM employee_appreciations WHERE id = $id`, {
      bind: { id },
      type: QueryTypes.SELECT
    });
    return rows[0] ?? null;
  });
}

/** Everything (HR / admin view), newest first. */
export async function listAllAppreciations(): Promise<AppreciationRecord[]> {
  return run(() =>
    sequelize.query<AppreciationRecord>(`SELECT ${COLUMNS} FROM employee_appreciations ORDER BY created_at DESC LIMIT 500`, {
      type: QueryTypes.SELECT
    })
  );
}

/** What one manager has submitted, newest first. */
export async function listAppreciationsByNominator(userId: string): Promise<AppreciationRecord[]> {
  return run(() =>
    sequelize.query<AppreciationRecord>(
      `SELECT ${COLUMNS} FROM employee_appreciations WHERE nominated_by = $userId ORDER BY created_at DESC LIMIT 500`,
      { bind: { userId }, type: QueryTypes.SELECT }
    )
  );
}

/** Approved appreciations — company-wide recent ones, or one employee's. */
export async function listApprovedAppreciations(opts: { employeeId?: string; limit?: number }): Promise<AppreciationRecord[]> {
  return run(() =>
    sequelize.query<AppreciationRecord>(
      `SELECT ${COLUMNS} FROM employee_appreciations
       WHERE status = 'approved' ${opts.employeeId ? 'AND employee_id = $employeeId' : ''}
       ORDER BY decided_at DESC NULLS LAST LIMIT $limit`,
      { bind: { ...(opts.employeeId ? { employeeId: opts.employeeId } : {}), limit: opts.limit ?? 20 }, type: QueryTypes.SELECT }
    )
  );
}

/**
 * pending → approved | rejected. Conditional on the row still being pending
 * at write time, so two HR people deciding at once cannot both win.
 */
export async function decideAppreciation(
  id: string,
  decision: 'approved' | 'rejected',
  reviewer: { id: string; name: string },
  remarks: string
): Promise<AppreciationRecord | null> {
  return run(async () => {
    const rows = await sequelize.query<AppreciationRecord>(
      `UPDATE employee_appreciations
       SET status = $decision, hr_reviewer_id = $reviewerId, hr_reviewer_name = $reviewerName, hr_remarks = $remarks,
           decided_at = NOW(), updated_at = NOW()
       WHERE id = $id AND status = 'pending'
       RETURNING ${COLUMNS}`,
      { bind: { id, decision, reviewerId: reviewer.id, reviewerName: reviewer.name, remarks }, type: QueryTypes.SELECT }
    );
    return rows[0] ?? null;
  });
}
