import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  DailyReportPayloadInput,
  HR_ACTIVITY_CATALOGUE,
  MARKETING_STATUS_OPTIONS,
  MAX_ENTRIES_PER_REPORT,
  ROBOTICS_STATUS_OPTIONS,
  SALES_CHANNELS,
  SALES_MEASURES,
  computeDerivedValues,
  computeMatrixTotals,
  defaultTemplateForDepartment,
  isEntryOverdue,
  isTemplateKey,
  resolveTemplate,
  templateIsConfigured,
  validateReportPayload
} from '../../lib/dailyReportTemplates';

// The form engine. These tests cover the three things that would otherwise
// only be caught in production: that each department's SPECIFIED format is
// actually what gets enforced, that a draft is genuinely saveable while a
// submission is not, and that the server rejects what the UI would have
// prevented (because the UI is not the control).

function payload(over: Partial<DailyReportPayloadInput> = {}): DailyReportPayloadInput {
  return { header: {}, entries: [], matrix: {}, ...over };
}

describe('department to template mapping', () => {
  it('maps each specified department to its own format', () => {
    expect(defaultTemplateForDepartment('Sales')).toBe('sales');
    expect(defaultTemplateForDepartment('GEM - Sales')).toBe('sales');
    expect(defaultTemplateForDepartment('AV')).toBe('av');
    expect(defaultTemplateForDepartment('AI')).toBe('ai');
    expect(defaultTemplateForDepartment('Robotics')).toBe('robotics');
    expect(defaultTemplateForDepartment('Marketing')).toBe('marketing');
    expect(defaultTemplateForDepartment('R&D')).toBe('rnd');
  });

  it('matches the HR department under whatever it has been renamed to', () => {
    // This instance's HR department is literally called "HR & Admin" — an
    // exact-string match would have silently left it unconfigured.
    expect(defaultTemplateForDepartment('HR')).toBe('hr');
    expect(defaultTemplateForDepartment('HR & Admin')).toBe('hr');
    expect(defaultTemplateForDepartment('  hr & admin  ')).toBe('hr');
  });

  it('leaves Accounts and anything undecided unconfigured', () => {
    // Accounts has no approved format yet, and the brief requires its staff
    // to be excluded from reminders and warnings until it does.
    expect(defaultTemplateForDepartment('Accounts')).toBe('not_configured');
    // Administration / Back Office must be ASSIGNED a format by an admin,
    // not have one forced on them.
    expect(defaultTemplateForDepartment('Administration')).toBe('not_configured');
    expect(defaultTemplateForDepartment('Back Office')).toBe('not_configured');
    expect(defaultTemplateForDepartment('Purchase')).toBe('not_configured');
    expect(defaultTemplateForDepartment('')).toBe('not_configured');
  });

  it('knows which keys are real and which mean "no report expected"', () => {
    expect(isTemplateKey('hr')).toBe(true);
    expect(isTemplateKey('nonsense')).toBe(false);
    expect(templateIsConfigured('hr')).toBe(true);
    expect(templateIsConfigured('not_configured')).toBe(false);
  });
});

describe('the specified formats', () => {
  it('gives Sales the eight measures and three verticals', () => {
    const sales = BUILT_IN_TEMPLATES.sales;
    expect(sales.layout).toBe('matrix');
    expect(sales.measures).toHaveLength(8);
    expect(sales.measures).toEqual(SALES_MEASURES);
    expect(sales.channels).toEqual(SALES_CHANNELS);
  });

  it('restricts Marketing to In Progress and Completed only', () => {
    // The brief says not to add status values here without authorization,
    // so this is pinned rather than left to a shared status list.
    expect(MARKETING_STATUS_OPTIONS).toEqual(['In Progress', 'Completed']);
    const status = BUILT_IN_TEMPLATES.marketing.rowFields.find((f) => f.key === 'status');
    expect(status?.options).toEqual(['In Progress', 'Completed']);
  });

  it('gives Robotics On Hold, and keeps progress free text', () => {
    expect(ROBOTICS_STATUS_OPTIONS).toContain('On Hold');
    const robotics = BUILT_IN_TEMPLATES.robotics;
    expect(robotics.rowFields.find((f) => f.key === 'status')?.type).toBe('select');
    expect(robotics.rowFields.find((f) => f.key === 'work_progress')?.type).toBe('textarea');
  });

  it('gives AV one narrative record per day rather than rows', () => {
    const av = BUILT_IN_TEMPLATES.av;
    expect(av.layout).toBe('narrative');
    expect(av.rowFields).toHaveLength(0);
    for (const key of ['location', 'planned_work', 'completed_work', 'work_in_progress', 'meetings', 'issues', 'support_required']) {
      expect(av.headerFields.some((f) => f.key === key)).toBe(true);
    }
  });

  it('marks the AI Task ID and Days Left as server-computed', () => {
    const ai = BUILT_IN_TEMPLATES.ai;
    expect(ai.rowFields.find((f) => f.key === 'task_code')?.computed).toBe('entry_code');
    expect(ai.rowFields.find((f) => f.key === 'days_left')?.computed).toBe('days_left');
  });

  it('expects no fields at all for an unconfigured department', () => {
    expect(BUILT_IN_TEMPLATES.not_configured.headerFields).toHaveLength(0);
    expect(BUILT_IN_TEMPLATES.not_configured.rowFields).toHaveLength(0);
  });
});

describe('draft versus submit', () => {
  const hr = BUILT_IN_TEMPLATES.hr;

  it('saves a half-filled draft', () => {
    // A draft is explicitly a private scratchpad, so required fields must
    // not bite yet.
    const result = validateReportPayload(hr, payload({ entries: [{ category: 'Recruitment' }] }), false);
    expect(result.ok).toBe(true);
    expect(result.normalized.entries[0]).toEqual({ category: 'Recruitment' });
  });

  it('refuses to submit the same half-filled report', () => {
    const result = validateReportPayload(hr, payload({ entries: [{ category: 'Recruitment' }] }), true);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toContain('entries.0.activity');
    expect(result.issues.map((i) => i.path)).toContain('entries.0.description');
  });

  it('requires at least one entry on submit but not on draft', () => {
    expect(validateReportPayload(hr, payload(), false).ok).toBe(true);
    const submit = validateReportPayload(hr, payload(), true);
    expect(submit.ok).toBe(false);
    expect(submit.issues.some((i) => i.path === 'entries')).toBe(true);
  });

  it('refuses either way when the department has no approved format', () => {
    for (const strict of [false, true]) {
      const result = validateReportPayload(BUILT_IN_TEMPLATES.not_configured, payload(), strict);
      expect(result.ok).toBe(false);
      expect(result.issues[0].path).toBe('template');
    }
  });
});

describe('validation rules', () => {
  const hr = BUILT_IN_TEMPLATES.hr;

  function completeHrEntry(over: Record<string, unknown> = {}) {
    return {
      category: 'Recruitment',
      activity: 'Resume screening',
      description: 'Screened 18 CVs for the field engineer role.',
      priority: 'High',
      status: 'Completed',
      ...over
    };
  }

  it('accepts a complete entry', () => {
    const result = validateReportPayload(hr, payload({ entries: [completeHrEntry()] }), true);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects a category/activity pair that does not exist', () => {
    // The linked dropdown prevents this in the UI; the server has to reject
    // it too, because the UI is not the control.
    const result = validateReportPayload(
      hr,
      payload({ entries: [completeHrEntry({ activity: 'Payroll input' })] }),
      true
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'entries.0.activity')).toBe(true);
    // The same activity under its own category is fine.
    expect(HR_ACTIVITY_CATALOGUE['Payroll & Compliance']).toContain('Payroll input');
    expect(
      validateReportPayload(hr, payload({ entries: [completeHrEntry({ category: 'Payroll & Compliance', activity: 'Payroll input' })] }), true).ok
    ).toBe(true);
  });

  it('rejects a value outside a plain dropdown', () => {
    const marketing = BUILT_IN_TEMPLATES.marketing;
    const base = { task_description: 'Shot the product reel.', status: 'On Hold' };
    const result = validateReportPayload(marketing, payload({ entries: [base] }), true);
    expect(result.ok).toBe(false);
    // 'On Hold' is a Robotics status, not a Marketing one.
    expect(result.issues.some((i) => i.path === 'entries.0.status')).toBe(true);
  });

  it('drops an untouched blank row instead of failing on it', () => {
    const result = validateReportPayload(hr, payload({ entries: [completeHrEntry(), {}] }), true);
    expect(result.ok).toBe(true);
    expect(result.normalized.entries).toHaveLength(1);
  });

  it('anchors an error on the row the client is rendering, not the compacted one', () => {
    // A blank row before a broken one: the stored entries compact to a
    // single row, but the issue path must still point at index 1, which is
    // where the client's card actually is.
    const result = validateReportPayload(hr, payload({ entries: [{}, completeHrEntry({ status: 'Nonsense' })] }), true);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'entries.1.status')).toBe(true);
    expect(result.issues.some((i) => i.path === 'entries.0.status')).toBe(false);
  });

  it('caps the number of entries one report can carry', () => {
    const entries = Array.from({ length: MAX_ENTRIES_PER_REPORT + 5 }, () => completeHrEntry());
    const result = validateReportPayload(hr, payload({ entries }), true);
    expect(result.issues.some((i) => i.path === 'entries')).toBe(true);
    expect(result.normalized.entries).toHaveLength(MAX_ENTRIES_PER_REPORT);
  });

  it('enforces maxLength', () => {
    const result = validateReportPayload(hr, payload({ entries: [completeHrEntry({ description: 'x'.repeat(2001) })] }), true);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'entries.0.description')).toBe(true);
  });

  it('ignores a client-supplied value for a computed field', () => {
    const ai = BUILT_IN_TEMPLATES.ai;
    const result = validateReportPayload(
      ai,
      payload({
        entries: [
          {
            task_code: 'FORGED-001',
            days_left: '9999',
            task_description: 'Trained the detector on the new dataset.',
            project: 'VisitIQ',
            priority: 'High',
            status: 'In Progress',
            due_date: '2026-10-25'
          }
        ]
      }),
      true
    );
    expect(result.ok).toBe(true);
    // Neither forged value is stored — both are derived on read.
    expect(result.normalized.entries[0].task_code).toBeUndefined();
    expect(result.normalized.entries[0].days_left).toBeUndefined();
  });

  it('rejects an invalid date', () => {
    const ai = BUILT_IN_TEMPLATES.ai;
    const result = validateReportPayload(
      ai,
      payload({
        entries: [{ task_description: 'x', project: 'p', priority: 'Low', status: 'Pending', due_date: '2026-02-30' }]
      }),
      true
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'entries.0.due_date')).toBe(true);
  });

  it('requires R&D time spent to be a non-negative whole number', () => {
    const rnd = BUILT_IN_TEMPLATES.rnd;
    const base = { task_description: 'Bench-tested the gripper.', impact: 'Unblocks the pilot.', time_spent_hours: '-3' };
    expect(validateReportPayload(rnd, payload({ entries: [base] }), true).issues.some((i) => i.path === 'entries.0.time_spent_hours')).toBe(true);
    expect(validateReportPayload(rnd, payload({ entries: [{ ...base, time_spent_hours: '2.5' }] }), true).issues.some((i) => i.path === 'entries.0.time_spent_hours')).toBe(true);
    expect(validateReportPayload(rnd, payload({ entries: [{ ...base, time_spent_hours: '6' }] }), true).ok).toBe(true);
  });
});

describe('the sales grid', () => {
  const sales = BUILT_IN_TEMPLATES.sales;

  it('treats a blank cell as zero rather than demanding 24 zeros', () => {
    const result = validateReportPayload(sales, payload({ matrix: { 'Customer Calls': { AI: '4' } } }), true);
    expect(result.ok).toBe(true);
    expect(result.normalized.matrix['Customer Calls']).toEqual({ AI: 4, AV: 0, Robotics: 0 });
    // Every specified measure is present in the stored shape, not just the
    // ones that were filled in.
    expect(Object.keys(result.normalized.matrix)).toHaveLength(8);
  });

  it('rejects negative and fractional counts', () => {
    const negative = validateReportPayload(sales, payload({ matrix: { 'Customer Calls': { AI: '-2' } } }), true);
    expect(negative.issues.some((i) => i.path === 'matrix.Customer Calls.AI')).toBe(true);
    const fractional = validateReportPayload(sales, payload({ matrix: { 'Customer Calls': { AV: '2.5' } } }), true);
    expect(fractional.issues.some((i) => i.path === 'matrix.Customer Calls.AV')).toBe(true);
  });

  it('blocks an all-zero submission unless the zero day is explained', () => {
    const bare = validateReportPayload(sales, payload(), true);
    expect(bare.ok).toBe(false);
    expect(bare.issues.some((i) => i.path === 'matrix')).toBe(true);
    // The notes field is the deliberate escape hatch for a genuinely quiet day.
    const explained = validateReportPayload(sales, payload({ header: { notes: 'On customer site all day, no new activity logged.' } }), true);
    expect(explained.ok).toBe(true);
  });

  it('allows an all-zero DRAFT with no explanation', () => {
    expect(validateReportPayload(sales, payload(), false).ok).toBe(true);
  });

  it('totals rows, verticals and the overall figure', () => {
    const matrix = {
      'New Leads Generated': { AI: 2, AV: 3, Robotics: 1 },
      'Customer Calls': { AI: 5, AV: 0, Robotics: 4 }
    };
    const totals = computeMatrixTotals(sales, matrix);
    expect(totals.byMeasure['New Leads Generated']).toBe(6);
    expect(totals.byMeasure['Customer Calls']).toBe(9);
    // Measures with no data still report zero rather than being absent.
    expect(totals.byMeasure['Quotations Sent']).toBe(0);
    expect(totals.byChannel.AI).toBe(7);
    expect(totals.byChannel.AV).toBe(3);
    expect(totals.byChannel.Robotics).toBe(5);
    expect(totals.overall).toBe(15);
  });
});

describe('computed columns', () => {
  const ai = BUILT_IN_TEMPLATES.ai;

  it('numbers the task code by position within the report', () => {
    expect(computeDerivedValues(ai, '2026-10-14', {}, 0).task_code).toBe('AI-2026-10-14-01');
    expect(computeDerivedValues(ai, '2026-10-14', {}, 11).task_code).toBe('AI-2026-10-14-12');
  });

  it('counts days left from the reporting date to the due date', () => {
    expect(computeDerivedValues(ai, '2026-10-14', { due_date: '2026-10-20' }, 0).days_left).toBe(6);
    expect(computeDerivedValues(ai, '2026-10-14', { due_date: '2026-10-14' }, 0).days_left).toBe(0);
    // Negative means overdue.
    expect(computeDerivedValues(ai, '2026-10-14', { due_date: '2026-10-10' }, 0).days_left).toBe(-4);
    expect(computeDerivedValues(ai, '2026-10-14', {}, 0).days_left).toBeUndefined();
  });

  it('flags an overdue task unless it is already completed', () => {
    expect(isEntryOverdue(ai, '2026-10-14', { due_date: '2026-10-10', status: 'In Progress' }, 0)).toBe(true);
    expect(isEntryOverdue(ai, '2026-10-14', { due_date: '2026-10-10', status: 'Completed' }, 0)).toBe(false);
    expect(isEntryOverdue(ai, '2026-10-14', { due_date: '2026-10-20', status: 'In Progress' }, 0)).toBe(false);
  });
});

describe('per-department overrides', () => {
  it('replaces a dropdown option list without touching the field set', () => {
    const resolved = resolveTemplate('marketing', { options: { status: ['In Progress', 'Completed', 'Blocked'] } });
    expect(resolved.rowFields.find((f) => f.key === 'status')?.options).toEqual(['In Progress', 'Completed', 'Blocked']);
    expect(resolved.rowFields.map((f) => f.key)).toEqual(BUILT_IN_TEMPLATES.marketing.rowFields.map((f) => f.key));
    // And the override is what then gets enforced.
    const result = validateReportPayload(resolved, { header: {}, matrix: {}, entries: [{ task_description: 'x', status: 'Blocked' }] }, true);
    expect(result.ok).toBe(true);
  });

  it('replaces the linked catalogue and re-derives the parent options from it', () => {
    const resolved = resolveTemplate('hr', { linkedOptions: { activity: { Hiring: ['Walk-in drive'] } } });
    expect(resolved.rowFields.find((f) => f.key === 'activity')?.linkedOptions).toEqual({ Hiring: ['Walk-in drive'] });
    // The category field's own options follow the new catalogue's keys, so
    // the two can't present an impossible pairing.
    expect(resolved.rowFields.find((f) => f.key === 'category')?.options).toEqual(Object.keys(HR_ACTIVITY_CATALOGUE));
  });

  it('replaces the minimum entry count', () => {
    const resolved = resolveTemplate('hr', { minEntries: 0 });
    expect(validateReportPayload(resolved, { header: {}, entries: [], matrix: {} }, true).issues.some((i) => i.path === 'entries')).toBe(false);
  });

  it('returns the built-in template untouched when there are no overrides', () => {
    expect(resolveTemplate('hr', null)).toBe(BUILT_IN_TEMPLATES.hr);
  });
});
