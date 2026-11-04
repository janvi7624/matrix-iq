import { describe, it, expect } from 'vitest';
import {
  actionAllowed,
  buildSopDocument,
  moduleRights,
  modulesForRole,
  rightsNote,
  sopDocumentNumber,
  sopFileName,
  SopModuleInput
} from '../../lib/sopDocument';
import { MODULE_SOP } from '../../lib/sopContent';
import { RoleRecord } from '../../lib/types';

// Assembling a role's SoP from the live registry and the live role record.
//
// The thing most worth pinning is the permission fallback: the app answers
// "may this role do X here?" with the role's explicit boolean if it has one
// and with isPrivileged otherwise. A document that gets that backwards tells
// people they cannot do something they do all day, which is the fastest way
// to make an SoP ignored.

const role = (over: Partial<RoleRecord> = {}): RoleRecord => ({
  id: 'r1',
  key: 'engineer',
  label: 'Engineer',
  description: 'Field and technical staff.',
  isSystem: true,
  isPrivileged: false,
  status: 'active',
  order: 1,
  permissions: { modules: {}, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, viewAllDepartments: false },
  created_at: '',
  created_by: '',
  updated_at: '',
  updated_by: '',
  ...over
});

const mod = (over: Partial<SopModuleInput> = {}): SopModuleInput => ({
  key: 'projects',
  label: 'Project Dashboard',
  desc: 'Every sales project.',
  href: '/projects',
  section: 'Sales',
  order: 1,
  enabled: true,
  ...over
});

describe('modulesForRole', () => {
  // The registry expresses "not restricted" as an empty or absent list.
  // Reading that as "nobody" would hand every role an empty SoP.
  it('treats an empty role list as every role', () => {
    const mods = [mod({ visibleToRoles: [] }), mod({ key: 'x', visibleToRoles: undefined })];
    expect(modulesForRole(mods, 'engineer')).toHaveLength(2);
  });

  it('honours a populated role list', () => {
    const mods = [mod({ key: 'hr-only', visibleToRoles: ['hr'] }), mod({ key: 'mine', visibleToRoles: ['engineer'] })];
    expect(modulesForRole(mods, 'engineer').map((m) => m.key)).toEqual(['mine']);
  });

  it('leaves out a disabled module', () => {
    expect(modulesForRole([mod({ enabled: false })], 'engineer')).toHaveLength(0);
  });
});

const withModules = (modules: Record<string, Record<string, boolean>>, over: Partial<RoleRecord> = {}) =>
  role({
    ...over,
    permissions: {
      modules,
      manageSettings: false,
      manageUsers: false,
      manageRoles: false,
      manageDepartments: false,
      viewAllDepartments: false,
      ...(over.permissions ?? {})
    }
  } as Partial<RoleRecord>);

// The three states, and why they are three.
//
// The matrix is SPARSE: of 60 modules, a live role has explicit entries for
// fewer than ten, and most modules never consult it at all. Collapsing "not
// mentioned" into "not allowed" would print "no actions are granted to your
// role" on nearly every page about modules those people use all day — the
// one obviously-false sentence that makes a reader distrust the whole
// document. These pin the distinction.
describe('moduleRights — granted, denied, and not mentioned', () => {
  it('reports a module the matrix says nothing about as unconfigured, not as denied', () => {
    const rights = moduleRights(role(), 'projects');
    expect(rights.configured).toBe(false);
    expect(rights.granted).toEqual([]);
    expect(rights.denied).toEqual([]);
  });

  it('separates explicit grants from explicit refusals', () => {
    const r = withModules({ projects: { view: true, create: true, delete: false, approve: false } });
    const rights = moduleRights(r, 'projects');
    expect(rights.configured).toBe(true);
    expect(rights.granted).toEqual(['view', 'create']);
    expect(rights.denied).toEqual(['approve', 'delete']);
  });

  // An entry can exist and still say nothing — an object with no booleans in
  // it is not a decision about anybody.
  it('does not count an entry with no booleans as configured', () => {
    expect(moduleRights(withModules({ projects: {} }), 'projects').configured).toBe(false);
  });

  it('reports privilege, which is what unmentioned actions fall back to', () => {
    expect(moduleRights(role({ isPrivileged: true }), 'projects').privileged).toBe(true);
    expect(moduleRights(role(), 'projects').privileged).toBe(false);
  });

  // An inactive role's permissions are not consulted by the app, so the
  // document must not claim them either.
  it('ignores the matrix of an inactive role entirely', () => {
    const r = withModules({ projects: { view: true } }, { status: 'inactive', isPrivileged: true });
    const rights = moduleRights(r, 'projects');
    expect(rights.granted).toEqual([]);
    expect(rights.configured).toBe(false);
    expect(rights.privileged).toBe(false);
  });
});

describe('actionAllowed — mirrors isModuleActionAllowed exactly', () => {
  it('falls back to privilege when the matrix is silent', () => {
    expect(actionAllowed(role(), 'projects', 'edit')).toBe(false);
    expect(actionAllowed(role({ isPrivileged: true }), 'projects', 'edit')).toBe(true);
  });

  // An explicit false must beat privilege, or Role Management could never
  // take anything away from a privileged role.
  it('lets an explicit false override privilege', () => {
    const r = withModules({ projects: { delete: false } }, { isPrivileged: true });
    expect(actionAllowed(r, 'projects', 'delete')).toBe(false);
    expect(actionAllowed(r, 'projects', 'edit')).toBe(true);
  });

  it('lets an explicit true override a lack of privilege', () => {
    const r = withModules({ projects: { view: true } });
    expect(actionAllowed(r, 'projects', 'view')).toBe(true);
    expect(actionAllowed(r, 'projects', 'edit')).toBe(false);
  });

  it('refuses everything for an inactive role', () => {
    const r = withModules({ projects: { view: true } }, { status: 'inactive', isPrivileged: true });
    expect(actionAllowed(r, 'projects', 'view')).toBe(false);
  });
});

describe('rightsNote — says which of the three states the reader is in', () => {
  it('does not claim "nothing granted" when the matrix is simply silent', () => {
    const note = rightsNote({ granted: [], denied: [], configured: false, privileged: false });
    expect(note).toContain('follows the module\'s own rules');
    expect(note).not.toMatch(/no actions are granted/i);
  });

  it('tells a privileged role that the fallback is in its favour', () => {
    expect(rightsNote({ granted: [], denied: [], configured: false, privileged: true })).toContain('privileged');
  });

  it('points at the list above when the matrix was configured', () => {
    expect(rightsNote({ granted: ['view'], denied: [], configured: true, privileged: false })).toContain('specific permissions');
  });
});

describe('buildSopDocument', () => {
  const mods = [
    mod({ key: 'projects', section: 'Sales', order: 1 }),
    mod({ key: 'quotation', label: 'Quotations', section: 'Sales', order: 2, href: '/quotation' }),
    mod({ key: 'audit-log', label: 'Audit Log', section: 'Administration', order: 4, href: '/admin/audit-log', visibleToRoles: ['admin'] })
  ];

  it('covers only the role\'s own modules, grouped by section in sidebar order', () => {
    const doc = buildSopDocument(role(), mods);
    expect(doc.sections.map((s) => s.name)).toEqual(['Sales']);
    expect(doc.sections[0].modules.map((m) => m.key)).toEqual(['projects', 'quotation']);
    expect(doc.moduleCount).toBe(2);
  });

  it('carries the app\'s own description through as the purpose', () => {
    const doc = buildSopDocument(role(), mods);
    expect(doc.sections[0].modules[0].purpose).toBe('Every sales project.');
    expect(doc.sections[0].modules[0].location).toBe('/projects');
  });

  it('states the data scope from viewAllDepartments, not from privilege', () => {
    expect(buildSopDocument(role(), mods).dataScope).toContain('Restricted');
    const wide = role({
      permissions: { modules: {}, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, viewAllDepartments: true }
    });
    expect(buildSopDocument(wide, mods).dataScope).toContain('Org-wide');
  });

  it('lists the global capabilities a role actually holds', () => {
    const admin = role({
      key: 'admin',
      label: 'Admin',
      permissions: { modules: {}, manageSettings: true, manageUsers: true, manageRoles: false, manageDepartments: false, viewAllDepartments: true }
    });
    const doc = buildSopDocument(admin, mods);
    expect(doc.capabilities).toContain('create and edit user accounts');
    expect(doc.capabilities).toContain('change application settings');
    expect(doc.capabilities).not.toContain('change what roles may do');
  });

  // The regression this whole three-state design exists to prevent: a module
  // the matrix never mentions must not produce a page claiming the reader
  // can do nothing in it.
  it('does not claim a silent matrix means no access', () => {
    const page = buildSopDocument(role(), mods).sections[0].modules[0];
    expect(page.can).toEqual([]);
    expect(page.cannot).toEqual([]);
    expect(page.rightsNote).toContain('own rules');
    expect(page.rightsNote).not.toMatch(/no actions are granted/i);
  });

  // A real case in this workspace: Module Manager shows Engineers the
  // Travel Schedule tile while Role Management refuses them 'view' on it.
  // Neither screen can see the other, so nothing else reports it.
  it('flags a module the role can see but is explicitly refused view on', () => {
    const contradictory = withModules({ projects: { view: false } });
    const doc = buildSopDocument(contradictory, mods);
    const page = doc.sections[0].modules[0];
    expect(page.viewDenied).toBe(true);
    expect(doc.contradictions).toEqual(['Project Dashboard']);
  });

  it('does not flag a module that is merely unmentioned', () => {
    const doc = buildSopDocument(role(), mods);
    expect(doc.sections[0].modules[0].viewDenied).toBe(false);
    expect(doc.contradictions).toEqual([]);
  });

  it('prints explicit grants and refusals when the matrix has them', () => {
    const configured = withModules({ projects: { view: true, create: true, delete: false } });
    const page = buildSopDocument(configured, mods).sections[0].modules[0];
    expect(page.can).toEqual(['open and read records', 'create new records']);
    expect(page.cannot).toEqual(['delete records']);
  });

  // An unwritten module still gets a complete page; it is flagged rather
  // than filled with an invented procedure.
  it('flags a module with no written procedure instead of inventing one', () => {
    const doc = buildSopDocument(role(), [mod({ key: 'not-written-yet', section: 'Sales' })]);
    const page = doc.sections[0].modules[0];
    expect(page.procedurePending).toBe(true);
    expect(page.steps).toEqual([]);
    expect(doc.pendingCount).toBe(1);
  });

  it('uses the written procedure where there is one', () => {
    const doc = buildSopDocument(role(), mods);
    const projects = doc.sections[0].modules[0];
    expect(projects.procedurePending).toBe(false);
    expect(projects.steps).toEqual(MODULE_SOP.projects.steps);
    expect(projects.rules.length).toBeGreaterThan(0);
  });
});

// The document-control half: the things that make this a controlled
// procedure rather than a help page. They are worth pinning because a reader
// cites them ("clause 8.2.3") and an auditor checks them.
describe('the controlled-document frame', () => {
  const mods = [
    mod({ key: 'projects', section: 'Sales', order: 1 }),
    mod({ key: 'quotation', label: 'Quotations', section: 'Sales', order: 2, href: '/quotation' }),
    mod({ key: 'daily-report', label: 'Daily Report', section: 'Workspace', order: 3, href: '/daily-report' })
  ];

  it('numbers every module as a sub-clause of the procedure clause', () => {
    const doc = buildSopDocument(role(), mods);
    expect(doc.sections.map((s) => s.clause)).toEqual(['8.1', '8.2']);
    expect(doc.sections[0].modules.map((m) => m.clause)).toEqual(['8.1.1', '8.1.2']);
    expect(doc.sections[1].modules.map((m) => m.clause)).toEqual(['8.2.1']);
  });

  // The number must survive a rename of the role, because it is printed on
  // every page and quoted in mail. So it comes from the key, not the label.
  it('builds the document number from the role key, not its label', () => {
    expect(sopDocumentNumber({ key: 'engineer' }, 'NT')).toBe('NT/MIQ/SOP/ENG');
    expect(sopDocumentNumber({ key: 'technical-manager' }, 'NT')).toBe('NT/MIQ/SOP/TM');
    expect(sopDocumentNumber({ key: 'hr' }, 'NT')).toBe('NT/MIQ/SOP/HR');
    expect(buildSopDocument(role(), mods).control.documentNumber).toBe('NT/MIQ/SOP/ENG');
  });

  it('carries the issue details into the control block', () => {
    const doc = buildSopDocument(role(), mods, {
      revision: '03',
      effectiveDate: '04 Nov 2026',
      nextReviewDate: '04 Nov 2027',
      prefix: 'NT'
    });
    expect(doc.control.revision).toBe('03');
    expect(doc.control.effectiveDate).toBe('04 Nov 2026');
    expect(doc.control.nextReviewDate).toBe('04 Nov 2027');
    expect(doc.control.documentTitle).toBe('Standard Operating Procedure — Engineer');
  });

  // A first issue has nothing to supersede, and saying "supersedes rev 00"
  // would invent a document nobody has.
  it('declares an initial issue as superseding nothing', () => {
    const doc = buildSopDocument(role(), mods);
    expect(doc.control.supersedes).toBe('Nil — initial issue');
    expect(doc.revisionHistory).toHaveLength(1);
    expect(doc.revisionHistory[0].summary).toContain('Initial issue');
  });

  it('appends the current revision to the history it was given', () => {
    const doc = buildSopDocument(role(), mods, {
      revision: '02',
      effectiveDate: '04 Nov 2026',
      history: [{ revision: '01', date: '01 Oct 2026', summary: 'Initial issue.', issuedBy: 'Document Control' }]
    });
    expect(doc.revisionHistory.map((r) => r.revision)).toEqual(['01', '02']);
    expect(doc.control.supersedes).toBe('Revision 01 dated 01 Oct 2026');
    expect(doc.revisionHistory[1].summary).toContain('Reissued');
  });

  // The generator fingerprints the document to decide whether a revision is
  // due. That only works if two builds of the same inputs are identical, so
  // nothing inside may read the clock.
  it('builds identically twice, so the generator can fingerprint it', () => {
    const first = buildSopDocument(role(), mods, { revision: '01', effectiveDate: '04 Nov 2026' });
    const second = buildSopDocument(role(), mods, { revision: '01', effectiveDate: '04 Nov 2026' });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('states the privilege fallback in the access clause, in both directions', () => {
    const standard = buildSopDocument(role(), mods).accessRows.find((row) => row.attribute === 'Privilege level');
    expect(standard?.provision).toContain('refused');
    const privileged = buildSopDocument(role({ isPrivileged: true }), mods).accessRows.find((row) => row.attribute === 'Privilege level');
    expect(privileged?.provision).toContain('allowed');
  });

  // Clause 5 is what a manager reads to know who signs off. A role that can
  // rewrite the permission matrix has to appear there as holding that
  // authority, not only in clause 6.
  it('names an administrative authority in the responsibility table', () => {
    const admin = role({
      key: 'admin',
      label: 'Admin',
      permissions: { modules: {}, manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: false, viewAllDepartments: true }
    });
    const parties = buildSopDocument(admin, mods).responsibilities.map((row) => row.party);
    expect(parties).toContain('Admin (administrative authority)');
    const row = buildSopDocument(admin, mods).responsibilities.find((r) => r.party === 'Admin (administrative authority)');
    expect(row?.responsibility).toContain('role permission matrix (R1)');

    expect(buildSopDocument(role(), mods).responsibilities.map((r) => r.party)).not.toContain('Engineer (administrative authority)');
  });

  it('counts the scope clause from the modules actually covered', () => {
    const doc = buildSopDocument(role(), mods);
    expect(doc.scope.inScope[0]).toContain('3 modules');
    expect(doc.scope.body[0]).toContain('role key: engineer');
  });
});

// A partner account has no department, no department manager and files no
// Daily Report. A procedure that requires those of them states a requirement
// that cannot be met, which is the one defect that discredits a whole
// document — so the shared clauses are filtered by the kind of account.
describe('clauses that do not apply to a partner', () => {
  const mods = [mod({ key: 'partner-dashboard', label: 'Dashboard', section: 'Partner Portal', href: '/partner' })];
  const partner = role({ key: 'partner-admin', label: 'Partner Admin' });

  it('leaves the daily-reporting requirement out of a partner procedure', () => {
    const titles = buildSopDocument(partner, mods).generalRequirements.map((block) => block.title);
    expect(titles).not.toContain('Daily reporting');
    expect(titles).not.toContain('Role and departmental scope');
    expect(titles).toContain('Scope of a partner account');
  });

  it('keeps it for an internal role, and leaves the partner clause out', () => {
    const titles = buildSopDocument(role(), mods).generalRequirements.map((block) => block.title);
    expect(titles).toContain('Daily reporting');
    expect(titles).toContain('Role and departmental scope');
    expect(titles).not.toContain('Scope of a partner account');
  });

  // The numbering is cited in mail and in meetings, so it may not skip
  // because a clause was dropped for this kind of account.
  it('renumbers consecutively after filtering, in both directions', () => {
    for (const subject of [partner, role()]) {
      const doc = buildSopDocument(subject, mods);
      for (const clauses of [doc.generalRequirements, doc.nonConformance]) {
        expect(clauses.map((block) => block.index)).toEqual(clauses.map((_, i) => String(i + 1)));
      }
    }
  });

  it('does not name a department manager or HR in a partner responsibility table', () => {
    const parties = buildSopDocument(partner, mods).responsibilities.map((row) => row.party);
    expect(parties).not.toContain('Department manager');
    expect(parties).not.toContain('Human Resources');
    expect(parties).toContain('Relationship manager');
    expect(parties).toContain('Partner Admin (account holder)');
  });

  it('does not list the Daily Report as a record of a partner\'s work', () => {
    const partnerRecords = buildSopDocument(partner, mods).records.map((row) => row.record);
    expect(partnerRecords.some((record) => record.includes('Daily Report'))).toBe(false);
    const internalRecords = buildSopDocument(role(), mods).records.map((row) => row.record);
    expect(internalRecords.some((record) => record.includes('Daily Report'))).toBe(true);
  });

  it('states the tenant boundary rather than a departmental one', () => {
    const doc = buildSopDocument(partner, mods);
    expect(doc.dataScope).toContain('partner organisation');
    expect(doc.dataScope).not.toContain('Department Master');
    expect(doc.accessRows.map((row) => row.attribute)).toContain('Tenant boundary');
    expect(doc.scope.body[0]).toContain('external partner account');

    expect(buildSopDocument(role(), mods).accessRows.map((row) => row.attribute)).not.toContain('Tenant boundary');
  });
});

describe('sopFileName', () => {
  it('names the file after the role as a person reads it', () => {
    expect(sopFileName({ key: 'technical-manager', label: 'Technical Manager' })).toBe('MatrixIQ SoP - Technical Manager.pdf');
  });

  // An admin can call a role anything, and the result becomes a filename.
  it('strips characters that have no business in a filename', () => {
    expect(sopFileName({ key: 'x', label: 'Sales / Pre-Sales (North)' })).toBe('MatrixIQ SoP - Sales Pre-Sales North.pdf');
  });

  it('falls back to the key when the label sanitises to nothing', () => {
    expect(sopFileName({ key: 'odd-role', label: '???' })).toBe('MatrixIQ SoP - odd-role.pdf');
  });
});
