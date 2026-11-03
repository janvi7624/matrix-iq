import { ModulePermissionAction, RoleRecord } from './types';
import { ACTION_WORDS, MODULE_SOP, SOP_PREAMBLE } from './sopContent';

// Assembling one role's SoP.
//
// Pure — no database, no PDF, no React. It takes the live module registry and
// the live role record and returns a document structure; lib/sopPdf.ts turns
// that into pages and the generator script feeds it. Split that way because
// the interesting decisions are all here (which modules a role sees, what the
// permission matrix actually grants, how an absent entry is phrased) and all
// of them are worth testing without a renderer or a connection in the way.

/** The ten actions, in the order a reader thinks about them. */
const ACTION_ORDER: ModulePermissionAction[] = [
  'view',
  'create',
  'edit',
  'approve',
  'reject',
  'assign',
  'export',
  'print',
  'delete',
  'manage'
];

export interface SopModuleInput {
  key: string;
  label: string;
  desc: string;
  href: string;
  section: string;
  order: number;
  enabled: boolean;
  visibleToRoles?: string[];
  visibleToDepartments?: string[];
}

export interface SopModulePage {
  key: string;
  label: string;
  /** What it is for — the app's own description of itself. */
  purpose: string;
  /** Where it lives. */
  location: string;
  /** Explicitly granted here, as readable phrases. */
  can: string[];
  /** Explicitly refused here, as readable phrases. */
  cannot: string[];
  /**
   * The sentence to print about permissions — which depends on whether the
   * matrix mentions this module at all. See moduleRights.
   */
  rightsNote: string;
  /**
   * The tile is shown to this role in Module Manager, but Role Management
   * explicitly refuses it `view`.
   *
   * A real contradiction between two screens that do not talk to each other,
   * and one that exists in this workspace right now. Surfaced rather than
   * smoothed over: printing a cheerful procedure for a module somebody
   * cannot open is how a document loses its reader.
   */
  viewDenied: boolean;
  steps: string[];
  rules: string[];
  /** True when nobody has written a procedure for this module yet. */
  procedurePending: boolean;
  /** Departments the tile is restricted to, if any. */
  departments: string[];
}

export interface SopSection {
  name: string;
  modules: SopModulePage[];
}

export interface SopDocument {
  roleKey: string;
  roleLabel: string;
  roleDescription: string;
  /** Org-wide data, or only your own records plus departments you manage. */
  dataScope: string;
  /** The global capabilities this role holds, in words. */
  capabilities: string[];
  preamble: typeof SOP_PREAMBLE;
  sections: SopSection[];
  moduleCount: number;
  /** How many module pages have no written procedure yet. */
  pendingCount: number;
  /**
   * Modules this role sees on the dashboard but is explicitly denied view
   * on. Collected so the generator can report them: each one is a
   * disagreement between Module Manager and Role Management that somebody
   * should settle.
   */
  contradictions: string[];
}

/**
 * Which modules a role sees.
 *
 * An empty or absent visibleToRoles means every role — that is how the
 * registry expresses "not restricted", and reading it as "nobody" would
 * produce an empty SoP for every role.
 */
export function modulesForRole(modules: SopModuleInput[], roleKey: string): SopModuleInput[] {
  return modules
    .filter((module) => module.enabled)
    .filter((module) => !module.visibleToRoles?.length || module.visibleToRoles.includes(roleKey));
}

export interface ModuleRights {
  /** Actions the role's matrix explicitly allows here. */
  granted: ModulePermissionAction[];
  /** Actions the role's matrix explicitly refuses here. */
  denied: ModulePermissionAction[];
  /** Whether the matrix says anything at all about this module. */
  configured: boolean;
  /** The fallback that applies to everything the matrix does not mention. */
  privileged: boolean;
}

/**
 * What a role's permission matrix actually says about one module.
 *
 * The distinction between "explicitly denied" and "not mentioned" is the
 * whole point, and collapsing it is how an SoP ends up lying to people.
 *
 * isModuleActionAllowed resolves an unmentioned action to `isPrivileged`,
 * which for most roles is false — but the matrix is SPARSE. Of 60 modules,
 * a typical role has entries for fewer than ten, and most modules never
 * consult the matrix at all: they gate on module visibility and their own
 * rules. So flattening "not mentioned" into "not allowed" would print "no
 * actions are granted to your role" on nearly every page of nearly every
 * document — about modules those people use all day. A reader who finds one
 * sentence obviously false stops believing the rest.
 *
 * So this reports the three states separately and lets the renderer say
 * which is which.
 */
export function moduleRights(role: RoleRecord, moduleKey: string): ModuleRights {
  const entry = role.status === 'active' ? role.permissions?.modules?.[moduleKey] : undefined;
  return {
    granted: ACTION_ORDER.filter((action) => entry?.[action] === true),
    denied: ACTION_ORDER.filter((action) => entry?.[action] === false),
    configured: !!entry && ACTION_ORDER.some((action) => typeof entry[action] === 'boolean'),
    privileged: role.status === 'active' && role.isPrivileged
  };
}

/**
 * What the app answers for one action — the exact resolution
 * isModuleActionAllowed performs, for the places that need a yes or no.
 */
export function actionAllowed(role: RoleRecord, moduleKey: string, action: ModulePermissionAction): boolean {
  const entry = role.status === 'active' ? role.permissions?.modules?.[moduleKey] : undefined;
  const explicit = entry?.[action];
  return typeof explicit === 'boolean' ? explicit : role.status === 'active' && role.isPrivileged;
}

function phrase(actions: ModulePermissionAction[]): string[] {
  return actions.map((action) => ACTION_WORDS[action] ?? action);
}

/**
 * The permissions sentence for one module page.
 *
 * Three genuinely different situations, and the reader needs to be able to
 * tell which one they are in — above all, "this was decided about you" versus
 * "nobody has decided anything about you here".
 */
export function rightsNote(rights: ModuleRights): string {
  if (rights.configured) {
    return 'Your role has specific permissions set for this module, listed above. Anything not listed falls back to your role\'s general level of access.';
  }
  if (rights.privileged) {
    return 'No per-module permissions are set for your role here. Your role is a privileged one, so where a screen checks the permission matrix the action is allowed.';
  }
  return 'No per-module permissions are set for your role here, so what you can do follows the module\'s own rules rather than the permission matrix. Where a screen does check the matrix, it will refuse until the action is granted in Role Management.';
}

export function buildSopDocument(role: RoleRecord, modules: SopModuleInput[]): SopDocument {
  const mine = modulesForRole(modules, role.key);

  // Section order follows the sidebar, which is the order the reader's own
  // screen is in — an alphabetical SoP would describe a different app than
  // the one in front of them.
  const sectionOrder: string[] = [];
  const bySection = new Map<string, SopModulePage[]>();

  for (const module of [...mine].sort((a, b) => a.order - b.order)) {
    const written = MODULE_SOP[module.key];
    const rights = moduleRights(role, module.key);

    const page: SopModulePage = {
      key: module.key,
      label: module.label,
      purpose: module.desc,
      location: module.href,
      can: phrase(rights.granted),
      cannot: phrase(rights.denied),
      rightsNote: rightsNote(rights),
      viewDenied: rights.denied.includes('view'),
      steps: written?.steps ?? [],
      rules: written?.rules ?? [],
      procedurePending: !written,
      departments: module.visibleToDepartments ?? []
    };

    if (!bySection.has(module.section)) {
      bySection.set(module.section, []);
      sectionOrder.push(module.section);
    }
    bySection.get(module.section)!.push(page);
  }

  const capabilities: string[] = [];
  if (role.permissions?.manageUsers) capabilities.push('create and edit user accounts');
  if (role.permissions?.manageRoles) capabilities.push('change what roles may do');
  if (role.permissions?.manageDepartments) capabilities.push('edit departments and their managers');
  if (role.permissions?.manageSettings) capabilities.push('change application settings');

  return {
    roleKey: role.key,
    roleLabel: role.label,
    roleDescription: role.description,
    dataScope: role.permissions?.viewAllDepartments
      ? 'Org-wide. You see every department\'s records in the modules that are department-scoped.'
      : 'Your own records, plus the records of any department you are named as manager of in Department Master. Not every department\'s data.',
    capabilities,
    preamble: SOP_PREAMBLE,
    sections: sectionOrder.map((name) => ({ name, modules: bySection.get(name)! })),
    moduleCount: mine.length,
    pendingCount: mine.filter((module) => !MODULE_SOP[module.key]).length,
    contradictions: mine
      .filter((module) => moduleRights(role, module.key).denied.includes('view'))
      .map((module) => module.label)
  };
}

/**
 * The document's file name — also the Material's title.
 *
 * The role LABEL rather than its key, because this is read by people, and
 * the key ("partner-admin") is an implementation detail. Sanitised because it
 * becomes a filename and an admin can call a role anything.
 */
export function sopFileName(role: { key: string; label: string }): string {
  const safe = (role.label || role.key).replace(/[^A-Za-z0-9 &-]+/g, '').replace(/\s+/g, ' ').trim();
  return `MatrixIQ SoP - ${safe || role.key}.pdf`;
}
