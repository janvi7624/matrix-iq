import { describe, it, expect } from 'vitest';
import {
  ACCOUNTS_ACTIVITY_OPTIONS,
  BUILT_IN_TEMPLATES,
  DailyReportPayloadInput,
  HR_ACTIVITY_CATALOGUE,
  MARKETING_STATUS_OPTIONS,
  MAX_ENTRIES_PER_REPORT,
  PRIORITY_OPTIONS,
  ROBOTICS_STATUS_OPTIONS,
  SALES_CHANNELS,
  SALES_MEASURES,
  TEMPLATE_KEYS,
  computeDerivedValues,
  computeMatrixTotals,
  defaultTemplateForDepartment,
  isEntryOverdue,
  isTemplateKey,
  resolveTemplate,
  carryCompletions,
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

function gemPayload(entries: Record<string, unknown>[]): DailyReportPayloadInput {
  return payload({ entries });
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

  it('maps Accounts and Back Office, whose formats have since been approved', () => {
    // Both seeded as not_configured while no format existed for them. Both
    // now have one, so they map like every other department.
    expect(defaultTemplateForDepartment('Accounts')).toBe('accounts');
    expect(defaultTemplateForDepartment('Back Office')).toBe('backoffice');
    expect(defaultTemplateForDepartment('back office')).toBe('backoffice');
    expect(defaultTemplateForDepartment('BackOffice')).toBe('backoffice');
  });

  it('still leaves anything undecided unconfigured', () => {
    // Administration was NOT part of the approved set — it must still be
    // assigned a format by an admin rather than have one forced on it.
    expect(defaultTemplateForDepartment('Administration')).toBe('not_configured');
    expect(defaultTemplateForDepartment('Purchase')).toBe('not_configured');
    expect(defaultTemplateForDepartment('Inventory')).toBe('not_configured');
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
  it('gives Sales the seven measures and three verticals', () => {
    const sales = BUILT_IN_TEMPLATES.sales;
    expect(sales.layout).toBe('matrix');
    // Seven, not eight: Quotations Sent was merged into Quotations Prepared
    // because the two were read as the same thing. See SALES_MEASURES.
    expect(sales.measures).toHaveLength(7);
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

  it('gives Accounts the supplied activity list plus an Other escape hatch', () => {
    const accounts = BUILT_IN_TEMPLATES.accounts;
    const activity = accounts.rowFields.find((f) => f.key === 'activity');
    // The twenty-one supplied activities, in the order they were given.
    expect(ACCOUNTS_ACTIVITY_OPTIONS).toHaveLength(22);
    expect(ACCOUNTS_ACTIVITY_OPTIONS[0]).toBe('Sales entry');
    expect(ACCOUNTS_ACTIVITY_OPTIONS[8]).toBe('GST return (GSTR-1, GSTR-3B)');
    expect(ACCOUNTS_ACTIVITY_OPTIONS[20]).toBe('Balance confirmation');
    // Other is last, so it never displaces a real activity at the top.
    expect(ACCOUNTS_ACTIVITY_OPTIONS[21]).toBe('Other');
    expect(activity?.options).toEqual(ACCOUNTS_ACTIVITY_OPTIONS);
    // Description is required, so an 'Other' row always carries an
    // explanation rather than being an unlabelled blank.
    expect(accounts.rowFields.find((f) => f.key === 'description')?.required).toBe(true);
    expect(accounts.rowFields.find((f) => f.key === 'remarks')?.required).toBeFalsy();
  });

  it('gives Back Office a Task ID, task name, description and remarks', () => {
    const backoffice = BUILT_IN_TEMPLATES.backoffice;
    expect(backoffice.rowFields.map((f) => f.key)).toEqual(['task_code', 'task_name', 'description', 'remarks']);
    // One identifier, not two. The Task ID already ends in the row's
    // position, so a separate Sr. No. was the same number twice.
    expect(backoffice.rowFields[0].computed).toBe('entry_code');
    expect(backoffice.rowFields.find((f) => f.key === 'task_name')?.required).toBe(true);
    expect(backoffice.rowFields.find((f) => f.key === 'description')?.required).toBe(true);
    expect(backoffice.rowFields.find((f) => f.key === 'remarks')?.required).toBeFalsy();
  });

  it('gives no template a second numbering column beside its Task ID', () => {
    // The redundancy this removal was about: exactly one read-only
    // identifier per row. AI legitimately has a second computed column, but
    // it is Days Left, which is not an identifier.
    for (const key of TEMPLATE_KEYS) {
      const template = BUILT_IN_TEMPLATES[key];
      const identifiers = template.rowFields.filter((f) => f.computed === 'entry_code');
      expect(identifiers.length, `${key} has ${identifiers.length} identifier columns`).toBeLessThanOrEqual(1);
    }
  });

  it('gives every row-based template a Task ID', () => {
    // The request was that it be consistent: some departments had one and
    // some did not. A new row template added later without one fails here.
    for (const key of TEMPLATE_KEYS) {
      const template = BUILT_IN_TEMPLATES[key];
      if (template.layout !== 'rows') continue;
      const field = template.rowFields.find((f) => f.computed === 'entry_code');
      expect(field, `${key} has no Task ID`).toBeDefined();
      expect(field?.label).toBe('Task ID');
      // Computed, so it can never be typed or forged.
      expect(field?.type).toBe('computed');
    }
  });

  it('gives each template a short, distinct Task ID prefix', () => {
    const seen = new Map<string, string>();
    for (const key of TEMPLATE_KEYS) {
      const template = BUILT_IN_TEMPLATES[key];
      if (template.layout !== 'rows') continue;
      const prefix = template.codePrefix ?? key.toUpperCase();
      // Short enough to read in a narrow column — 'BACKOFFICE-2026-10-14-01'
      // is what this guards against.
      expect(prefix.length, `${key} prefix "${prefix}" is too long`).toBeLessThanOrEqual(4);
      // Two departments sharing a prefix would make two different tasks
      // quotable by the same id on the same day.
      expect(seen.has(prefix), `${prefix} is used by both ${seen.get(prefix)} and ${key}`).toBe(false);
      seen.set(prefix, key);
    }
  });

  it('generates the documented Task ID shape for each department', () => {
    const expected: Record<string, string> = {
      hr: 'HR-2026-10-14-01',
      rnd: 'RND-2026-10-14-01',
      ai: 'AI-2026-10-14-01',
      marketing: 'MKT-2026-10-14-01',
      robotics: 'ROB-2026-10-14-01',
      accounts: 'ACC-2026-10-14-01',
      backoffice: 'BO-2026-10-14-01'
    };
    for (const [key, id] of Object.entries(expected)) {
      expect(computeDerivedValues(BUILT_IN_TEMPLATES[key as keyof typeof BUILT_IN_TEMPLATES], '2026-10-14', {}, 0).task_code).toBe(id);
    }
  });

  it('numbers Task IDs by position and keeps the reporting date', () => {
    const hr = BUILT_IN_TEMPLATES.hr;
    expect(computeDerivedValues(hr, '2026-10-14', {}, 1).task_code).toBe('HR-2026-10-14-02');
    expect(computeDerivedValues(hr, '2026-10-14', {}, 11).task_code).toBe('HR-2026-10-14-12');
    expect(computeDerivedValues(hr, '2026-11-02', {}, 0).task_code).toBe('HR-2026-11-02-01');
  });

  it('leaves the one-record-a-day templates without one', () => {
    // Sales is a numeric grid and AV is a single narrative — there are no
    // rows for an id to identify.
    for (const key of ['sales', 'av'] as const) {
      expect(BUILT_IN_TEMPLATES[key].rowFields).toHaveLength(0);
    }
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
            project: 'Client',
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
    const base = { task_description: 'Bench-tested the gripper.', impact: 'Unblocks the pilot.', priority: 'High', status: 'In Progress', time_spent_hours: '-3' };
    expect(validateReportPayload(rnd, payload({ entries: [base] }), true).issues.some((i) => i.path === 'entries.0.time_spent_hours')).toBe(true);
    expect(validateReportPayload(rnd, payload({ entries: [{ ...base, time_spent_hours: '2.5' }] }), true).issues.some((i) => i.path === 'entries.0.time_spent_hours')).toBe(true);
    expect(validateReportPayload(rnd, payload({ entries: [{ ...base, time_spent_hours: '6' }] }), true).ok).toBe(true);
  });
});

describe('R&D priority and status', () => {
  const rnd = BUILT_IN_TEMPLATES.rnd;
  const base = {
    task_description: 'Bench-tested the gripper.',
    impact: 'Unblocks the pilot.',
    time_spent_hours: '6'
  };

  it('offers the same priority list as every other sheet', () => {
    const field = rnd.rowFields.find((f) => f.key === 'priority');
    expect(field?.type).toBe('select');
    expect(field?.options).toEqual(PRIORITY_OPTIONS);
  });

  it('offers the same three statuses as the AI sheet', () => {
    const field = rnd.rowFields.find((f) => f.key === 'status');
    expect(field?.type).toBe('select');
    expect(field?.options).toEqual(['In Progress', 'Completed', 'Pending']);
  });

  it('requires both on submit', () => {
    const issues = validateReportPayload(rnd, payload({ entries: [base] }), true).issues.map((i) => i.path);
    expect(issues).toContain('entries.0.priority');
    expect(issues).toContain('entries.0.status');
  });

  it('rejects a status that is not on the list', () => {
    const row = { ...base, priority: 'High', status: 'Nearly done' };
    const issues = validateReportPayload(rnd, payload({ entries: [row] }), true).issues.map((i) => i.path);
    expect(issues).toContain('entries.0.status');
  });

  it('accepts a complete row', () => {
    const row = { ...base, priority: 'Medium', status: 'Completed' };
    expect(validateReportPayload(rnd, payload({ entries: [row] }), true).ok).toBe(true);
  });
});

// The conditional free-text box behind Project / Category = Other. The rule
// that matters is that it is required ONLY then — a field required while
// hidden would make the whole report unsubmittable, complaining about a box
// that is not on screen.
describe('the AI project category', () => {
  const ai = BUILT_IN_TEMPLATES.ai;
  const base = {
    task_description: 'Trained the detector.',
    priority: 'High',
    status: 'In Progress',
    due_date: '2026-10-25'
  };

  it('is a dropdown of Client, Internal and Other', () => {
    const field = ai.rowFields.find((f) => f.key === 'project');
    expect(field?.type).toBe('select');
    expect(field?.options).toEqual(['Client', 'Internal', 'Other']);
  });

  it('rejects a category that is not on the list', () => {
    const issues = validateReportPayload(ai, payload({ entries: [{ ...base, project: 'VisitIQ' }] }), true).issues.map((i) => i.path);
    expect(issues).toContain('entries.0.project');
  });

  it.each(['Client', 'Internal'])('needs no explanation for %s', (project) => {
    expect(validateReportPayload(ai, payload({ entries: [{ ...base, project }] }), true).ok).toBe(true);
  });

  it('demands an explanation for Other', () => {
    const issues = validateReportPayload(ai, payload({ entries: [{ ...base, project: 'Other' }] }), true).issues.map((i) => i.path);
    expect(issues).toContain('entries.0.project_other');
  });

  it('accepts Other once explained', () => {
    const row = { ...base, project: 'Other', project_other: 'Internal tooling spike' };
    expect(validateReportPayload(ai, payload({ entries: [row] }), true).ok).toBe(true);
  });

  // A stale value left over from switching Other -> Client must not be
  // validated either, or a since-hidden box could block submission.
  it('ignores a leftover explanation when the category is not Other', () => {
    const row = { ...base, project: 'Client', project_other: 'x'.repeat(500) };
    expect(validateReportPayload(ai, payload({ entries: [row] }), true).ok).toBe(true);
  });
});

describe('the Accounts format', () => {
  const accounts = BUILT_IN_TEMPLATES.accounts;

  it('accepts an activity from the list with a description', () => {
    const result = validateReportPayload(
      accounts,
      { header: {}, matrix: {}, entries: [{ activity: 'Bank reconciliation', description: 'Reconciled the HDFC current account for the week.' }] },
      true
    );
    expect(result.issues).toEqual([]);
  });

  it('accepts Other, which is the whole point of having it', () => {
    const result = validateReportPayload(
      accounts,
      { header: {}, matrix: {}, entries: [{ activity: 'Other', description: 'Auditor queries on last year’s fixed asset register.' }] },
      true
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an activity that is not on the list', () => {
    const result = validateReportPayload(
      accounts,
      { header: {}, matrix: {}, entries: [{ activity: 'Making tea', description: 'x' }] },
      true
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'entries.0.activity')).toBe(true);
  });

  it('will not let an Other row be submitted without an explanation', () => {
    const result = validateReportPayload(accounts, { header: {}, matrix: {}, entries: [{ activity: 'Other' }] }, true);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'entries.0.description')).toBe(true);
  });
});

describe('the Back Office format', () => {
  const backoffice = BUILT_IN_TEMPLATES.backoffice;

  function task(over: Record<string, unknown> = {}) {
    return { task_name: 'Courier dispatch', description: 'Dispatched 4 consignments to the Pune site.', ...over };
  }

  it('accepts a task name with a description', () => {
    expect(validateReportPayload(backoffice, { header: {}, matrix: {}, entries: [task()] }, true).issues).toEqual([]);
  });

  it('requires the task name and the description, but not remarks', () => {
    const noName = validateReportPayload(backoffice, { header: {}, matrix: {}, entries: [task({ task_name: '' })] }, true);
    expect(noName.issues.some((i) => i.path === 'entries.0.task_name')).toBe(true);
    const noDesc = validateReportPayload(backoffice, { header: {}, matrix: {}, entries: [task({ description: '' })] }, true);
    expect(noDesc.issues.some((i) => i.path === 'entries.0.description')).toBe(true);
    expect(validateReportPayload(backoffice, { header: {}, matrix: {}, entries: [task({ remarks: '' })] }, true).ok).toBe(true);
  });

  it('numbers rows through the Task ID and renumbers them after a reorder', () => {
    // The position lives in the id's suffix, which is why a separate Sr. No.
    // column was redundant.
    expect(computeDerivedValues(backoffice, '2026-10-14', {}, 0).task_code).toBe('BO-2026-10-14-01');
    expect(computeDerivedValues(backoffice, '2026-10-14', {}, 1).task_code).toBe('BO-2026-10-14-02');
    expect(computeDerivedValues(backoffice, '2026-10-14', {}, 9).task_code).toBe('BO-2026-10-14-10');
  });

  it('discards a client-supplied Task ID or a stale sr_no', () => {
    // Computed, so it cannot be typed or forged. sr_no is no longer a field
    // at all, so a cached client still posting one must not store it.
    const result = validateReportPayload(
      backoffice,
      { header: {}, matrix: {}, entries: [task({ task_code: 'FORGED-01', sr_no: '99' })] },
      true
    );
    expect(result.ok).toBe(true);
    expect(result.normalized.entries[0].task_code).toBeUndefined();
    expect(result.normalized.entries[0].sr_no).toBeUndefined();
  });
});

describe('the sales grid', () => {
  const sales = BUILT_IN_TEMPLATES.sales;

  it('treats a blank cell as zero rather than demanding 21 zeros', () => {
    const result = validateReportPayload(sales, payload({ matrix: { 'Customer Calls': { AI: '4' } } }), true);
    expect(result.ok).toBe(true);
    expect(result.normalized.matrix['Customer Calls']).toEqual({ AI: 4, AV: 0, Robotics: 0 });
    // Every specified measure is present in the stored shape, not just the
    // ones that were filled in.
    expect(Object.keys(result.normalized.matrix)).toHaveLength(7);
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
    expect(totals.byMeasure['Quotations Prepared']).toBe(0);
    expect(totals.byChannel.AI).toBe(7);
    expect(totals.byChannel.AV).toBe(3);
    expect(totals.byChannel.Robotics).toBe(5);
    expect(totals.overall).toBe(15);
  });
});

describe('computed columns', () => {
  const ai = BUILT_IN_TEMPLATES.ai;

  it('numbers the task code by position within the report', () => {
    expect(computeDerivedValues(ai, '2026-10-14', {}, 0, '2026-10-14').task_code).toBe('AI-2026-10-14-01');
    expect(computeDerivedValues(ai, '2026-10-14', {}, 11, '2026-10-14').task_code).toBe('AI-2026-10-14-12');
  });

  // The code is keyed to the day being REPORTED on, never to today: it has to
  // read back as the same string every time that report is opened.
  it('keeps the task code anchored to the reporting date, not to today', () => {
    expect(computeDerivedValues(ai, '2026-10-14', {}, 0, '2026-11-30').task_code).toBe('AI-2026-10-14-01');
  });

  it('counts days left from today to the due date', () => {
    const open = { due_date: '2026-10-20', status: 'In Progress' };
    expect(computeDerivedValues(ai, '2026-10-14', open, 0, '2026-10-14').days_left).toBe(6);
    // The SAME stored row, read four days later: the countdown has moved on.
    expect(computeDerivedValues(ai, '2026-10-14', open, 0, '2026-10-18').days_left).toBe(2);
    expect(computeDerivedValues(ai, '2026-10-14', open, 0, '2026-10-20').days_left).toBe(0);
    expect(computeDerivedValues(ai, '2026-10-14', {}, 0, '2026-10-14').days_left).toBeUndefined();
  });

  // The regression this change exists for. A task filed on the 16th and due
  // on the 18th used to read "2 days" for the rest of time, because days-left
  // was measured from the reporting date — so the one row that most needed to
  // raise its hand was the one that never could.
  it('goes overdue once the due date passes, on a row nobody touched again', () => {
    const row = { due_date: '2026-10-18', status: 'In Progress' };
    const onTheDay = computeDerivedValues(ai, '2026-10-16', row, 0, '2026-10-16');
    expect(onTheDay.days_left).toBe(2);
    expect(onTheDay.overdue).toBe(false);

    const twoDaysLater = computeDerivedValues(ai, '2026-10-16', row, 0, '2026-10-20');
    expect(twoDaysLater.days_left).toBe(-2);
    expect(twoDaysLater.overdue).toBe(true);
  });

  it('degrades to the reporting date when no today is supplied', () => {
    // A caller that forgets the argument gets the old behaviour, not NaN.
    expect(computeDerivedValues(ai, '2026-10-14', { due_date: '2026-10-20' }, 0, '').days_left).toBe(6);
  });

  it('flags an overdue task unless it is already completed', () => {
    expect(isEntryOverdue(ai, '2026-10-16', { due_date: '2026-10-18', status: 'In Progress' }, 0, '2026-10-20')).toBe(true);
    expect(isEntryOverdue(ai, '2026-10-16', { due_date: '2026-10-18', status: 'Completed' }, 0, '2026-10-20')).toBe(false);
    expect(isEntryOverdue(ai, '2026-10-16', { due_date: '2026-10-18', status: 'In Progress' }, 0, '2026-10-17')).toBe(false);
  });

  describe('a completed task', () => {
    it('reports when it was finished instead of a countdown', () => {
      const done = { due_date: '2026-10-18', status: 'Completed', completed_on: '2026-10-17' };
      const d = computeDerivedValues(ai, '2026-10-16', done, 0, '2026-10-30');
      expect(d.completed_on).toBe('2026-10-17');
      expect(d.days_left).toBeUndefined();
      expect(d.overdue).toBe(false);
    });

    it('is never overdue, even when it was finished late', () => {
      const late = { due_date: '2026-10-18', status: 'Completed', completed_on: '2026-10-25' };
      expect(computeDerivedValues(ai, '2026-10-16', late, 0, '2026-10-30').overdue).toBe(false);
    });

    // Rows completed before the stamp existed have nothing to show, and must
    // not invent a date — an absent stamp is honest, a guessed one is not.
    it('shows no completion date for a row stamped before this existed', () => {
      const d = computeDerivedValues(ai, '2026-10-16', { due_date: '2026-10-18', status: 'Completed' }, 0, '2026-10-30');
      expect(d.completed_on).toBeUndefined();
      expect(d.overdue).toBe(false);
    });
  });

  describe('carryCompletions', () => {
    const REPORT = '2026-10-16';
    const row = (name: string, extra: Record<string, unknown> = {}) =>
      ({ task_description: name, due_date: '2026-10-18', ...extra });
    const carry = (
      incoming: Record<string, unknown>[],
      prior: Record<string, unknown>[],
      today = '2026-10-25'
    ) => carryCompletions(incoming, prior, REPORT, today);

    // The report date, not today: the deadline is 11:00 on D+1, so filing
    // yesterday's report this morning is the designed flow, and a manager can
    // back-fill a missing day weeks later.
    it('stamps the report date on a row filed as already Completed', () => {
      const [out] = carry([row('Ship ingest', { status: 'Completed' })], [], '2026-10-17');
      expect(out.completed_on).toBe(REPORT);
    });

    it('stamps today when an open row transitions to Completed', () => {
      const prior = [row('Ship ingest', { status: 'In Progress' })];
      const [out] = carry([row('Ship ingest', { status: 'Completed' })], prior, '2026-10-20');
      expect(out.completed_on).toBe('2026-10-20');
    });

    // It records when the task was FIRST finished, so a later save must not
    // quietly turn it into "last edited".
    it('keeps the first stamp on every later save', () => {
      const prior = [row('Ship ingest', { status: 'Completed', completed_on: '2026-10-18' })];
      const [out] = carry([row('Ship ingest', { status: 'Completed' })], prior, '2026-10-25');
      expect(out.completed_on).toBe('2026-10-18');
    });

    // Every row submitted before this field existed is Completed with no
    // stamp. Re-dating those to today would assert a completion that did not
    // happen today — the read side shows nothing for them, and nothing is the
    // honest answer.
    it('leaves an already-completed row unstamped rather than inventing a date', () => {
      const prior = [row('Ship ingest', { status: 'Completed' })];
      const [out] = carry([row('Ship ingest', { status: 'Completed' })], prior);
      expect('completed_on' in out).toBe(false);
    });

    it('clears the stamp when a completed task is re-opened', () => {
      const prior = [row('Ship ingest', { status: 'Completed', completed_on: '2026-10-18' })];
      const [out] = carry([row('Ship ingest', { status: 'In Progress' })], prior);
      expect('completed_on' in out).toBe(false);
    });

    // Matching the outgoing generation by array position meant any row added
    // or removed ABOVE a completed one re-paired it with a different task —
    // rewriting its stamp to today, or handing it a neighbour's older date.
    // The entries table has no stable row id, so identity is content.
    describe('survives the row set changing shape', () => {
      const prior = [
        row('A', { status: 'Completed', completed_on: '2026-10-18' }),
        row('B', { status: 'In Progress' })
      ];

      it('when a row is inserted above it', () => {
        const out = carry([
          row('C', { status: 'In Progress' }),
          row('A', { status: 'Completed' }),
          row('B', { status: 'In Progress' })
        ], prior);
        expect(out[1].completed_on).toBe('2026-10-18');
      });

      it('when a row is deleted above it', () => {
        const withExtra = [
          row('Z', { status: 'In Progress' }),
          row('A', { status: 'Completed', completed_on: '2026-10-18' })
        ];
        const [out] = carry([row('A', { status: 'Completed' })], withExtra);
        expect(out.completed_on).toBe('2026-10-18');
      });

      it('when two rows are swapped', () => {
        const out = carry([
          row('B', { status: 'In Progress' }),
          row('A', { status: 'Completed' })
        ], prior);
        expect(out[1].completed_on).toBe('2026-10-18');
      });
    });

    // Two rows identical in every field are indistinguishable by content, so
    // position is the only key left — and is correct, because either pairing
    // produces the same answer.
    it('falls back to position for genuinely identical rows', () => {
      const done = row('Same', { status: 'Completed', completed_on: '2026-10-18' });
      const out = carry([
        row('Same', { status: 'Completed' }),
        row('Same', { status: 'Completed' })
      ], [done, done]);
      expect(out[0].completed_on).toBe('2026-10-18');
      expect(out[1].completed_on).toBe('2026-10-18');
    });

    it('leaves an open row untouched', () => {
      const open = row('Ship ingest', { status: 'In Progress' });
      expect(carry([open], [])).toEqual([open]);
    });

    // validateReportPayload rebuilds every row from the template field list,
    // so a forged stamp cannot reach storage — but don't rely on that alone.
    it('overrides a stamp the payload tried to supply', () => {
      const [out] = carry([row('Ship ingest', { status: 'Completed', completed_on: '2020-01-01' })], [], '2026-10-17');
      expect(out.completed_on).toBe(REPORT);
    });
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

describe('In Office — time-of-day range (From/To are times, same day)', () => {
  const gem = BUILT_IN_TEMPLATES.gem_sales;

  function inOfficeEntry(over: Record<string, unknown> = {}) {
    return {
      gem_team_activity: 'In Office: Meeting / Training / Presentation / Activities',
      purpose_brief: 'Weekly sync.',
      activity_date: '2026-10-14',
      from_time: '10:00',
      to_time: '11:30',
      ...over
    };
  }

  it('accepts a well-formed time and a To strictly later than From', () => {
    expect(validateReportPayload(gem, gemPayload([inOfficeEntry()]), true).ok).toBe(true);
  });

  it('rejects a malformed time', () => {
    const result = validateReportPayload(gem, gemPayload([inOfficeEntry({ from_time: '25:61' })]), true);
    expect(result.issues.some((i) => i.path === 'entries.0.from_time')).toBe(true);
  });

  it('rejects a To time that is not strictly later than From — same minute is NOT enough', () => {
    const result = validateReportPayload(gem, gemPayload([inOfficeEntry({ to_time: '10:00' })]), true);
    expect(result.issues.some((i) => i.path === 'entries.0.to_time')).toBe(true);
    expect(validateReportPayload(gem, gemPayload([inOfficeEntry({ to_time: '09:00' })]), true).ok).toBe(false);
  });

  it('is silent about To when From is blank (nothing to compare against)', () => {
    const result = validateReportPayload(gem, gemPayload([inOfficeEntry({ from_time: '' })]), true);
    expect(result.issues.some((i) => i.path === 'entries.0.to_time')).toBe(false);
  });
});

describe('OnSite — date range (From/To are dates, a visit can span more than one day)', () => {
  const gem = BUILT_IN_TEMPLATES.gem_sales;

  function onsiteEntry(over: Record<string, unknown> = {}) {
    return {
      gem_team_activity: 'OnSite: Visit / Meeting / Demo',
      visit_with: 'Client',
      client_vendor_name: 'Acme Corp',
      location: 'Pune',
      purpose_brief: 'Demo of the new AV rig.',
      from_date: '2026-10-14',
      to_date: '2026-10-14',
      ...over
    };
  }

  it('renders From/To as date fields, not time', () => {
    expect(gem.rowFields.find((f) => f.key === 'from_date')?.type).toBe('date');
    expect(gem.rowFields.find((f) => f.key === 'to_date')?.type).toBe('date');
  });

  it('accepts a one-day visit — From and To the SAME day is the common case, not an error', () => {
    expect(validateReportPayload(gem, gemPayload([onsiteEntry()]), true).ok).toBe(true);
  });

  it('accepts a multi-day visit', () => {
    expect(validateReportPayload(gem, gemPayload([onsiteEntry({ to_date: '2026-10-16' })]), true).ok).toBe(true);
  });

  it('rejects a To date before the From date', () => {
    const result = validateReportPayload(gem, gemPayload([onsiteEntry({ to_date: '2026-10-13' })]), true);
    expect(result.issues.some((i) => i.path === 'entries.0.to_date')).toBe(true);
  });

  it('no longer has a separate Activity Date for OnSite — From/To cover it', () => {
    const activityDateField = gem.rowFields.find((f) => f.key === 'activity_date');
    expect(activityDateField?.showWhen?.equals).not.toContain('OnSite: Visit / Meeting / Demo');
  });
});

describe('url-formatted text fields', () => {
  const gem = BUILT_IN_TEMPLATES.gem_sales;

  function empanelmentEntry(over: Record<string, unknown> = {}) {
    return {
      gem_team_activity: 'Empanelment',
      client_organization: 'GeM Portal',
      location: 'Delhi',
      activity_brief: 'Began empanelment paperwork.',
      ...over
    };
  }

  it('accepts a well-formed https URL and leaves a blank one alone', () => {
    expect(validateReportPayload(gem, gemPayload([empanelmentEntry({ empanelment_portal_link: 'https://gem.gov.in/x' })]), true).ok).toBe(true);
    expect(validateReportPayload(gem, gemPayload([empanelmentEntry()]), true).ok).toBe(true);
  });

  it('rejects something that is not a real http(s) URL', () => {
    const result = validateReportPayload(gem, gemPayload([empanelmentEntry({ empanelment_portal_link: 'not a link' })]), true);
    expect(result.issues.some((i) => i.path === 'entries.0.empanelment_portal_link')).toBe(true);
  });
});

describe('GEM Sales — activity-conditional fields', () => {
  const gem = BUILT_IN_TEMPLATES.gem_sales;

  it('is a rows layout with no header fields, and Add Activity already free from the generic engine', () => {
    expect(gem.layout).toBe('rows');
    expect(gem.entryNoun).toBe('Activity');
    expect(gem.headerFields).toEqual([]);
  });

  it("marks Proposal Creation as auto-generated, with a hidden quotation-link field", () => {
    expect(gem.autoEntryActivity).toBe('Proposal Creation');
    const linkField = gem.rowFields.find((f) => f.key === 'proposal_quotation_id');
    expect(linkField?.hidden).toBe(true);
  });

  it('Proposal Creation is a valid stored activity value but not a pickable one', () => {
    const activityField = gem.rowFields.find((f) => f.key === 'gem_team_activity');
    expect(activityField?.options).toContain('Proposal Creation');
    expect(activityField?.selectableOptions).not.toContain('Proposal Creation');
    // Still validates fine as a stored value — an auto row carries it.
    const base = { gem_team_activity: 'Proposal Creation', client: 'X', location: 'Y', sales_person: 'Z', activity_brief: 'W' };
    expect(validateReportPayload(gem, gemPayload([base]), true).ok).toBe(true);
  });

  it('lists all nine activities, verbatim', () => {
    const activityField = gem.rowFields.find((f) => f.key === 'gem_team_activity');
    expect(activityField?.options).toEqual([
      'Tender Explore',
      'Proposal Creation',
      'Vendor Followup',
      'Bid Submission',
      'Empanelment',
      'Tender Documents Preparation',
      'Communication',
      'In Office: Meeting / Training / Presentation / Activities',
      'OnSite: Visit / Meeting / Demo'
    ]);
  });

  it('only persists the fields for the chosen activity, never a stale value left over from a different one', () => {
    // A row carrying both Tender Explore's and Proposal Creation's fields —
    // as if the client never cleared the previous activity's answers —
    // with gem_team_activity set to Tender Explore.
    const entry = {
      gem_team_activity: 'Tender Explore',
      client: 'Acme Corp',
      location: 'Mumbai',
      due_date: '2026-10-20',
      qualification_status: 'Qualified',
      activity_brief: 'Explored a new tender listing.',
      // Stale Proposal Creation-only field — must never be the one that
      // explains why this doesn't validate, and must never be persisted.
      sales_person: 'Someone Else'
    };
    const result = validateReportPayload(gem, gemPayload([entry]), true);
    expect(result.ok).toBe(true);
    expect(result.normalized.entries[0]).not.toHaveProperty('sales_person');
    expect(result.normalized.entries[0].due_date).toBe('2026-10-20');
  });

  it('current_status offers a different option set per activity under the same field', () => {
    const statusField = gem.rowFields.find((f) => f.key === 'current_status');
    expect(statusField?.linkedOptions?.['Tender Explore']).toContain('Disqualified');
    expect(statusField?.linkedOptions?.['Empanelment']).toContain('Documents Pending');
    expect(statusField?.linkedOptions?.['Tender Explore']).not.toEqual(statusField?.linkedOptions?.['Empanelment']);

    const base = { gem_team_activity: 'Tender Explore', client: 'X', location: 'Y', activity_brief: 'Z' };
    expect(validateReportPayload(gem, gemPayload([{ ...base, current_status: 'Disqualified' }]), true).ok).toBe(true);
    // A real status, just not one Tender Explore offers.
    expect(validateReportPayload(gem, gemPayload([{ ...base, current_status: 'Documents Pending' }]), true).ok).toBe(false);
  });

  it("Communication's follow-up date is required only when Follow-up Required is Yes — a 2-level showWhen chain", () => {
    const base = {
      gem_team_activity: 'Communication',
      location: 'Chennai',
      communication_with: 'Client',
      communication_mode: 'Call',
      purpose_brief: 'Discussed delivery timelines.'
    };
    // No follow-up requested: fine without a date.
    expect(validateReportPayload(gem, gemPayload([{ ...base, follow_up_required: 'No' }]), true).ok).toBe(true);
    // Follow-up requested, with a date: fine, and the date is persisted.
    const withDate = validateReportPayload(
      gem,
      gemPayload([{ ...base, follow_up_required: 'Yes', comm_next_follow_up_date: '2026-10-20' }]),
      true
    );
    expect(withDate.ok).toBe(true);
    expect(withDate.normalized.entries[0].comm_next_follow_up_date).toBe('2026-10-20');
  });

  it('a stale next_action_details value is dropped once next_action_required is switched back to No', () => {
    const entry = {
      gem_team_activity: 'In Office: Meeting / Training / Presentation / Activities',
      purpose_brief: 'Weekly sync.',
      next_action_required: 'No',
      // Stale — as if the employee had typed this while it was 'Yes' and
      // then changed their mind, without the client managing to clear it.
      next_action_details: 'Follow up with finance.'
    };
    const result = validateReportPayload(gem, gemPayload([entry]), true);
    expect(result.ok).toBe(true);
    expect(result.normalized.entries[0]).not.toHaveProperty('next_action_details');
  });

  it('Project Value is a plain non-negative number field under the hood, currency is presentation-only', () => {
    const field = gem.rowFields.find((f) => f.key === 'project_value');
    expect(field?.type).toBe('number');
    expect(field?.currency).toBe(true);
    const base = { gem_team_activity: 'Proposal Creation', client: 'X', location: 'Y', sales_person: 'Y', activity_brief: 'Z' };
    expect(validateReportPayload(gem, gemPayload([{ ...base, project_value: '-5' }]), true).ok).toBe(false);
    expect(validateReportPayload(gem, gemPayload([{ ...base, project_value: '125000.50' }]), true).ok).toBe(true);
  });
});
