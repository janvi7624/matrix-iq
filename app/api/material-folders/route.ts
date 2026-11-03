import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageMaterials } from '@/lib/permissions';
import {
  createFolder,
  listFolderTree,
  listRoleScopedFolders,
  FolderTreeError
} from '@/lib/materialFolderStore';
import { roleVisibleFolders, seesEveryRole } from '@/lib/materialRoleVisibility';
import { readMaterialRoleList } from '@/lib/materialRoleInput';
import { apiErrorResponse } from '@/lib/apiError';

// The whole folder tree — flat, with each folder's parent — so the client can
// render a breadcrumb or a move-to picker without a request per level.
//
// Readable by everyone, because the folders ARE the navigation — but narrowed
// to the roles each folder admits (lib/materialRoleVisibility.ts). That
// narrowing matters more here than anywhere else in the module: this endpoint
// returns every folder NAME, so without it the move-to picker and the
// breadcrumb would list "MatrixIQ SoP / HR" to an engineer who cannot open
// it, and the gate on the contents would read as a bug rather than a rule.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const canManage = await canManageMaterials(viewer);
    if (seesEveryRole(viewer.role, canManage)) {
      return NextResponse.json({ folders: await listFolderTree(), canManage });
    }

    // Two reads of the same table, kept rather than merged: listFolderTree
    // returns the node shape the client renders, and the role lists are a
    // separate concern the client has no business receiving. The table holds
    // nine rows.
    const [nodes, scoped] = await Promise.all([listFolderTree(), listRoleScopedFolders()]);
    const allowed = new Set(roleVisibleFolders(scoped, viewer.role).map((folder) => folder.id));
    return NextResponse.json({ folders: nodes.filter((node) => allowed.has(node.id)), canManage });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Marketing-only, like every other write in this module.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageMaterials(viewer))) {
    return NextResponse.json({ error: 'Only the Marketing team can create folders.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const folder = await createFolder({
      name: typeof body.name === 'string' ? body.name : '',
      parentId: typeof body.parentId === 'string' && body.parentId ? body.parentId : null,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      partnerVisible: body.partnerVisible === true,
      // Omitted means every internal role — narrowing is always explicit, so
      // a new folder is never born invisible.
      visibleToRoles: await readMaterialRoleList(body.visibleToRoles),
      actorId: viewer.userId
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    // Every tree rule failure is an explanation written for the person who
    // tried it — a 400 with that message, not a 500.
    if (error instanceof FolderTreeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
