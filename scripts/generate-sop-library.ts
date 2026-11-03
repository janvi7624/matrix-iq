/*
 * Builds the MatrixIQ SoP library: one PDF per role, filed into
 * Marketing Material under
 *
 *   MatrixIQ SoP  (open to everyone)
 *     └── <Role>  (limited to that role)
 *           └── MatrixIQ SoP - <Role>.pdf
 *
 * Run it with:
 *   npx tsx scripts/generate-sop-library.ts --dry-run    # write PDFs, touch nothing
 *   npx tsx scripts/generate-sop-library.ts              # write, upload, file
 *
 * IDEMPOTENT, and that is the point: it is meant to be re-run after any
 * change in Role Management or Module Manager, because the permissions
 * printed in each PDF are read from the live configuration. A second run
 * reuses the folders it made and REPLACES each role's document rather than
 * filing a second copy beside it.
 *
 * The parent folder is deliberately left open to everyone while each role
 * folder is narrowed. That is the folder-chain rule in
 * lib/materialRoleVisibility.ts doing exactly what it exists for: the parent
 * stays browsable, so everybody can see that an SoP library exists, and the
 * children are not interchangeable.
 *
 * superadmin gets no folder. It is the one role that reads every other
 * role's SoP (seesEveryRole lets it past the gate), so a document of its own
 * would be a fifteenth copy of the other fourteen.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { listActiveRoles, listRoles } from '../lib/roleStore';
import { listModuleConfigs } from '../lib/moduleConfigStore';
import { buildSopDocument, sopFileName, SopModuleInput } from '../lib/sopDocument';
import { renderSopPdf } from '../lib/sopPdf';
import {
  createFolder,
  listRoleScopedFolders,
  listFolderTree,
  updateFolder
} from '../lib/materialFolderStore';
import { createMaterial, listMaterials, updateMaterial } from '../lib/materialStore';
import { formatIstDate } from '../lib/dailyReportTime';

const PARENT_FOLDER = 'MatrixIQ SoP';
const DRY_RUN = process.argv.includes('--dry-run');
const OUT_DIR = path.join(process.cwd(), '.sop-out');

/** Who the documents are filed as. Resolved, never guessed — see main(). */
const ACTOR_USERNAME = process.env.SOP_ACTOR || 'main';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

async function folderIdByPath(name: string, parentId: string | null): Promise<string | null> {
  const tree = await listFolderTree();
  const match = tree.find((node) => node.name === name && node.parentId === parentId);
  return match?.id ?? null;
}

/**
 * The folder, made if it is not there yet.
 *
 * Matched on name AND parent, which is what makes a re-run reuse rather than
 * duplicate — the library already holds three separate folders called
 * "Robots" at the top level, so name alone is not an identity here.
 */
async function ensureFolder(
  name: string,
  parentId: string | null,
  visibleToRoles: string[],
  description: string,
  actorId: string
): Promise<string> {
  const existing = await folderIdByPath(name, parentId);
  if (existing) {
    // Re-applied on every run: a role added to Role Management since the last
    // run has to end up on its folder, and somebody may have widened one by
    // hand in the meantime.
    if (!DRY_RUN) await updateFolder(existing, { visibleToRoles, description, actorId });
    log(`  = folder "${name}" already exists${DRY_RUN ? '' : ' (roles re-applied)'}`);
    return existing;
  }
  if (DRY_RUN) {
    log(`  + would create folder "${name}" limited to [${visibleToRoles.join(', ') || 'everyone'}]`);
    return `dry-run-${name}`;
  }
  const folder = await createFolder({ name, parentId, description, visibleToRoles, actorId });
  log(`  + created folder "${name}" limited to [${visibleToRoles.join(', ') || 'everyone'}]`);
  return folder.id;
}

async function main(): Promise<void> {
  const { db } = await import('../lib/db');

  const actor = await db.User.findOne({ where: { username: ACTOR_USERNAME } as never });
  if (!actor) throw new Error(`No user "${ACTOR_USERNAME}" to file these as. Set SOP_ACTOR to an existing username.`);
  const actorId = actor.get('id') as string;

  const [allRoles, activeRoles, modules] = await Promise.all([listRoles(), listActiveRoles(), listModuleConfigs()]);
  const subjects = activeRoles.filter((role) => role.key !== 'superadmin');

  // Named rather than silently dropped. An INACTIVE role's permission matrix
  // is never consulted by the app — isModuleActionAllowed requires
  // status === 'active' — so its SoP would describe a role nobody can hold
  // and would read as though it grants nothing. Reactivate it in Role
  // Management and re-run; this script reads the live configuration.
  const skipped = allRoles.filter((role) => role.status !== 'active');

  log(`${DRY_RUN ? 'DRY RUN — ' : ''}${subjects.length} active roles, ${modules.length} modules, filed as ${ACTOR_USERNAME}.`);
  if (skipped.length) {
    log(`Skipping ${skipped.length} inactive role(s): ${skipped.map((role) => `${role.label} (${role.key})`).join(', ')}.`);
    log('An inactive role\'s permissions are not consulted by the app, so an SoP for it would state that it grants nothing.');
  }
  if (!subjects.length) throw new Error('No active roles other than superadmin — nothing to write.');

  mkdirSync(OUT_DIR, { recursive: true });

  const generatedOn = formatIstDate(new Date().toISOString().slice(0, 10));
  const meta = { generatedOn, organisation: 'Nanta Technologies' };

  // Rendered BEFORE anything is created, so a dry run proves the documents
  // without touching the library at all — and so a rendering failure on the
  // twelfth role does not leave eleven folders already filed.
  log(`\nDocuments:`);
  const rendered: { role: (typeof subjects)[number]; fileName: string; localPath: string; pending: number; modules: number }[] = [];
  let pendingTotal = 0;
  const contradictions: string[] = [];

  for (const role of subjects) {
    const document = buildSopDocument(role, modules as unknown as SopModuleInput[]);
    if (!document.moduleCount) {
      log(`  - ${role.label}: no modules are visible to this role, skipped.`);
      continue;
    }

    const bytes = await renderSopPdf(document, meta);
    const fileName = sopFileName(role);
    const localPath = path.join(OUT_DIR, fileName);
    writeFileSync(localPath, bytes);
    pendingTotal += document.pendingCount;
    rendered.push({ role, fileName, localPath, pending: document.pendingCount, modules: document.moduleCount });
    log(
      `  * ${role.label}: ${document.moduleCount} modules, ${document.pendingCount} without a written procedure, ` +
        `${(bytes.byteLength / 1024).toFixed(0)} KB -> ${localPath}`
    );
    // Worth saying out loud on every run: Module Manager shows the tile and
    // Role Management refuses view on it. Neither screen can see the other,
    // so nothing else in the app reports this.
    if (document.contradictions.length) {
      contradictions.push(`${role.label}: ${document.contradictions.join(', ')}`);
    }
  }

  if (contradictions.length) {
    log(`\nModule Manager and Role Management disagree for ${contradictions.length} role(s):`);
    for (const line of contradictions) log(`  ! ${line}`);
    log('  The tile is shown to the role, but the role is explicitly refused "view" on it.');
    log('  Each SoP says so on that module\'s own page. Settle it in one screen or the other.');
  }

  if (DRY_RUN) {
    log(`\n${rendered.length} PDF(s) written to ${OUT_DIR}. Nothing was uploaded or filed.`);
    log(`${pendingTotal} module page(s) across all roles still have no written procedure.`);
    return;
  }

  // The parent stays open to EVERYONE. Narrowing it would hide every role
  // folder inside it, because the chain gate is evaluated to the root.
  log(`\nFolders:`);
  const parentId = await ensureFolder(
    PARENT_FOLDER,
    null,
    [],
    'Standard Operating Procedures for MatrixIQ, one per role. Each role folder inside is limited to that role.',
    actorId
  );

  const existing = await listMaterials({ anyFolder: true });

  log(`\nFiling:`);
  let written = 0;

  for (const { role, fileName, localPath } of rendered) {
    written += 1;
    const roleFolderId = await ensureFolder(
      role.label,
      parentId,
      [role.key],
      `The MatrixIQ SoP for ${role.label}. Visible to that role, and to Marketing and superadmin who curate the library.`,
      actorId
    );

    // Uploaded through the app's own storage, so the document is served by
    // /api/uploads/file/... exactly as any other uploaded material is — not
    // linked from somewhere outside MatrixIQ.
    const uploadedUrl = await uploadPdf(localPath, fileName);

    // Replaced, not duplicated: a re-run of this script must not leave two
    // SoPs for one role, because the older one is the one somebody opens.
    const already = existing.find((material) => material.folderId === roleFolderId && material.product === PARENT_FOLDER);
    if (already) {
      await updateMaterial(already.id, {
        title: fileName,
        webViewLink: uploadedUrl,
        driveFileId: '',
        isFolder: false,
        source: 'upload',
        mimeType: 'application/pdf',
        visibleToRoles: [role.key],
        actorId
      });
      log(`    ~ replaced the existing document for ${role.label}`);
    } else {
      await createMaterial({
        folderId: roleFolderId,
        product: PARENT_FOLDER,
        category: 'other',
        title: fileName,
        description: `Standard Operating Procedure for the ${role.label} role. Generated ${generatedOn}.`,
        driveFileId: '',
        webViewLink: uploadedUrl,
        isFolder: false,
        source: 'upload',
        mimeType: 'application/pdf',
        partnerVisible: false,
        visibleToRoles: [role.key],
        actorId
      });
      log(`    + filed the SoP for ${role.label}`);
    }
  }

  log(
    `\n${written} SoP(s) filed under "${PARENT_FOLDER}". ` +
      `${pendingTotal} module page(s) across all roles still have no written procedure.`
  );
  log(`Local copies kept in ${OUT_DIR} for review.`);
}

/**
 * Puts the PDF into this app's own storage and returns the URL a material
 * row should point at.
 *
 * Calls putFile directly rather than POSTing to /api/uploads, because a
 * script has no session to authenticate with and minting one would be a far
 * worse idea than using the layer the route itself uses. The pathname and the
 * returned URL are built to exactly the same shape as that route's, so the
 * authenticated download proxy serves these files identically to every other
 * uploaded material.
 */
async function uploadPdf(localPath: string, fileName: string): Promise<string> {
  const { putFile } = await import('../lib/fileStorage');
  const bytes = readFileSync(localPath);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Stable per run, unique across runs: a replaced document gets a new
  // pathname rather than overwriting bytes somebody may still have open.
  const pathname = `uploads/sop/${ACTOR_USERNAME}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
  const file = new File([new Uint8Array(bytes)], safeName, { type: 'application/pdf' });
  const { pathname: stored } = await putFile(pathname, file, ACTOR_USERNAME);
  return `/api/uploads/file/${stored.split('/').map(encodeURIComponent).join('/')}`;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
