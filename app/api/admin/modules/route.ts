import { NextResponse } from 'next/server';
import { listModuleConfigs } from '@/lib/moduleConfigStore';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin/superadmin/manager gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function GET() {
  try {
    const modules = await listModuleConfigs();
    return NextResponse.json(modules);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
