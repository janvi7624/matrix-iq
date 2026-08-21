import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { db } from '@/lib/db';

// Lightweight user list for dropdowns (handover, assignment, etc.)
// Returns only id, username, name for all active users.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db.User.findAll({
    where: { status: 'active' },
    attributes: ['id', 'username', 'name'],
    order: [['name', 'ASC']]
  });

  return NextResponse.json(rows.map((r: any) => ({
    id: r.get('id'),
    username: r.get('username'),
    name: r.get('name') || r.get('username')
  })));
}
