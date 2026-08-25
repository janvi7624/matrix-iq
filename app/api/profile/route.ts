import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findUserByUsername } from '@/lib/userStore';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await findUserByUsername(viewer.username);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({
    name: user.name,
    employeeId: user.employeeId,
    department: user.department,
    designation: user.designation,
    phone: user.phone,
    email: user.email,
    birthday: user.birthday,
    dateOfJoining: user.dateOfJoining,
    location: user.location,
  });
}
