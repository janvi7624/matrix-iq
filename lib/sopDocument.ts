import { isPartnerRoleKey } from './partnerRoles';
import { ModulePermissionAction, RoleRecord } from './types';
import {
  ACTION_WORDS,
  MODULE_SOP,
  SOP_DEFINITIONS,
  SOP_ESCALATION,
  SOP_GENERAL_REQUIREMENTS,
  SOP_RECORDS,
  SOP_REFERENCES,
  SopClauseBlock
} from './sopContent';

// Assembling one role's SoP as a controlled document.
//
// Pure — no database, no PDF, no React. It takes the live module registry and
// the live role record and returns a clause-numbered document; lib/sopPdf.ts
// turns that into pages and the generator script feeds it. Split that way
// because the interesting decisions are all here (which modules a role sees,
// what the permission matrix actually grants, how an absent entry is phrased)
// and all of them are worth testing without a renderer or a connection in the
// way.
//
// The clause structure is the conventional one for a procedure document —
// purpose, scope, references, definitions, responsibility, then the procedure
// itself, then records, non-conformance and revision history. It is numbered
// so that one clause can be cited in a mail or a meeting ("clause 7.4") and so
// that the document reads as the controlled instrument it is rather than as a
// help page.

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

/** Clause numbers, fixed so that they can be cited. */
export const CLAUSE = {
  purpose: '1.0',
  scope: '2.0',
  references: '3.0',
  definitions: '4.0',
  responsibility: '5.0',
  access: '6.0',
  general: '7.0',
  procedure: '8.0',
  records: '9.0',
  nonConformance: '10.0',
  revision: '11.0'
} as const;

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
  /** Its clause number within clause 8, e.g. "8.2.3". */
  clause: string;
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
   * smoothed over: printing a procedure for a module somebody cannot open is
   * how a document loses its reader.
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
  /** Its clause number within clause 8, e.g. "8.2". */
  clause: string;
  modules: SopModulePage[];
}

export interface SopRevision {
  revision: string;
  date: string;
  summary: string;
  issuedBy: string;
}

/**
 * What the issuing run knows and the document itself cannot: the revision
 * number, the dates, and who issued it.
 *
 * Kept out of the builder's own logic so that this stays a pure function —
 * a document built twice from the same inputs is byte-identical, which is
 * what makes the generator's idempotency testable.
 */
export interface SopIssue {
  /** Revision as printed, e.g. '01'. */
  revision: string;
  effectiveDate: string;
  nextReviewDate: string;
  /** Printed as the issuing authority in the control block. */
  issuedBy: string;
  /** Document-number prefix — the organisation's initials. */
  prefix: string;
  /**
   * Overrides the derived document number.
   *
   * Two role labels can abbreviate to the same letters, and two controlled
   * documents may not share a number. The generator resolves a collision by
   * passing an explicit number rather than letting the ambiguity through.
   */
  documentNumber?: string;
  classification: string;
  /** Prior issues, oldest first. Drives the revision history table. */
  history: SopRevision[];
}

export const DEFAULT_ISSUE: SopIssue = {
  revision: '01',
  effectiveDate: '',
  nextReviewDate: '',
  issuedBy: 'MatrixIQ Document Control',
  prefix: 'NT',
  classification: 'Internal — Confidential',
  history: []
};

export interface SopDocumentControl {
  documentNumber: string;
  documentTitle: string;
  revision: string;
  effectiveDate: string;
  nextReviewDate: string;
  classification: string;
  issuedBy: string;
  /** The role this procedure governs, named as the functional owner. */
  functionalOwner: string;
  /** What this revision replaces. */
  supersedes: string;
}

export interface SopDocument {
  roleKey: string;
  roleLabel: string;
  roleDescription: string;
  control: SopDocumentControl;

  /** 1.0 */
  purpose: string[];
  /** 2.0 */
  scope: { body: string[]; inScope: string[]; outOfScope: string[] };
  /** 3.0 */
  references: typeof SOP_REFERENCES;
  /** 4.0 */
  definitions: typeof SOP_DEFINITIONS;
  /** 5.0 */
  responsibilities: { party: string; responsibility: string }[];
  /** 6.0 — the attribute/provision table. */
  accessRows: { attribute: string; provision: string }[];
  /** 7.0 */
  generalRequirements: SopClauseBlock[];
  /** 8.0 */
  sections: SopSection[];
  /** 9.0 */
  records: typeof SOP_RECORDS;
  /** 10.0 */
  nonConformance: SopClauseBlock[];
  /** 11.0 */
  revisionHistory: SopRevision[];

  /** Org-wide data, or only the user's own records plus departments managed. */
  dataScope: string;
  /** The global capabilities this role holds, in words. */
  capabilities: string[];
  moduleCount: number;
  /** How many module clauses have no written procedure yet. */
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
 * rules. So flattening "not mentioned" into "not allowed" would state that no
 * action is permitted on nearly every page of nearly every document — about
 * modules those people use all day. A reader who finds one sentence obviously
 * false stops believing the rest.
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
 * The permissions sentence for one module clause.
 *
 * Three genuinely different situations, and the reader needs to be able to
 * tell which one they are in — above all, "this was decided about you" versus
 * "nobody has decided anything about you here".
 */
export function rightsNote(rights: ModuleRights): string {
  // Kept to one line each. The full resolution rule is stated once in clause
  // 6 and cited here, because the alternative — three lines of identical
  // explanation under all 52 of an Admin's modules — is what turns a
  // procedure into something nobody reads to the end.
  if (rights.configured) {
    return `The permission matrix (R1) records specific permissions for this module, as listed above. Anything not listed falls back to clause ${CLAUSE.access}.`;
  }
  if (rights.privileged) {
    return `No entry in the permission matrix (R1). The role is privileged, so a function that consults the matrix allows the action; see clause ${CLAUSE.access}.`;
  }
  return `No entry in the permission matrix (R1), so what the user may do follows the module's own rules; see clause ${CLAUSE.access}.`;
}

/**
 * The document number, e.g. NT/MIQ/SOP/ENG.
 *
 * Abbreviated from the role's LABEL rather than its key, which is the less
 * obvious of the two choices. The key would be the stable identifier — but
 * the Sales role's key in this workspace is `user`, so keying the number off
 * it prints NT/MIQ/SOP/USE at the top of every page of the Sales procedure.
 * A document number nobody recognises is worse than one that changes if the
 * role is ever renamed, and a rename is a reissue anyway.
 *
 * Multi-word labels give initials (Back Office is BO); a single word gives
 * its first three letters (Engineer is ENG).
 */
export function sopDocumentNumber(role: { key: string; label?: string }, prefix: string): string {
  const source = (role.label || role.key).replace(/[^A-Za-z0-9 ]+/g, ' ');
  const parts = source.split(/\s+/).filter(Boolean);
  const abbreviation =
    parts.length > 1 ? parts.map((part) => part[0]).join('').toUpperCase() : (parts[0] ?? role.key).slice(0, 3).toUpperCase();
  return `${prefix}/MIQ/SOP/${abbreviation || 'GEN'}`;
}

function buildPurpose(role: RoleRecord): string[] {
  return [
    `This Standard Operating Procedure defines the authorised method of working within MatrixIQ for personnel holding the ${role.label} role.`,
    'It is issued so that work performed in each module is carried out consistently, remains traceable to the individual who performed it, and stays within the access configured for the role.',
    `The access stated in clauses ${CLAUSE.access} and ${CLAUSE.procedure} is extracted from the live MatrixIQ configuration at the time of issue. It states the system as configured rather than as intended; where the two differ, clause ${CLAUSE.nonConformance} applies.`
  ];
}

function buildScope(role: RoleRecord, moduleCount: number, sectionCount: number): SopDocument['scope'] {
  const partner = isPartnerRoleKey(role.key);
  return {
    body: [
      partner
        ? `This procedure applies to every external partner account holding the ${role.label} role (role key: ${role.key}), in every partner organisation registered in MatrixIQ.`
        : `This procedure applies to every user account holding the ${role.label} role (role key: ${role.key}), in every department to which that role is assigned.`
    ],
    inScope: [
      `The ${moduleCount} modules available to this role, listed in clause ${CLAUSE.procedure} under ${sectionCount} functional ${
        sectionCount === 1 ? 'heading' : 'headings'
      }.`,
      `Records within the data visibility stated in clause ${CLAUSE.access}.`,
      `The general requirements of clause ${CLAUSE.general}, which apply to every role without exception.`
    ],
    outOfScope: [
      `Modules not listed in clause ${CLAUSE.procedure}. They are not available to this role, and this document does not describe them.`,
      'Configuration of roles, modules, departments and application settings, which is governed by the system administrator and not by this procedure.',
      'Work carried out outside MatrixIQ, including correspondence and documents held on personal drives.'
    ]
  };
}

function buildResponsibilities(role: RoleRecord): { party: string; responsibility: string }[] {
  // A partner has no department, no department manager and no daily report,
  // so those three rows would name parties that do not exist for them.
  const partner = isPartnerRoleKey(role.key);

  const rows: { party: string; responsibility: string }[] = partner
    ? [
        {
          party: `${role.label} (account holder)`,
          responsibility: `Performs the procedures of clause ${CLAUSE.procedure} within the access stated in clause ${CLAUSE.access}; observes clause ${CLAUSE.general}; reports defects under clause ${CLAUSE.nonConformance}.`
        },
        {
          party: 'Relationship manager',
          responsibility:
            'The point of contact for this account. Receives questions and escalations raised through Technical Support, and authorises any departure from this procedure.'
        }
      ]
    : [
        {
          party: `${role.label} (role holder)`,
          responsibility: `Performs the procedures of clause ${CLAUSE.procedure} within the access stated in clause ${CLAUSE.access}; observes clause ${CLAUSE.general}; files the Daily Report under clause ${CLAUSE.general.replace('.0', '')}.4; reports defects under clause ${CLAUSE.nonConformance}.`
        },
        {
          party: 'Department manager',
          responsibility:
            'Approves what this procedure routes for approval; records leave; receives escalations. Named in Department Master (R3) as an individual, not as a role.'
        },
        {
          party: 'Human Resources',
          responsibility: 'Receives the automatic escalation raised when four or more daily-report warnings are active against a user.'
        }
      ];

  rows.push(
    {
      party: 'System administrator',
      responsibility:
        'Maintains the role permission matrix (R1) and the module register (R2), and is the sole authority for granting or withdrawing access.'
    },
    {
      party: 'Document control',
      responsibility:
        'Reissues this document after any change to R1 or R2. This document is generated from the live configuration and shall not be amended by hand.'
    }
  );

  // Said in the responsibility table rather than only in the access clause,
  // because a role that can change the matrix is accountable for it.
  const held: string[] = [];
  if (role.permissions?.manageUsers) held.push('user accounts (R6)');
  if (role.permissions?.manageRoles) held.push('the role permission matrix (R1)');
  if (role.permissions?.manageDepartments) held.push('departments and their named managers (R3)');
  if (role.permissions?.manageSettings) held.push('application settings (R4)');
  if (held.length) {
    rows.splice(1, 0, {
      party: `${role.label} (administrative authority)`,
      responsibility: `Additionally maintains ${held.join(', ')}. Changes made under this authority are recorded in the Audit Log (R5) against the account that made them.`
    });
  }

  return rows;
}

export function buildSopDocument(role: RoleRecord, modules: SopModuleInput[], issue: Partial<SopIssue> = {}): SopDocument {
  const settings: SopIssue = { ...DEFAULT_ISSUE, ...issue };
  const mine = modulesForRole(modules, role.key);

  // Section order follows the sidebar, which is the order the reader's own
  // screen is in — an alphabetical procedure would describe a different app
  // than the one in front of them.
  const sectionOrder: string[] = [];
  const bySection = new Map<string, SopModulePage[]>();

  for (const module of [...mine].sort((a, b) => a.order - b.order)) {
    const written = MODULE_SOP[module.key];
    const rights = moduleRights(role, module.key);

    if (!bySection.has(module.section)) {
      bySection.set(module.section, []);
      sectionOrder.push(module.section);
    }
    const siblings = bySection.get(module.section)!;
    const clause = `${CLAUSE.procedure.replace('.0', '')}.${sectionOrder.indexOf(module.section) + 1}.${siblings.length + 1}`;

    siblings.push({
      key: module.key,
      clause,
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
    });
  }

  const sections: SopSection[] = sectionOrder.map((name, index) => ({
    name,
    clause: `${CLAUSE.procedure.replace('.0', '')}.${index + 1}`,
    modules: bySection.get(name)!
  }));

  const capabilities: string[] = [];
  if (role.permissions?.manageUsers) capabilities.push('create and edit user accounts');
  if (role.permissions?.manageRoles) capabilities.push('change what roles may do');
  if (role.permissions?.manageDepartments) capabilities.push('edit departments and their managers');
  if (role.permissions?.manageSettings) capabilities.push('change application settings');

  const partner = isPartnerRoleKey(role.key);
  const dataScope = partner
    ? "Restricted to the partner organisation. The account sees only its own organisation's records, together with the material and quotations published to it. No other partner's records are visible, and no internal record is."
    : role.permissions?.viewAllDepartments
      ? 'Org-wide. Records of every department are visible in the modules that are department-scoped.'
      : "Restricted. The user's own records, together with the records of any department for which the user is named as manager in Department Master (R3). Not every department's data.";

  // Numbered after filtering, so 7.1, 7.2, 7.3 are consecutive whatever was
  // dropped for this kind of account.
  const applicable = (blocks: SopClauseBlock[]): SopClauseBlock[] =>
    blocks
      .filter((block) => !block.appliesTo || block.appliesTo === (partner ? 'partner' : 'internal'))
      .map((block, index) => ({ ...block, index: String(index + 1) }));

  const previous = settings.history[settings.history.length - 1];
  const currentRevision: SopRevision = {
    revision: settings.revision,
    date: settings.effectiveDate,
    summary: previous
      ? `Reissued from the live MatrixIQ configuration. ${mine.length} modules in clause ${CLAUSE.procedure}.`
      : `Initial issue, generated from the live MatrixIQ configuration. ${mine.length} modules in clause ${CLAUSE.procedure}.`,
    issuedBy: settings.issuedBy
  };

  return {
    roleKey: role.key,
    roleLabel: role.label,
    roleDescription: role.description,
    control: {
      documentNumber: settings.documentNumber || sopDocumentNumber(role, settings.prefix),
      documentTitle: `Standard Operating Procedure — ${role.label}`,
      revision: settings.revision,
      effectiveDate: settings.effectiveDate,
      nextReviewDate: settings.nextReviewDate,
      classification: settings.classification,
      issuedBy: settings.issuedBy,
      functionalOwner: `${role.label} — ${role.isSystem ? 'system role' : 'custom role'}`,
      supersedes: previous ? `Revision ${previous.revision}${previous.date ? ` dated ${previous.date}` : ''}` : 'Nil — initial issue'
    },

    purpose: buildPurpose(role),
    scope: buildScope(role, mine.length, sections.length),
    references: SOP_REFERENCES,
    definitions: SOP_DEFINITIONS,
    responsibilities: buildResponsibilities(role),
    accessRows: [
      { attribute: 'Role', provision: `${role.label} (key: ${role.key})` },
      {
        attribute: 'Privilege level',
        provision: role.isPrivileged
          ? 'Privileged. Where the permission matrix is silent on an action, the action is allowed.'
          : 'Standard. Where the permission matrix is silent on an action, the action is refused by any function that consults the matrix.'
      },
      { attribute: 'Data visibility', provision: dataScope },
      ...(partner
        ? [
            {
              attribute: 'Tenant boundary',
              provision:
                "Enforced on the account itself, not on the role. Every partner screen is filtered to the partner organisation the account belongs to; a role key alone grants nothing."
            }
          ]
        : []),
      {
        attribute: 'Modules available',
        provision: `${mine.length} across ${sections.length} ${sections.length === 1 ? 'section' : 'sections'}, listed in clause ${CLAUSE.procedure}.`
      },
      {
        attribute: 'Administrative authority',
        provision: capabilities.length
          ? `The role may ${capabilities.join(', ')}.`
          : `None. The role holds no authority beyond the modules listed in clause ${CLAUSE.procedure}.`
      },
      {
        attribute: 'Resolution of permissions',
        provision:
          'An action is permitted where the permission matrix (R1) records it as permitted. Where the matrix holds no entry for a module, the privilege level stated above applies to any function that consults the matrix, and the module\'s own rules apply to everything else. An explicit refusal overrides privilege. This rule governs every sub-clause of clause ' +
          CLAUSE.procedure +
          ' and is not repeated there.'
      },
      {
        attribute: 'Review of access',
        provision: `Access is verified at each reissue of this document. A change to R1 or R2 renders this revision void; see clause ${CLAUSE.revision}.`
      }
    ],
    generalRequirements: applicable(SOP_GENERAL_REQUIREMENTS),
    sections,
    records: SOP_RECORDS.filter((record) => !record.appliesTo || record.appliesTo === (partner ? 'partner' : 'internal')),
    nonConformance: applicable(SOP_ESCALATION),
    revisionHistory: [...settings.history, currentRevision],

    dataScope,
    capabilities,
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
