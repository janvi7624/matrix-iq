import { NextRequest, NextResponse } from 'next/server';
import { Op } from 'sequelize';
import { getTmsViewer, isTmsAdminTier } from '@/lib/tmsAccess';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { db } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';
import { findQuotationById } from '@/lib/quotationStore';
import { QuotationRecord } from '@/lib/types';

// Every document connected to one TMS project, in one place — whatever
// screen it was uploaded from:
//   the project itself, its tasks (and task progress updates), BOM requests
//   (and payment proofs), procurement, and — when the project came from a
//   won sale — that sales project's files, PO, site-visit photos, demo
//   attachments, and the won (approved) quotation.
//
// Visible to the people assigned to the project only: its project manager,
// team members, anyone with a task on it, and the salesperson who handed it
// over — plus the TMS admin tier for oversight. Department membership alone
// is NOT enough here, deliberately narrower than the project page itself.

interface DocItem {
  url: string;
  name: string;
  source: string;
  context: string;
  at: string;
}

function iso(v: unknown): string {
  if (!v) return '';
  return v instanceof Date ? v.toISOString() : String(v);
}

// Stored values are bare URLs, or occasionally {url|path, name} objects.
function urlsOf(value: unknown): { url: string; name: string }[] {
  if (!Array.isArray(value)) return typeof value === 'string' && value ? [{ url: value, name: '' }] : [];
  return value
    .map((v) => {
      if (typeof v === 'string') return { url: v, name: '' };
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const url = (typeof o.url === 'string' && o.url) || (typeof o.path === 'string' && o.path) || '';
        return { url, name: typeof o.name === 'string' ? o.name : '' };
      }
      return { url: '', name: '' };
    })
    .filter((x) => x.url);
}

function fileName(url: string, given: string): string {
  if (given) return given;
  const last = decodeURIComponent(url.split('/').pop() || 'file');
  return last.replace(/^\d{10,}-[0-9a-f]{8}-/i, '');
}

function href(url: string): string {
  return url.startsWith('/') || /^https?:/i.test(url) ? url : `/api/uploads/file/${url}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const project = await tmsProjectStore.findById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const tasks = await db.TmsTask.findAll({ where: { project_id: id } as never });
    const taskRows = tasks.map((t) => t.get({ plain: true }) as Record<string, unknown>);

    const assigned =
      isTmsAdminTier(viewer) ||
      project.project_manager_id === viewer.userId ||
      (project.team_member_ids || []).includes(viewer.userId) ||
      taskRows.some((t) => t.assignee_id === viewer.userId) ||
      (!!project.sales_person_username && project.sales_person_username === viewer.username);
    if (!assigned) {
      return NextResponse.json({ error: 'Only people assigned to this project can see its documents.' }, { status: 403 });
    }

    const docs: DocItem[] = [];
    const push = (value: unknown, source: string, context: string, at: unknown) => {
      for (const f of urlsOf(value)) docs.push({ url: href(f.url), name: fileName(f.url, f.name), source, context, at: iso(at) });
    };

    push(project.attachments, 'Project', project.name, project.created_at);

    const taskIds = taskRows.map((t) => t.id as string);
    const taskName = new Map(taskRows.map((t) => [t.id as string, String(t.name ?? '')]));
    for (const t of taskRows) push(t.attachments, 'Task', String(t.name ?? ''), t.updatedAt ?? t.updated_at);
    if (taskIds.length) {
      const updates = await db.TmsTaskUpdate.findAll({ where: { task_id: { [Op.in]: taskIds } } as never });
      for (const u of updates) {
        const p = u.get({ plain: true }) as Record<string, unknown>;
        push(p.attachments, 'Task update', taskName.get(p.task_id as string) || 'Task', p.created_at ?? p.createdAt);
      }
    }

    const boms = await db.TmsBomRequest.findAll({ where: { project_id: id } as never });
    for (const b of boms) {
      const p = b.get({ plain: true }) as Record<string, unknown>;
      const label = String(p.item_name ?? p.part_number ?? 'BOM request');
      push(p.attachments, 'BOM request', label, p.createdAt ?? p.created_at);
      push(p.payment_proof_attachments, 'BOM payment proof', label, p.updatedAt ?? p.updated_at);
    }

    const procs = await db.TmsProcurement.findAll({ where: { project_id: id } as never });
    for (const r of procs) {
      const p = r.get({ plain: true }) as Record<string, unknown>;
      push(p.documents, 'Procurement', String(p.item_name ?? p.vendor ?? 'Procurement'), p.createdAt ?? p.created_at);
    }

    // The sales side, for a project that came from a won deal.
    let quotations: QuotationRecord[] = [];
    const salesId = project.sales_project_id;
    if (salesId) {
      const sales = await db.Project.findByPk(salesId);
      if (sales) {
        const sp = sales.get({ plain: true }) as Record<string, unknown>;
        push(sp.attachments, 'Sales project', String(sp.name ?? sp.company_name ?? 'Sales project'), sp.createdAt);
      }
      const [pos, visits, demos, quotes] = await Promise.all([
        db.PurchaseOrder.findAll({ where: { project_id: salesId } as never }),
        db.SiteVisit.findAll({ where: { project_id: salesId } as never }),
        db.DemoSchedule.findAll({ where: { project_id: salesId } as never }),
        db.Quotation.findAll({ where: { project_id: salesId, status: 'approved' } as never, order: [['createdAt', 'DESC']] })
      ]);
      for (const r of pos) {
        const p = r.get({ plain: true }) as Record<string, unknown>;
        push(p.attachment_url, 'Purchase order', String(p.po_number ?? 'PO'), p.createdAt);
      }
      for (const r of visits) {
        const p = r.get({ plain: true }) as Record<string, unknown>;
        push(p.image_urls, 'Site visit', `Visit ${String(p.visit_date ?? '')}`.trim(), p.createdAt);
      }
      for (const r of demos) {
        const p = r.get({ plain: true }) as Record<string, unknown>;
        push(p.attachments, 'Demo', String(p.company || p.client_name || 'Demo'), p.createdAt);
      }
      // Through the store's own mapper, so the client can build the same PDF
      // every other screen downloads (lib/quotationPdfFromRecord.ts).
      quotations = (await Promise.all(quotes.map((q) => findQuotationById(q.get('id') as string)))).filter((q): q is QuotationRecord => !!q);
    }

    // One row per file even if the same URL was attached in two places.
    const seen = new Set<string>();
    const unique = docs.filter((d) => (seen.has(d.url) ? false : (seen.add(d.url), true)));
    unique.sort((a, b) => b.at.localeCompare(a.at));

    return NextResponse.json({ documents: unique, quotations });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
