import { Model, Op, UniqueConstraintError } from 'sequelize';
import { db, isUuid } from './db';
import { TargetPeriodType } from './targetPeriod';

export class DuplicateTargetError extends Error {
  constructor() {
    super('A target already exists for this employee and period');
    this.name = 'DuplicateTargetError';
  }
}

export interface SalesTargetRecord {
  id: string;
  employeeId: string;
  employeeUsername: string;
  employeeName: string;
  periodType: TargetPeriodType;
  periodStart: string;
  periodEnd: string;
  displayPeriod: string;
  fiscalYear: string;
  targetAmount: number;
  notes: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSalesTargetInput {
  employeeId: string;
  periodType: TargetPeriodType;
  periodStart: string;
  periodEnd: string;
  displayPeriod: string;
  fiscalYear: string;
  targetAmount: number;
  notes?: string;
  createdBy: string; // creator's user id
}

export interface UpdateSalesTargetInput {
  targetAmount?: number;
  notes?: string;
  updatedBy: string; // updater's user id
}

const INCLUDE_EMPLOYEE = [{ model: db.User, as: 'employee', attributes: ['id', 'username', 'name'] }];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): SalesTargetRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const employee = plain.employee as { id?: string; username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    employeeId: (plain.employee_id as string) ?? '',
    employeeUsername: employee?.username ?? '',
    employeeName: employee?.name ?? employee?.username ?? '',
    periodType: plain.period_type as TargetPeriodType,
    periodStart: plain.period_start ? String(plain.period_start) : '',
    periodEnd: plain.period_end ? String(plain.period_end) : '',
    displayPeriod: (plain.display_period as string) ?? '',
    fiscalYear: (plain.fiscal_year as string) ?? '',
    targetAmount: Number(plain.target_amount) || 0,
    notes: (plain.notes as string) ?? '',
    createdBy: (plain.created_by as string) ?? '',
    updatedBy: (plain.updated_by as string) ?? '',
    createdAt: isoOrEmpty(plain.createdAt),
    updatedAt: isoOrEmpty(plain.updatedAt)
  };
}

export async function createSalesTarget(input: CreateSalesTargetInput): Promise<SalesTargetRecord> {
  try {
    const row = await db.SalesTarget.create({
      employee_id: input.employeeId,
      period_type: input.periodType,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      display_period: input.displayPeriod,
      fiscal_year: input.fiscalYear,
      target_amount: input.targetAmount,
      notes: input.notes || '',
      created_by: input.createdBy,
      updated_by: input.createdBy
    } as never);
    const withAssoc = await db.SalesTarget.findByPk(row.get('id') as string, { include: INCLUDE_EMPLOYEE as never });
    return toRecord(withAssoc as Model);
  } catch (error) {
    if (error instanceof UniqueConstraintError) throw new DuplicateTargetError();
    throw error;
  }
}

export async function updateSalesTarget(id: string, patch: UpdateSalesTargetInput): Promise<SalesTargetRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.SalesTarget.findByPk(id);
  if (!row) return null;

  const attrs: Record<string, unknown> = { updated_by: patch.updatedBy };
  if (patch.targetAmount !== undefined) attrs.target_amount = patch.targetAmount;
  if (patch.notes !== undefined) attrs.notes = patch.notes;
  await row.update(attrs as never);

  const withAssoc = await db.SalesTarget.findByPk(id, { include: INCLUDE_EMPLOYEE as never });
  return toRecord(withAssoc as Model);
}

export async function updateSalesTargetNotes(id: string, notes: string, updatedBy: string): Promise<SalesTargetRecord | null> {
  return updateSalesTarget(id, { notes, updatedBy });
}

export async function deleteSalesTarget(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.SalesTarget.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export async function findSalesTargetById(id: string): Promise<SalesTargetRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.SalesTarget.findByPk(id, { include: INCLUDE_EMPLOYEE as never });
  return row ? toRecord(row) : undefined;
}

export async function findSalesTarget(employeeId: string, periodType: TargetPeriodType, periodStart: string): Promise<SalesTargetRecord | undefined> {
  if (!isUuid(employeeId)) return undefined;
  const row = await db.SalesTarget.findOne({
    where: { employee_id: employeeId, period_type: periodType, period_start: periodStart } as never,
    include: INCLUDE_EMPLOYEE as never
  });
  return row ? toRecord(row) : undefined;
}

export interface ListSalesTargetsFilters {
  periodType: TargetPeriodType;
  periodStart: string;
  employeeIds?: string[];
}

export async function listSalesTargets(filters: ListSalesTargetsFilters): Promise<SalesTargetRecord[]> {
  const where: Record<string | symbol, unknown> = { period_type: filters.periodType, period_start: filters.periodStart };
  if (filters.employeeIds) where.employee_id = { [Op.in]: filters.employeeIds };
  const rows = await db.SalesTarget.findAll({ where: where as never, include: INCLUDE_EMPLOYEE as never });
  return rows.map(toRecord);
}
