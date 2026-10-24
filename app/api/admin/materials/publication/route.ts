import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageMaterials } from '@/lib/permissions';
import { setFolderPublication, setMaterialPublication } from '@/lib/partnerMaterialStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// Marketing publishing collateral to the Partner Portal.
//
// Authorization is canManageMaterials — the SAME rule that already governs
// adding and editing materials (lib/permissions.ts). Publishing is curation,
// so it belongs to whoever curates the library, not to partner management.
export async function PATCH(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageMaterials(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const partnerVisible = typeof body.partnerVisible === 'boolean' ? body.partnerVisible : undefined;
  const audience = Array.isArray(body.partnerAudience)
    ? body.partnerAudience.filter((a: unknown): a is string => typeof a === 'string')
    : undefined;

  try {
    if (typeof body.materialId === 'string' && body.materialId) {
      const ok = await setMaterialPublication(body.materialId, { partnerVisible, partnerAudience: audience }, viewer.userId);
      if (!ok) return NextResponse.json({ error: 'Material not found' }, { status: 404 });
      void logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'material',
        entityId: body.materialId,
        action: partnerVisible ? 'Material published to partners' : 'Material withdrawn from partners',
        previousStatus: '',
        newStatus: partnerVisible ? 'published' : 'internal',
        ip: getClientIp(request)
      });
      return NextResponse.json({ ok: true });
    }

    if (typeof body.folderId === 'string' && body.folderId) {
      if (partnerVisible === undefined) return NextResponse.json({ error: 'partnerVisible is required' }, { status: 400 });
      const ok = await setFolderPublication(body.folderId, partnerVisible, viewer.userId);
      if (!ok) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
      void logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'material',
        entityId: body.folderId,
        action: partnerVisible ? 'Material folder opened to partners' : 'Material folder closed to partners',
        previousStatus: '',
        newStatus: partnerVisible ? 'published' : 'internal',
        ip: getClientIp(request)
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'materialId or folderId is required' }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
