import { describe, it, expect } from 'vitest';
import { buildEntryPatchFromTmsTask, engineerActionsForStatusLabel, unlinkTmsPatch } from '../../lib/aiTmsStatusMapping';

// The way back out of a TMS link on an AI daily-report row.
//
// Linking a task LOCKS the row, so before this existed a mis-link left that
// row stranded in the day's report with no unlink, no delete and no re-link.
// These tests pin what unlinking clears and — more importantly — what it
// must NOT clear, since blanking the row would make correcting a mistake
// cost a retype.

describe('unlinkTmsPatch', () => {
  it('clears the link itself', () => {
    expect(unlinkTmsPatch().tms_task_id).toBe('');
  });

  it('clears the fields that exist only to mirror TMS', () => {
    const patch = unlinkTmsPatch();
    expect(patch.tms_status_label).toBe('');
    expect(patch.tms_progress_percent).toBe('');
  });

  // Otherwise an unlink becomes a request to CREATE a new task on the next
  // submit — swapping one unwanted link for another.
  it('clears the pending-create marker too', () => {
    expect(unlinkTmsPatch().tms_project_id).toBe('');
  });

  // The row has to survive as an ordinary entry. These hold the real task's
  // values and are what the employee would otherwise have to retype.
  it('leaves the row content alone', () => {
    const patch = unlinkTmsPatch();
    for (const kept of ['task_description', 'priority', 'status', 'due_date', 'project', 'notes']) {
      expect(patch).not.toHaveProperty(kept);
    }
  });

  it('touches nothing beyond the four link fields', () => {
    expect(Object.keys(unlinkTmsPatch()).sort()).toEqual(
      ['tms_progress_percent', 'tms_project_id', 'tms_status_label', 'tms_task_id'].sort()
    );
  });

  // Applied over an entry, the result is a row that is no longer "linked"
  // (which is how DailyReportForm decides whether to lock it) but still has
  // its content.
  it('produces an unlocked row that keeps its text', () => {
    const linked = {
      tms_task_id: 'task-1',
      tms_status_label: 'In Progress',
      tms_progress_percent: '40%',
      task_description: 'Build the OCR pipeline',
      priority: 'High',
      notes: 'Tuned the threshold today'
    };
    const after = { ...linked, ...unlinkTmsPatch() };
    expect(after.tms_task_id).toBe('');
    expect(after.task_description).toBe('Build the OCR pipeline');
    expect(after.notes).toBe('Tuned the threshold today');
  });
});

describe('engineerActionsForStatusLabel', () => {
  // The panel now renders only the available actions, so an empty list is
  // the difference between "no buttons" and five greyed-out ones.
  it('offers Start from To Do only', () => {
    expect(engineerActionsForStatusLabel('To Do')).toEqual(['start']);
  });

  it('offers progress, blocked and review from In Progress', () => {
    expect(engineerActionsForStatusLabel('In Progress')).toEqual(['progress', 'blocked', 'ready_for_review']);
  });

  it('offers only reopen from Blocked', () => {
    expect(engineerActionsForStatusLabel('Blocked')).toEqual(['reopen']);
  });

  it('offers nothing from a terminal status', () => {
    expect(engineerActionsForStatusLabel('Completed')).toEqual([]);
    expect(engineerActionsForStatusLabel('Ready for Review')).toEqual([]);
  });

  it('offers nothing for a label it does not recognise', () => {
    expect(engineerActionsForStatusLabel('')).toEqual([]);
    expect(engineerActionsForStatusLabel('Nonsense')).toEqual([]);
  });
});

describe('buildEntryPatchFromTmsTask', () => {
  // Why the panel had to gain a Name field: with no description, the row
  // displays the task NAME under a "Task Description" label, so the name was
  // the one thing on screen that could not be corrected from the report.
  it('falls back to the task name when there is no description', () => {
    const patch = buildEntryPatchFromTmsTask({
      name: 'Build the OCR pipeline',
      description: '',
      dueDate: '2026-11-12',
      priority: 'high',
      status: 'in_progress',
      projectName: 'Vision',
      progressPercent: 40,
      completionDate: ''
    });
    expect(patch.task_description).toBe('Build the OCR pipeline');
  });

  it('prefers the description when there is one', () => {
    const patch = buildEntryPatchFromTmsTask({
      name: 'Build the OCR pipeline',
      description: 'Train and tune the detector',
      dueDate: '2026-11-12',
      priority: 'high',
      status: 'in_progress',
      projectName: 'Vision',
      progressPercent: 40,
      completionDate: ''
    });
    expect(patch.task_description).toBe('Train and tune the detector');
  });
});
