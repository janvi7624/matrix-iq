import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';

// A session token is rebuilt from scratch at every issuing site, so a claim
// that is not passed is not "left unchanged" — it is erased.
//
// That is how the partner confinement broke: partnerId was added to login
// and change-password but missed in heartbeat, which fires on real
// interaction. Minutes into a session a partner's token silently lost the
// claim, proxy.ts stopped keeping them inside /partner/**, and the internal
// dashboard rendered for them.
//
// Source-level because the failure is an OMISSION. No type catches it — every
// field on the input is optional by design — and no behavioural test catches
// it without a browser session that survives a heartbeat.

const ISSUERS = [
  'app/api/auth/login/route.ts',
  'app/api/auth/change-password/route.ts',
  'app/api/auth/heartbeat/route.ts'
];

/** The argument object passed to createSessionToken, as written. */
function tokenCall(src: string): string {
  const start = src.indexOf('createSessionToken({');
  expect(start, 'expected a createSessionToken call').toBeGreaterThan(-1);
  const end = src.indexOf('});', start);
  return src.slice(start, end);
}

describe('every session-issuing site carries every claim', () => {
  it.each(ISSUERS)('%s passes partnerId', (file) => {
    // The restricting claim, and so the most damaging one to drop: losing it
    // widens the session instead of narrowing it.
    expect(tokenCall(fs.readFileSync(file, 'utf8'))).toContain('partnerId');
  });

  it.each(ISSUERS)('%s passes the identity and privilege claims', (file) => {
    const call = tokenCall(fs.readFileSync(file, 'utf8'));
    for (const claim of ['id', 'username', 'role', 'isPrivileged']) {
      expect(call).toContain(claim);
    }
  });

  it('has no token-issuing site outside the audited list', () => {
    // A new issuer that nobody added here would reintroduce exactly this bug.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && fs.readFileSync(full, 'utf8').includes('createSessionToken(')) {
          found.push(full);
        }
      }
    };
    walk('app');
    walk('lib');
    // lib/auth.ts defines it; the rest must be the known issuers.
    expect(found.filter((f) => f !== 'lib/auth.ts').sort()).toEqual([...ISSUERS].sort());
  });
});
