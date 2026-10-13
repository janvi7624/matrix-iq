import { describe, it, expect } from 'vitest';
import { REVIEW_SECTIONS, reviewScopeNote, reviewSectionsFor, showsSection } from '../../lib/performanceReviewScope';

// The whole department-based review hinges on this one pure function, and the
// failure mode is quiet: get it wrong and someone's review silently loses the
// measures their job is actually judged on, or gains a wall of zeros from a
// module they never touch.

const all = [...REVIEW_SECTIONS];

describe('reviewSectionsFor — sales', () => {
  it.each(['Sales', 'GEM - Sales'])('gives %s the pipeline measures', (department) => {
    const s = reviewSectionsFor({ role: 'user', department });
    expect(s).toContain('crm');
    expect(s).toContain('sales');
    expect(s).toContain('followUps');
    expect(s).toContain('customerResponse');
  });

  it('does not put TMS or marketing on a sales review', () => {
    const s = reviewSectionsFor({ role: 'user', department: 'Sales' });
    expect(s).not.toContain('tms');
    expect(s).not.toContain('marketing');
  });
});

describe('reviewSectionsFor — technical', () => {
  // Every delivery department this install actually has, including R&D, which
  // is missing from lib/departmentCategoryMap.ts.
  it.each(['AI', 'AV', 'Robotics', 'R&D', 'Technical', 'Back Office'])('scopes %s to delivery', (department) => {
    const s = reviewSectionsFor({ role: 'user', department });
    expect(s).toEqual(['projects', 'tms', 'tasks']);
  });

  it('keeps the sales block off a technical review — the point of the change', () => {
    const s = reviewSectionsFor({ role: 'user', department: 'AI' });
    for (const section of ['crm', 'sales', 'siteVisits', 'demo', 'followUps', 'dc', 'customerResponse']) {
      expect(s).not.toContain(section);
    }
  });

  it.each(['engineer', 'technician', 'team-lead', 'technical-manager'])(
    'scopes a %s by role even with no department recorded against them',
    (role) => {
      expect(reviewSectionsFor({ role, department: 'Something Unmapped' })).toEqual(['projects', 'tms', 'tasks']);
    }
  );
});

describe('reviewSectionsFor — marketing and HR', () => {
  it('gives Marketing its requests and nothing of sales', () => {
    const s = reviewSectionsFor({ role: 'user', department: 'Marketing' });
    expect(s).toEqual(['marketing', 'tasks']);
    expect(s).not.toContain('crm');
    expect(s).not.toContain('sales');
  });

  it.each(['HR', 'HR & Admin', 'hr & admin'])('gives %s planner tasks only, no sales', (department) => {
    expect(reviewSectionsFor({ role: 'user', department })).toEqual(['tasks']);
  });
});

describe('reviewSectionsFor — who still sees everything', () => {
  it.each(['Administration', 'Accounts', 'Management', 'Purchase', 'Inventory'])(
    'leaves an oversight department (%s) unabridged',
    (department) => {
      expect(reviewSectionsFor({ role: 'user', department })).toEqual(all);
    }
  );

  it.each(['admin', 'superadmin'])('leaves %s unabridged whatever their department', (role) => {
    expect(reviewSectionsFor({ role, department: 'AI' })).toEqual(all);
  });

  // 10 active users have no department. Narrowing on a blank field would blank
  // most of their page, so this must stay the full review.
  it.each([undefined, null, '', '   '])('falls back to everything for a blank department (%s)', (department) => {
    expect(reviewSectionsFor({ role: 'user', department })).toEqual(all);
  });

  it('falls back to everything for a department nobody has mapped yet', () => {
    expect(reviewSectionsFor({ role: 'user', department: 'Legal' })).toEqual(all);
  });
});

describe('ordering and helpers', () => {
  it('always returns sections in REVIEW_SECTIONS order, so the page reads the same for everyone', () => {
    for (const department of ['Sales', 'AI', 'Marketing', 'HR', 'Accounts']) {
      const s = reviewSectionsFor({ role: 'user', department });
      const indexes = s.map((x) => REVIEW_SECTIONS.indexOf(x));
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    }
  });

  it('showsSection agrees with reviewSectionsFor', () => {
    const user = { role: 'user', department: 'AI' };
    expect(showsSection(user, 'tms')).toBe(true);
    expect(showsSection(user, 'sales')).toBe(false);
  });

  it('notes the narrowing only when something was actually narrowed', () => {
    expect(reviewScopeNote({ role: 'user', department: 'AI' })).toContain('AI');
    expect(reviewScopeNote({ role: 'user', department: 'Accounts' })).toBe('');
    expect(reviewScopeNote({ role: 'superadmin', department: 'AI' })).toBe('');
  });
});
