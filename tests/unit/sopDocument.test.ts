import { describe, it, expect } from 'vitest';
import { actionAllowed, buildSopDocument, moduleRights, modulesForRole, rightsNote, sopFileName, SopModuleInput } from '../../lib/sopDocument';
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
    expect(buildSopDocument(role(), mods).dataScope).toContain('Your own records');
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
    expect(page.can).toEqual(['open and read it', 'add new records']);
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
