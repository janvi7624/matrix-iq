import { describe, it, expect, vi } from 'vitest';

// REL-DEPLOY-004 regression: /api/health is a NEW, unauthenticated infra
// liveness/readiness probe — distinct from /api/dashboard/health (an
// authenticated business feature). Pins both outcomes: DB reachable -> 200
// ok, DB unreachable -> 503, never throwing or leaking anything beyond
// status/db/time.

const { authenticateMock } = vi.hoisted(() => ({ authenticateMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ sequelize: { authenticate: authenticateMock } }));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('returns 200 ok when the database is reachable', async () => {
    authenticateMock.mockResolvedValueOnce(undefined);
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(typeof body.time).toBe('string');
  });

  it('returns 503 when the database is unreachable, without throwing', async () => {
    authenticateMock.mockRejectedValueOnce(new Error('connection refused'));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.db).toBe('unreachable');
  });
});
