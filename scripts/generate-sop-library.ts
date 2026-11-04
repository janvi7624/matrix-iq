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
 * Idempotent in the document-control sense too. Each document carries a
 * revision number, and a revision that climbs on every run would be worthless
 * — so the content is fingerprinted and recorded in scripts/sop-revision-log.json.
 * A run where nothing has changed reprints the same revision with the same
 * effective date; a run after a permissions change issues the next one and
 * says so in the document's own revision history table. That ledger is the
 * document history: commit it with the work.
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

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { listActiveRoles, listRoles } from '../lib/roleStore';
import { listModuleConfigs } from '../lib/moduleConfigStore';
import { buildSopDocument, SopDocument, SopIssue, SopRevision, sopDocumentNumber, sopFileName, SopModuleInput } from '../lib/sopDocument';
import { renderSopPdf } from '../lib/sopPdf';
import {
  createFolder,
  listRoleScopedFolders,
  listFolderTree,
  updateFolder
} from '../lib/materialFolderStore';
import { createMaterial, listMaterials, updateMaterial } from '../lib/materialStore';
import { formatIstDate } from '../lib/dailyReportTime';
import { isPartnerRoleKey } from '../lib/partnerRoles';

const PARENT_FOLDER = 'MatrixIQ SoP';
const DRY_RUN = process.argv.includes('--dry-run');
const OUT_DIR = path.join(process.cwd(), '.sop-out');

/** The revision ledger. Committed, because it is the document's own history. */
const REVISION_LOG = path.join(process.cwd(), 'scripts', 'sop-revision-log.json');

const ORGANISATION = process.env.SOP_ORGANISATION || 'Nanta Technologies';
const CLASSIFICATION = 'Internal — Confidential';
const PARTNER_CLASSIFICATION = 'Confidential — Authorised Channel Partners';
const ISSUED_BY = 'MatrixIQ Document Control';

/** Who the documents are filed as. Resolved, never guessed — see main(). */
const ACTOR_USERNAME = process.env.SOP_ACTOR || 'main';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

interface LoggedRevision {
  revision: string;
  /** ISO date, so the log does not depend on a display format. */
  date: string;
  summary: string;
  issuedBy: string;
  /** Fingerprint of the document's content, excluding its own issue details. */
  hash: string;
}

type RevisionLog = Record<string, LoggedRevision[]>;

function readRevisionLog(): RevisionLog {
  if (!existsSync(REVISION_LOG)) return {};
  try {
    const parsed = JSON.parse(readFileSync(REVISION_LOG, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as RevisionLog) : {};
  } catch {
    // A corrupt ledger must not silently restart every document at revision
    // 01 — that would claim an initial issue for a document people already
    // hold.
    throw new Error(`${REVISION_LOG} exists but could not be parsed. Fix or remove it before reissuing.`);
  }
}

/**
 * What this document says, independent of which revision it is.
 *
 * The whole point: re-running the generator must NOT bump a revision when
 * nothing has changed. A revision number that climbs on every run tells a
 * reader the document was revised when it was merely regenerated, and then
 * nobody trusts the number. So the content is fingerprinted, and the revision
 * moves only when the fingerprint does.
 */
function contentHash(document: SopDocument): string {
  const { control: _control, revisionHistory: _history, ...content } = document;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
}

function nextRevision(previous: string | undefined): string {
  const current = Number.parseInt(previous ?? '0', 10);
  return String((Number.isFinite(current) ? current : 0) + 1).padStart(2, '0');
}

function addYear(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

/** Initials, for the document number — "Nanta Technologies" gives NT. */
function organisationPrefix(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return initials.slice(0, 4) || 'ORG';
}

/**
 * One number per document, collisions resolved.
 *
 * Two labels can abbreviate to the same letters — "Marketing" and "Market
 * Research" both give MAR — and two controlled documents may not share a
 * number. Roles are numbered in their configured order, so the assignment is
 * stable across runs as long as that order is.
 */
function assignDocumentNumbers(roles: { key: string; label: string }[], prefix: string): Map<string, string> {
  const claimed = new Map<string, number>();
  const assigned = new Map<string, string>();
  for (const role of roles) {
    const base = sopDocumentNumber(role, prefix);
    const seen = claimed.get(base) ?? 0;
    claimed.set(base, seen + 1);
    assigned.set(role.key, seen ? `${base}-${seen + 1}` : base);
  }
  return assigned;
}

/**
 * What the Materials list shows under the title.
 *
 * The document number and revision are repeated here so that somebody
 * looking at the library can tell whether the copy they downloaded last month
 * is the current one, without opening it.
 */
function materialDescription(control: SopDocument['control']): string {
  return `${control.documentNumber} — ${control.documentTitle}. Revision ${control.revision}, effective ${control.effectiveDate}. ${control.classification}. Generated from the live MatrixIQ configuration; not to be amended by hand.`;
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

  const today = new Date().toISOString().slice(0, 10);
  const generatedOn = formatIstDate(today);
  const meta = { generatedOn, organisation: ORGANISATION };
  const prefix = organisationPrefix(ORGANISATION);
  const ledger = readRevisionLog();
  const documentNumbers = assignDocumentNumbers(subjects, prefix);

  // Rendered BEFORE anything is created, so a dry run proves the documents
  // without touching the library at all — and so a rendering failure on the
  // twelfth role does not leave eleven folders already filed.
  log(`\nDocuments:`);
  const rendered: {
    role: (typeof subjects)[number];
    fileName: string;
    localPath: string;
    pending: number;
    modules: number;
    control: SopDocument['control'];
  }[] = [];
  let pendingTotal = 0;
  let reissued = 0;
  const contradictions: string[] = [];

  for (const role of subjects) {
    // Built once with no issue details to fingerprint the content, then again
    // with the revision that fingerprint earns it. Cheap — it is a pure
    // function over data already in memory.
    const probe = buildSopDocument(role, modules as unknown as SopModuleInput[]);
    if (!probe.moduleCount) {
      log(`  - ${role.label}: no modules are visible to this role, skipped.`);
      continue;
    }

    const hash = contentHash(probe);
    const history = ledger[role.key] ?? [];
    const last = history[history.length - 1];
    const unchanged = last?.hash === hash;

    const issue: Partial<SopIssue> = {
      revision: unchanged ? last.revision : nextRevision(last?.revision),
      effectiveDate: formatIstDate(unchanged ? last.date : today),
      nextReviewDate: formatIstDate(addYear(unchanged ? last.date : today)),
      issuedBy: ISSUED_BY,
      prefix,
      documentNumber: documentNumbers.get(role.key),
      // A partner's copy leaves the building, so "Internal" would be false on
      // the one document where the classification actually matters.
      classification: isPartnerRoleKey(role.key) ? PARTNER_CLASSIFICATION : CLASSIFICATION,
      // The row for this revision is added by the builder; the ledger holds
      // only the ones before it.
      history: (unchanged ? history.slice(0, -1) : history).map(
        (entry): SopRevision => ({
          revision: entry.revision,
          date: formatIstDate(entry.date),
          summary: entry.summary,
          issuedBy: entry.issuedBy
        })
      )
    };

    const document = buildSopDocument(role, modules as unknown as SopModuleInput[], issue);
    const bytes = await renderSopPdf(document, meta);
    const fileName = sopFileName(role);
    const localPath = path.join(OUT_DIR, fileName);
    writeFileSync(localPath, bytes);
    pendingTotal += document.pendingCount;
    rendered.push({ role, fileName, localPath, pending: document.pendingCount, modules: document.moduleCount, control: document.control });

    if (!unchanged) {
      reissued += 1;
      const current = document.revisionHistory[document.revisionHistory.length - 1];
      ledger[role.key] = [...history, { revision: current.revision, date: today, summary: current.summary, issuedBy: current.issuedBy, hash }];
    }

    log(
      `  * ${document.control.documentNumber} rev. ${document.control.revision} — ${role.label}: ` +
        `${document.moduleCount} modules, ${document.pendingCount} without a written procedure, ` +
        `${(bytes.byteLength / 1024).toFixed(0)} KB${unchanged ? ' (content unchanged, revision held)' : ' (new revision)'}`
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
    log('  Each SoP says so in that module\'s own clause. Settle it in one screen or the other.');
  }

  if (DRY_RUN) {
    log(`\n${rendered.length} PDF(s) written to ${OUT_DIR}. Nothing was uploaded, filed or recorded in the revision ledger.`);
    log(`${reissued} document(s) would take a new revision; ${rendered.length - reissued} are unchanged.`);
    log(`${pendingTotal} module clause(s) across all roles still have no written procedure.`);
    return;
  }

  // Written before the documents are filed. If filing fails halfway the
  // ledger is ahead of the library, which is recoverable — a re-run reissues
  // nothing and files what is missing. The reverse, a filed document with no
  // recorded revision, would restart it at 01 on the next run.
  writeFileSync(REVISION_LOG, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  log(`\nRevision ledger: ${reissued} reissued, ${rendered.length - reissued} held, recorded in ${REVISION_LOG}.`);

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

  for (const { role, fileName, localPath, control } of rendered) {
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
        description: materialDescription(control),
        visibleToRoles: [role.key],
        actorId
      });
      log(`    ~ replaced the document for ${role.label} with rev. ${control.revision}`);
    } else {
      await createMaterial({
        folderId: roleFolderId,
        product: PARENT_FOLDER,
        category: 'other',
        title: fileName,
        description: materialDescription(control),
        driveFileId: '',
        webViewLink: uploadedUrl,
        isFolder: false,
        source: 'upload',
        mimeType: 'application/pdf',
        partnerVisible: false,
        visibleToRoles: [role.key],
        actorId
      });
      log(`    + filed ${control.documentNumber} rev. ${control.revision} for ${role.label}`);
    }
  }

  log(
    `\n${written} SoP(s) filed under "${PARENT_FOLDER}". ` +
      `${pendingTotal} module clause(s) across all roles still have no written procedure.`
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
