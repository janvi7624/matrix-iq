import { describe, it, expect } from 'vitest';
import {
  buildEntryPatchFromTmsTask,
  engineerActionsForStatusLabel,
  reverseAiPriority,
  reverseAiStatus,
  mapTmsPriorityToAiPriority,
  mapTmsStatusToAiStatus,
  ENGINEER_ACTIONS_BY_STATUS
} from '../../lib/aiTmsStatusMapping';
import { TMS_TASK_STATUS_LABEL } from '../../lib/tmsLabels';

// buildEntryPatchFromTmsTask is the one function all three call sites that
// turn a TmsTaskRecord into Daily Report entry fields now share: the
// picker's optimistic fill, lib/aiTmsTaskLink.ts's on-save refresh, and
// TmsLinkedTaskPanel's post-write-back patch. One set of tests here covers
// all three.
describe('buildEntryPatchFromTmsTask', () => {
  const base = {
    name: 'Bhatinda rollout',
    description: 'Set up the on-site demo rig.',
    dueDate: '2026-11-01',
    priority: 'high',
    status: 'in_progress',
    projectName: 'Bhatinda',
    progressPercent: 50
  };

  it('maps every display field from the live task', () => {
    const patch = buildEntryPatchFromTmsTask(base);
    expect(patch.task_description).toBe('Set up the on-site demo rig.');
    expect(patch.due_date).toBe('2026-11-01');
    expect(patch.priority).toBe('High');
    expect(patch.status).toBe('In Progress');
    expect(patch.tms_status_label).toBe('In Progress');
    // project IS the TMS project name for a linked row now — no separate
    // tms_project_name field (see buildEntryPatchFromTmsTask's own comment).
    expect(patch.project).toBe('Bhatinda');
    expect(patch.tms_progress_percent).toBe('50%');
  });

  it('falls back to the task name when description is blank', () => {
    const patch = buildEntryPatchFromTmsTask({ ...base, description: '' });
    expect(patch.task_description).toBe('Bhatinda rollout');
  });

  it('includes completed_on only when status is completed and a completion date exists', () => {
    const notCompleted = buildEntryPatchFromTmsTask(base);
    expect(notCompleted).not.toHaveProperty('completed_on');

    const completedNoDate = buildEntryPatchFromTmsTask({ ...base, status: 'completed' });
    expect(completedNoDate).not.toHaveProperty('completed_on');

    const completed = buildEntryPatchFromTmsTask({ ...base, status: 'completed', completionDate: '2026-10-20' });
    expect(completed.completed_on).toBe('2026-10-20');
  });
});

describe('engineerActionsForStatusLabel', () => {
  it('matches ENGINEER_ACTIONS_BY_STATUS for every real TMS status label', () => {
    for (const [status, label] of Object.entries(TMS_TASK_STATUS_LABEL)) {
      expect(engineerActionsForStatusLabel(label)).toEqual(ENGINEER_ACTIONS_BY_STATUS[status as keyof typeof ENGINEER_ACTIONS_BY_STATUS]);
    }
  });

  it('offers only "start" for a To Do task', () => {
    expect(engineerActionsForStatusLabel('To Do')).toEqual(['start']);
  });

  it('offers progress/blocked/ready-for-review for an In Progress task', () => {
    expect(engineerActionsForStatusLabel('In Progress')).toEqual(['progress', 'blocked', 'ready_for_review']);
  });

  it('offers only "reopen" for a Blocked task', () => {
    expect(engineerActionsForStatusLabel('Blocked')).toEqual(['reopen']);
  });

  it('offers nothing for a Completed, Cancelled, On Hold or Ready for Review task — those are manager-only moves', () => {
    expect(engineerActionsForStatusLabel('Completed')).toEqual([]);
    expect(engineerActionsForStatusLabel('Cancelled')).toEqual([]);
    expect(engineerActionsForStatusLabel('On Hold')).toEqual([]);
    expect(engineerActionsForStatusLabel('Ready for Review')).toEqual([]);
  });

  it('returns nothing for an unrecognised label rather than throwing', () => {
    expect(engineerActionsForStatusLabel('Not A Real Status')).toEqual([]);
  });
});

describe('reverseAiPriority', () => {
  it('round-trips through mapTmsPriorityToAiPriority for every real TMS priority', () => {
    for (const tms of ['low', 'medium', 'high']) {
      expect(reverseAiPriority(mapTmsPriorityToAiPriority(tms))).toBe(tms);
    }
  });

  it('maps the AI-only "Critical" value to TMS\'s closest real tier rather than throwing', () => {
    expect(reverseAiPriority('Critical')).toBe('high');
  });

  it('falls back to medium for an unrecognised value', () => {
    expect(reverseAiPriority('Not A Real Priority')).toBe('medium');
  });
});

describe('reverseAiStatus', () => {
  // Only used to set a brand-new TMS task's INITIAL status from the AI
  // entry that's creating it (lib/aiTmsTaskLink.ts's
  // createPendingTmsTasksFromEntries) — a task logged as already
  // "Completed" the same day it's first entered must land in TMS as
  // 'completed', not the old hardcoded 'to_do'.
  it('maps Completed to the real TMS completed state', () => {
    expect(reverseAiStatus('Completed')).toBe('completed');
  });

  it('maps In Progress and Pending to their TMS equivalents', () => {
    expect(reverseAiStatus('In Progress')).toBe('in_progress');
    expect(reverseAiStatus('Pending')).toBe('to_do');
  });

  it('falls back to to_do for an unrecognised value', () => {
    expect(reverseAiStatus('Not A Real Status')).toBe('to_do');
  });

  it('round-trips Pending/In Progress/Completed through mapTmsStatusToAiStatus', () => {
    for (const ai of ['Pending', 'In Progress', 'Completed']) {
      expect(mapTmsStatusToAiStatus(reverseAiStatus(ai))).toBe(ai);
    }
  });
});
