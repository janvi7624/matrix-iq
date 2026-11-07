import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';

// OPSQA-DEF-002 regression: the legacy '/leave' + '/hr/leave' module
// (lib/leaveRequestStore.ts-backed) was permanently unreachable for every
// role, including admin — 'leave' and 'hr-leave' are both in
// lib/moduleConfigStore.ts's RETIRED_KEYS, which destroys their
// ModuleConfig row at startup, so isModuleAccessAllowed()/requireHrModule()
// can never return true for either key. Confirmed via a repo-wide reference
// search that nothing else (no background job, no other store, no live
// notification creator) depends on these files — removed as dead code.
// This pins that they stay removed rather than silently reappearing.

const root = path.resolve(__dirname, '../..');
const removedPaths = [
  'app/api/leave/route.ts',
  'app/api/leave/[id]/route.ts',
  'app/leave/page.tsx',
  'components/LeaveView.tsx',
  'app/hr/leave/page.tsx',
  'app/api/hr/leave/route.ts',
  'components/HrLeaveOversightView.tsx',
  'lib/leaveRequestStore.ts'
];

describe('legacy /leave + /hr/leave module (OPSQA-DEF-002)', () => {
  it.each(removedPaths)('%s stays removed', (relativePath) => {
    expect(existsSync(path.join(root, relativePath))).toBe(false);
  });
});
