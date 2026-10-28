import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/db', () => ({
  db: { User: { findByPk: vi.fn() } },
  isUuid: () => true
}));
vi.mock('../../lib/tmsProjectStore', () => ({ tmsProjectStore: { findById: vi.fn() } }));
vi.mock('../../lib/tmsTaskStore', () => ({ tmsTaskStore: { create: vi.fn() } }));
vi.mock('../../lib/auditLogStore', () => ({ logAudit: vi.fn() }));

import { db } from '../../lib/db';
import { tmsProjectStore } from '../../lib/tmsProjectStore';
import { tmsTaskStore } from '../../lib/tmsTaskStore';
import {
  mapTmsStatusToAiStatus,
  mapTmsPriorityToAiPriority,
  applyLiveTasksToEntries,
  createPendingTmsTasksFromEntries,
  LiveTmsTask
} from '../../lib/aiTmsTaskLink';
import { isFieldVisible, BUILT_IN_TEMPLATES } from '../../lib/dailyReportTemplates';

// The integration brief is explicit about which silent status-mapping
// mistakes are unacceptable (section 8): On Hold and Blocked must not read
// as Pending, Ready for Review must not read as Completed, Cancelled must
// not read as Completed. Each gets its own assertion rather than a loop so
// a future edit that breaks exactly one of them fails on a readable line.
describe('mapTmsStatusToAiStatus', () => {
  it('maps to_do to Pending', () => {
    expect(mapTmsStatusToAiStatus('to_do')).toBe('Pending');
  });
  it('maps in_progress to In Progress', () => {
    expect(mapTmsStatusToAiStatus('in_progress')).toBe('In Progress');
  });
  it('maps completed to Completed', () => {
    expect(mapTmsStatusToAiStatus('completed')).toBe('Completed');
  });
  it('does not let On Hold silently become Pending', () => {
    expect(mapTmsStatusToAiStatus('on_hold')).not.toBe('Pending');
    expect(mapTmsStatusToAiStatus('on_hold')).toBe('In Progress');
  });
  it('does not let Blocked silently become Pending', () => {
    expect(mapTmsStatusToAiStatus('blocked')).not.toBe('Pending');
    expect(mapTmsStatusToAiStatus('blocked')).toBe('In Progress');
  });
  it('does not let Ready for Review silently become Completed', () => {
    expect(mapTmsStatusToAiStatus('ready_for_review')).not.toBe('Completed');
    expect(mapTmsStatusToAiStatus('ready_for_review')).toBe('In Progress');
  });
  it('does not let Cancelled silently become Completed', () => {
    expect(mapTmsStatusToAiStatus('cancelled')).not.toBe('Completed');
  });
  it('falls back to Pending for an unrecognised value rather than throwing', () => {
    expect(mapTmsStatusToAiStatus('made_up_status')).toBe('Pending');
  });
});

describe('mapTmsPriorityToAiPriority', () => {
  it('maps the three TMS priorities to their Title Case AI equivalents', () => {
    expect(mapTmsPriorityToAiPriority('low')).toBe('Low');
    expect(mapTmsPriorityToAiPriority('medium')).toBe('Medium');
    expect(mapTmsPriorityToAiPriority('high')).toBe('High');
  });
});

const TASK: LiveTmsTask = {
  id: 'task-1',
  assignee_id: 'emp-1',
  name: 'Bhatinda rollout',
  description: 'Set up the on-site demo rig.',
  priority: 'high',
  status: 'in_progress',
  due_date: '2026-11-01',
  completion_date: '',
  project_name: 'Bhatinda',
  progress_percent: 50
};

describe('applyLiveTasksToEntries', () => {
  it('leaves a standalone entry (no tms_task_id) completely untouched', () => {
    const entries = [{ task_description: 'Write the report', notes: 'done' }];
    const result = applyLiveTasksToEntries(entries, 'emp-1', new Map());
    expect(result).toEqual(entries);
  });

  it('overwrites the TMS-sourced fields on a correctly-linked entry, including project, leaving notes alone', () => {
    const entries = [
      { tms_task_id: 'task-1', task_description: 'stale text', project: 'stale project name', notes: "today I set up the rig" }
    ];
    const result = applyLiveTasksToEntries(entries, 'emp-1', new Map([['task-1', TASK]]));
    expect(result[0].task_description).toBe('Set up the on-site demo rig.');
    expect(result[0].due_date).toBe('2026-11-01');
    expect(result[0].priority).toBe('High');
    expect(result[0].status).toBe('In Progress');
    expect(result[0].tms_status_label).toBe('In Progress');
    // project IS the TMS project name for a linked row — overwritten too,
    // not left at whatever stale value (or pre-link 'Other') it last held.
    expect(result[0].project).toBe('Bhatinda');
    expect(result[0].tms_progress_percent).toBe('50%');
    // Untouched: the one genuinely employee-owned field left on a linked row.
    expect(result[0].notes).toBe('today I set up the rig');
  });

  it('falls back to the task name when its description is blank, so a required field never goes empty', () => {
    const noDescription: LiveTmsTask = { ...TASK, description: '' };
    const entries = [{ tms_task_id: 'task-1' }];
    const result = applyLiveTasksToEntries(entries, 'emp-1', new Map([['task-1', noDescription]]));
    expect(result[0].task_description).toBe('Bhatinda rollout');
  });

  it('sets completed_on from the task\'s own completion_date when the live status is completed', () => {
    const completed: LiveTmsTask = { ...TASK, status: 'completed', completion_date: '2026-10-20' };
    const entries = [{ tms_task_id: 'task-1' }];
    const result = applyLiveTasksToEntries(entries, 'emp-1', new Map([['task-1', completed]]));
    expect(result[0].status).toBe('Completed');
    expect(result[0].completed_on).toBe('2026-10-20');
  });

  it('drops any stale completed_on once the task is no longer completed', () => {
    const entries = [{ tms_task_id: 'task-1', completed_on: '2026-10-01' }];
    const result = applyLiveTasksToEntries(entries, 'emp-1', new Map([['task-1', TASK]]));
    expect(result[0]).not.toHaveProperty('completed_on');
  });

  it('unlinks a row whose task is no longer assigned to this employee, rather than exposing it', () => {
    const reassigned: LiveTmsTask = { ...TASK, assignee_id: 'someone-else' };
    const entries = [
      {
        tms_task_id: 'task-1',
        task_description: 'last known text',
        tms_status_label: 'In Progress',
        project: 'Bhatinda',
        notes: 'my notes stay'
      }
    ];
    const result = applyLiveTasksToEntries(entries, 'emp-1', new Map([['task-1', reassigned]]));
    expect(result[0]).not.toHaveProperty('tms_task_id');
    expect(result[0]).not.toHaveProperty('tms_status_label');
    // project is stripped too — it WAS the real TMS project name, no longer
    // true once unlinked, and required-ness forces a fresh, deliberate
    // re-choice (project or Other) on the next save rather than leaving a
    // stale project name sitting there unexplained.
    expect(result[0]).not.toHaveProperty('project');
    // The last-known content is frozen in place, not wiped.
    expect(result[0].task_description).toBe('last known text');
    expect(result[0].notes).toBe('my notes stay');
  });

  it('unlinks a row whose linked task id is not in the live map at all (deleted, or forged)', () => {
    const entries = [{ tms_task_id: 'does-not-exist', task_description: 'kept', notes: 'kept too' }];
    const result = applyLiveTasksToEntries(entries, 'emp-1', new Map());
    expect(result[0]).not.toHaveProperty('tms_task_id');
    expect(result[0].task_description).toBe('kept');
  });

  it('only touches the entries that are actually linked in a mixed report', () => {
    const entries = [
      { task_description: 'standalone', notes: 'n1' },
      { tms_task_id: 'task-1', task_description: 'stale', notes: 'n2' }
    ];
    const result = applyLiveTasksToEntries(entries, 'emp-1', new Map([['task-1', TASK]]));
    expect(result[0]).toEqual(entries[0]);
    expect(result[1].task_description).toBe('Set up the on-site demo rig.');
  });
});

describe('isFieldVisible', () => {
  it('equals mode behaves exactly as before notEmpty existed', () => {
    const field = { key: 'project_other', label: '', type: 'text' as const, showWhen: { field: 'project', equals: ['Other'] } };
    expect(isFieldVisible(field, { project: 'Other' })).toBe(true);
    expect(isFieldVisible(field, { project: 'Client' })).toBe(false);
    expect(isFieldVisible(field, {})).toBe(false);
  });

  it('notEmpty mode treats whitespace-only as empty', () => {
    const field = { key: 'x', label: '', type: 'text' as const, showWhen: { field: 'tms_task_id', notEmpty: true } };
    expect(isFieldVisible(field, { tms_task_id: '   ' })).toBe(false);
    expect(isFieldVisible(field, { tms_task_id: 'id-1' })).toBe(true);
  });

  it('a field with no showWhen is always visible', () => {
    const field = { key: 'x', label: '', type: 'text' as const };
    expect(isFieldVisible(field, {})).toBe(true);
  });
});

// The AI template's new tms_* fields are gated with showWhen's new
// `notEmpty` mode rather than `equals` — this is the one place that mode
// actually gets exercised by a real template, so it's worth confirming
// directly rather than only through isFieldVisible's own unit tests.
describe('AI_TEMPLATE tms_* fields use showWhen.notEmpty correctly', () => {
  const AI = BUILT_IN_TEMPLATES.ai;
  const statusLabelField = AI.rowFields.find((f) => f.key === 'tms_status_label')!;

  it('is hidden on a standalone row', () => {
    expect(isFieldVisible(statusLabelField, { tms_task_id: '' })).toBe(false);
    expect(isFieldVisible(statusLabelField, {})).toBe(false);
  });

  it('is shown once tms_task_id is set, regardless of its value', () => {
    expect(isFieldVisible(statusLabelField, { tms_task_id: 'any-uuid-at-all' })).toBe(true);
  });

  it('notes stays editableWhenAuto, unlike every TMS-sourced field', () => {
    // project is no longer in this set — it's bespoke-rendered (hidden)
    // now, not a generically-rendered field editableWhenAuto has any say
    // over; see the "does not trip isAutoRow" describe block below for its
    // own, different lock-exemption mechanism (locksRowWhenSet).
    const byKey = Object.fromEntries(AI.rowFields.map((f) => [f.key, f]));
    expect(byKey.notes.editableWhenAuto).toBe(true);
    expect(byKey.task_description.editableWhenAuto).toBeUndefined();
    expect(byKey.due_date.editableWhenAuto).toBeUndefined();
  });
});

describe('AI_TEMPLATE tms_project_id and project do not trip isAutoRow', () => {
  const AI = BUILT_IN_TEMPLATES.ai;
  const byKey = Object.fromEntries(AI.rowFields.map((f) => [f.key, f]));

  it('both are hidden like every other TMS bookkeeping field', () => {
    expect(byKey.tms_project_id.hidden).toBe(true);
    expect(byKey.project.hidden).toBe(true);
  });

  it('both opt out of locksRowWhenSet, unlike tms_task_id', () => {
    // DailyReportForm.tsx's isAutoRow is `rowFields.some(f => f.hidden &&
    // f.locksRowWhenSet !== false && entry[f.key] !== '')` — a row with
    // ONLY tms_project_id/project set (a pending choice, or a standalone
    // "Other" row — no task created yet either way) must stay editable,
    // while one with tms_task_id set (an actual link) must lock. This is
    // the one assertion that keeps these hidden fields from being treated
    // the same way as tms_task_id by accident.
    expect(byKey.tms_project_id.locksRowWhenSet).toBe(false);
    expect(byKey.project.locksRowWhenSet).toBe(false);
    expect(byKey.tms_task_id.locksRowWhenSet).toBeUndefined(); // undefined = locks, the default

    const wouldLock = (entry: Record<string, unknown>) =>
      AI.rowFields.some((f) => f.hidden && f.locksRowWhenSet !== false && String(entry[f.key] ?? '') !== '');

    expect(wouldLock({ tms_project_id: 'proj-1' })).toBe(false);
    expect(wouldLock({ project: 'Other' })).toBe(false);
    expect(wouldLock({ project: 'Bhatinda', tms_project_id: 'proj-1' })).toBe(false);
    expect(wouldLock({ tms_task_id: 'task-1' })).toBe(true);
    expect(wouldLock({ tms_project_id: 'proj-1', tms_task_id: 'task-1' })).toBe(true);
  });
});

// The actual bug report: a task created in the same report entry it's
// marked "Completed" in must land in TMS as 'completed' on day one, not the
// old hardcoded 'to_do' — the employee had no way to tell from the Daily
// Report that the task they'd just finished showed as not-yet-started in TMS.
describe('createPendingTmsTasksFromEntries', () => {
  const findByPkMock = vi.mocked(db.User.findByPk);
  const findProjectMock = vi.mocked(tmsProjectStore.findById);
  const createTaskMock = vi.mocked(tmsTaskStore.create);

  beforeEach(() => {
    vi.clearAllMocks();
    findByPkMock.mockResolvedValue({ get: (key: string) => (key === 'username' ? 'priya' : { key: 'engineer' }) } as never);
    findProjectMock.mockResolvedValue({
      id: 'proj-1',
      name: 'Bhatinda',
      department_id: 'dept-1',
      project_manager_id: '',
      team_member_ids: ['emp-1'],
      created_by: ''
    } as never);
    createTaskMock.mockImplementation(async (record) => ({ ...record, id: 'new-task-1' } as never));
  });

  function pendingEntry(over: Record<string, unknown> = {}) {
    return { task_description: 'Fix the gripper calibration', tms_project_id: 'proj-1', priority: 'High', status: 'Pending', due_date: '2026-11-05', ...over };
  }

  it('creates the task as to_do when the entry status is Pending (unchanged default behavior)', async () => {
    const result = await createPendingTmsTasksFromEntries([pendingEntry()], 'emp-1', 'emp-1');
    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'to_do', progress_percent: 0, completion_date: '' }));
    expect(result[0].status).toBe('Pending');
  });

  it('creates the task already completed when the entry was logged as Completed the same day', async () => {
    const result = await createPendingTmsTasksFromEntries([pendingEntry({ status: 'Completed' })], 'emp-1', 'emp-1');

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', progress_percent: 100 }));
    const [[createdArgs]] = createTaskMock.mock.calls;
    expect((createdArgs as { completion_date: string }).completion_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The resulting entry patch reflects it too — a linked row's status
    // comes from buildEntryPatchFromTmsTask, not the entry's own pre-link value.
    expect(result[0].status).toBe('Completed');
    expect(result[0].tms_task_id).toBe('new-task-1');
    expect(result[0].completed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('creates the task as in_progress for an entry logged as In Progress', async () => {
    await createPendingTmsTasksFromEntries([pendingEntry({ status: 'In Progress' })], 'emp-1', 'emp-1');
    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_progress', progress_percent: 0, completion_date: '' }));
  });

  it('drops the pending project choice without creating a task when the employee is not actually on that project', async () => {
    findProjectMock.mockResolvedValue({ id: 'proj-1', name: 'Bhatinda', department_id: 'dept-1', project_manager_id: '', team_member_ids: ['someone-else'], created_by: '' } as never);

    const result = await createPendingTmsTasksFromEntries([pendingEntry({ status: 'Completed' })], 'emp-1', 'emp-1');

    expect(createTaskMock).not.toHaveBeenCalled();
    expect(result[0]).not.toHaveProperty('tms_project_id');
  });

  it('leaves an already-linked entry untouched', async () => {
    const entry = { tms_task_id: 'task-1', task_description: 'already linked' };
    const result = await createPendingTmsTasksFromEntries([entry], 'emp-1', 'emp-1');
    expect(result).toEqual([entry]);
    expect(createTaskMock).not.toHaveBeenCalled();
  });
});
