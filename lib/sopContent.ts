// The written half of the MatrixIQ SoPs.
//
// A role's SoP is assembled from two sources, and the split is the whole
// design:
//
//   DERIVED, from the app itself — which modules a role sees, what each one
//   is for, where it lives, and which of the ten actions that role may take
//   in it. All of that is live data (lib/moduleConfigStore.ts and each
//   role's permissions.modules), so it cannot drift out of date and nobody
//   has to remember to update a document when Role Management changes.
//
//   WRITTEN, here — the order you do things in, and the rules that bite. No
//   amount of registry data can say "the client's details are copied from
//   their most recent project, and it still creates a new project", and that
//   sentence is the entire reason somebody opens an SoP.
//
// So this file holds only what cannot be derived. A module with no entry
// still gets a complete, accurate page from the derived half; it simply has
// no procedure written for it yet, and the page says so rather than
// inventing one. That is deliberate: a confidently wrong step is worse than
// an admitted gap, because somebody will follow it.

export interface ModuleSop {
  /** What you do, in order. Imperative, one action per line. */
  steps: string[];
  /**
   * The things that go wrong quietly — a rule whose violation produces no
   * error, just a result nobody notices is wrong. This is the section worth
   * reading twice.
   */
  rules?: string[];
}

export const MODULE_SOP: Record<string, ModuleSop> = {
  // ---------------------------------------------------------------- Workspace
  'daily-report': {
    steps: [
      'Open Daily Report. It opens on the current date; the arrows and the date strip move between the user\'s working days.',
      'Complete the form assigned to the user\'s department. The form differs by department: a row per activity for most, a single narrative for AV, and a numeric grid for Sales and GEM Sales.',
      'Save as draft as often as required. Nothing is reported until the report is submitted.',
      'Submit before the deadline, 11:30 IST by default. The department manager is notified by email that the report was filed.',
      'A submitted report is locked. To amend it, raise an edit request from the same screen and await approval by the department manager.'
    ],
    rules: [
      'A missed deadline raises a warning against the account automatically at 11:30. Four active warnings are escalated to Human Resources.',
      'Reminders are issued at 21:00 on the preceding evening and again at 10:00. Where the report will not be filed, the department manager shall be informed; the manager can record the day as leave, which exempts it instead of raising a warning.',
      'Sales and GEM Sales rows that the system already knows about (quotation activity) are filled in and locked. Do not retype them elsewhere.',
      'Changing a row\'s activity type clears the fields belonging to the old one. The GEM activity picker asks first for exactly this reason.'
    ]
  },
  'team-daily-reports': {
    steps: [
      'Open Team Daily Reports to review the department\'s filing status for a day, week, fortnight or month.',
      'Click a cell to read what somebody filed, or to file on their behalf.',
      'Mark a team member on leave for a date they could not file — that exempts the day rather than letting it become a warning.',
      'Approve or decline edit requests on reports that are already submitted.'
    ],
    rules: [
      'Visibility extends to the user\'s own department and to any department for which the user is named as manager in Department Master. No department beyond those.',
      'Filing on someone\'s behalf is recorded as on-behalf-of, not as them. The record stays honest.',
      'The Month preset counts every working day in the month, including ones that have not happened yet, so a mid-month figure reads lower than the department is actually running at.'
    ]
  },
  'my-tasks': {
    steps: [
      'Open My Tasks for every task assigned to the user, across sales and administrative work.',
      'Update the status as the work progresses, and add a remark wherever a status change requires explanation.',
      'Close the task when it is done.'
    ],
    rules: ['An overdue task remains overdue in analytics and on the manager\'s dashboard. Re-date it deliberately rather than leaving it open.']
  },
  'team-tasks': {
    steps: [
      'Open Team Tasks to review the work the team is carrying.',
      'Reassign or re-date any task that is stuck, and read the remark trail before following it up.'
    ]
  },
  'admin-task-assignment': {
    steps: [
      'Open Task Planner to create work for somebody else.',
      'Select the assignee: an individual, or a department manager where the work is to be distributed by that manager.',
      'Set a due date and a clear title; the assignee sees both in My Tasks and is notified.'
    ],
    rules: ['A task with no due date never becomes overdue and so never chases anyone. Set one.']
  },

  // -------------------------------------------------------------------- Sales
  projects: {
    steps: [
      'Open Project Dashboard for every sales project, from site visit through to close.',
      'Add a project with New Project. Type the client name — if they already exist, the form offers to use their details.',
      'Choose "Use their details for this new project" to copy the client\'s identity and contacts from their most recent project. This still creates a NEW project.',
      'Advance the project through its stages as the position changes, and add remarks at each step; the remark trail is what makes the timeline readable afterwards.'
    ],
    rules: [
      'The duplicate suggestion copies the client ONLY — never the value, stage, departments or assignees. A second project for an existing client is the ordinary case, not a copy of their last deal.',
      '"Open the existing one" opens in a new tab deliberately, so that the project being entered is not discarded.',
      'Visibility depends on the role\'s data scope: without org-wide visibility, the user sees their own records and those of any department they manage.'
    ]
  },
  quotation: {
    steps: [
      'Open Quotations and start a new one, picking the client or project it belongs to.',
      'Add products from the catalogue, or a custom line where nothing fits.',
      'Set quantities and review the totals.',
      'Save, then send or print the PDF.'
    ],
    rules: [
      'Markup, discount, custom-product pricing and the AMC percentage are governed by a permission separate from creating a quotation. Where those inputs are locked, that is a configured control; the permission shall be requested rather than circumvented.',
      'Revise an existing quotation rather than creating a near-duplicate: the revision keeps the history attached to the same client.'
    ]
  },
  'my-quotations': {
    steps: [
      'Open Existing Quotations to search what has already been raised and follow it up.',
      'Filter by client, status or date to locate the required record.',
      'Open it to revise, re-print or record the outcome.'
    ]
  },
  leads: {
    steps: [
      'Open Lead Capture / Inquiry and record the enquiry with whatever detail is available; a telephone number alone is sufficient to open it.',
      'Record the outcome of every call with the enquirer.',
      'Convert the lead to a project once there is something real to quote.'
    ],
    rules: [
      'Leads are scoped to those the user created or was assigned, and are not org-wide. An exhibition can add several hundred records, and they are not open to every user to work.',
      'A lead with no project yet shows in Client Master as a prospect rather than as a customer with zero projects.'
    ]
  },
  'client-master': {
    steps: [
      'Open Client Master for the single directory of every counterparty: customers, drawn from projects, and prospects, drawn from leads with no project yet.',
      'Use New Project on any row to start another job for that client with their details already filled in.',
      'Open a row to see their projects, contacts, owners and remarks together.'
    ],
    rules: [
      'The directory groups by a normalised name: punctuation, spacing and a trailing legal form are ignored, so "VRL MEDIA PVT LTD" and "VRL Media Ltd" are one client.',
      'Grouping is deliberately NOT fuzzy. Two clients whose names differ by a real word stay separate, because merging them would hide one\'s projects inside the other\'s.',
      'The CSV export still carries the Product Handlers column even though the screen replaced it with the New Project action — a CSV has no buttons, and that is the only way those pairs leave the app.'
    ]
  },
  'site-visits': {
    steps: [
      'Open Site Visit Report and record the visit while the detail is fresh.',
      'Attach photographs taken on site.',
      'Note what was agreed and what has to happen next.'
    ],
    rules: ['Attachments live in this app\'s own storage. A visit filed without photographs is hard to defend months later.']
  },
  'demo-schedule': {
    steps: [
      'Open Demo Schedule and book the demo against its client or project.',
      'Record what was demonstrated and the outcome afterwards.',
      'Record the demo cost where one was incurred — the monthly review to management reports demos and total cost together.'
    ]
  },
  billing: {
    steps: [
      'Open Billing to raise and track invoices against won work.',
      'Reconcile against what Accounts has actually received.'
    ]
  },
  'quotation-requests': {
    steps: [
      'Open Partner Quotation Requests to see what partners have asked to be quoted.',
      'Pick one up, raise the quotation, and send it back through the request so the partner sees the response.'
    ]
  },
  partners: {
    steps: [
      'Open Partner Management to create a partner organisation and name its relationship manager.',
      'Obtain the three onboarding documents: Agreement, NDA and Payment Agreement. They are uploaded either by the partner or by the relationship manager on the partner\'s behalf.',
      'Review each document. The partner gets full portal access only once all three are approved by the account creator.'
    ],
    rules: [
      'Who may create a partner is set in Application Settings → Partner Settings. A newly ticked person has to sign in once for it to take effect.',
      'A partner created before onboarding existed is grandfathered in and holds no documents — a "0 of 3 approved" label on such a partner is a display of document count, not a blocked account.'
    ]
  },
  'partner-workspace': {
    steps: [
      'Open Partner to review only the partners the user created, or for which the user is the relationship manager.',
      'Track their documents, activity and requirements from here rather than from the admin list.'
    ],
    rules: ['This module is scoped to the user by design. Visibility of another user\'s partners is a defect and shall be reported as a suspected access defect rather than used.']
  },
  'my-sold-projects': {
    steps: [
      'Open My Sold Projects to follow the projects the user sold through technical execution, without access to the whole of TMS.',
      'Check status and raise a question against the project rather than chasing by phone.'
    ]
  },

  // ----------------------------------------------------------------------- TMS
  'tms-dashboard': {
    steps: ['Open TMS Dashboard for the technical side\'s overall state — projects, tasks and what is blocked.']
  },
  'tms-projects': {
    steps: [
      'Open Technical Projects. These are execution projects, deliberately separate from the sales pipeline.',
      'Set the team, the category and the status, and keep the status honest — the dashboard and the reviews read from it.'
    ],
    rules: ['There is no time-tracking, hours or billable field anywhere in TMS, by explicit decision. Do not look for one.']
  },
  'tms-tasks': {
    steps: [
      'Open Tasks to see technical work items.',
      'Update the status as execution progresses, and attach whatever the next party requires.'
    ],
    rules: ['Engineers and Technicians see their own tasks. Full visibility across the team is a separate permission.']
  },
  'tms-bom-requests': {
    steps: [
      'Open BOM Request and raise the bill of materials required.',
      'The request is routed to the manager of the requester\'s own department first — Robotics to the Robotics manager, and not to every technical manager.',
      'After that manager approves, it goes to Mayank Jani.',
      'After that approval it goes to Accounts for payment.',
      'The request page shows where it currently sits and what has already been approved.'
    ],
    rules: [
      'The approval chain is sequential. A request held at the first stage has not reached Mayank and will not do so until the requester\'s own department manager has acted.',
      'Approved is not paid. The last step is Accounts, and the request says so until payment is marked.'
    ]
  },
  'tms-procurement': {
    steps: [
      'Open Procurement to turn approved material requests into orders.',
      'Record what was ordered, from whom, and when it is expected.'
    ]
  },
  'tms-users': {
    steps: [
      'Open Users & Tab Access to control who in the technical team reaches which TMS tab.',
      'Grant the minimum that lets somebody do their job.'
    ]
  },
  'tms-tab-access': {
    steps: ['Open Tab Access to set the per-tab permissions the TMS modules read.']
  },

  // -------------------------------------------------------------------- Support
  'support-tickets': {
    steps: [
      'Open Technical Support to see tickets raised by customers and partners.',
      'Take ownership, record each exchange on the ticket rather than over mail, and resolve it with a note on what fixed it.'
    ],
    rules: ['The ticket history is the record. A fix explained only in a phone call is a fix that will be re-diagnosed next time.']
  },

  // ---------------------------------------------------------------------- HR
  reimbursement: {
    steps: [
      'Open Reimbursement and raise a claim for the period.',
      'Add each expense as its own row, using the multi-row entry rather than a single combined line.',
      'Attach the bill for every row. A row without a bill is returned to the claimant.',
      'Submit. The claim is routed to the approver, then to Accounts for payment.'
    ],
    rules: [
      'Claims have a deadline for each period. A claim submitted after the deadline is not an entitlement and requires the approver\'s agreement.',
      'Every attachment shall open and be legible. Photograph the whole bill rather than part of it.'
    ]
  },
  'office-operation-expenses': {
    steps: [
      'Open Office Operation Expenses.',
      'Add several expenses in one go using the multi-row form, exactly as Reimbursement works.',
      'Give each row its use case and item, and attach its bill.',
      'Submit the set together.'
    ]
  },
  'admin-expenses': {
    steps: [
      'Open Admin Expenses and enter the month\'s administrative spend.',
      'Use the multi-row form to enter several at once rather than saving one at a time.',
      'Check each row\'s category before submitting — the HR Expense Report groups on it.'
    ]
  },
  'hr-reports': {
    steps: [
      'Open HR Expense Report for the consolidated view of reimbursement, office operation and admin expense.',
      'Filter to the month and department being reported on, and export.'
    ]
  },
  'hr-employees': {
    steps: [
      'Open Employees for the HR view of the directory.',
      'Keep designation, department and joining date current — the Daily Report module reads the joining date to decide which days somebody owes a report for.'
    ],
    rules: ['A wrong joining date warns a new joiner for days before they started. It is the one field worth double-checking.']
  },
  'hr-daily-reports': {
    steps: [
      'Open Daily Report Review. It lists the employees who need an HR decision — the final warning only, not the running tally.',
      'Read the warning and the reports behind it before acting.',
      'Waive it with a reason, or carry it forward into the HR process.'
    ],
    rules: [
      'The action shall be taken within two days. After that period the HR manager is reminded that it remains pending.',
      'The escalation mail goes to both the HR manager and HR, so "I didn\'t see it" is not where this ends up.'
    ]
  },
  'travel-schedule': {
    steps: [
      'Open Travel Schedule and raise the trip before travelling.',
      'Record purpose, dates and destination; get it approved; then record the actual booking.'
    ]
  },
  'employee-exit': {
    steps: [
      'Open Employee Exit and start the exit for the leaver.',
      'Work the checklist — handover, assets, access, final settlement.',
      'Close it only when every item is genuinely done.'
    ],
    rules: ['Deactivating the account does not clear them from Department Master\'s manager lists. Check anything that routed to them.']
  },

  // --------------------------------------------------------------- Accounts
  'accounts-payments': {
    steps: [
      'Open Payments for the queue of items approved and awaiting payment: reimbursements, BOM requests and travel bookings.',
      'Make the payment, then mark it paid here, so that both the requester and the approver see it closed.'
    ],
    rules: ['This queue is for the Accounts team and administrators. Marking an item paid is the signal every party upstream is waiting for, and shall be recorded when the payment is made rather than batched.']
  },

  // -------------------------------------------------------------- Marketing
  materials: {
    steps: [
      'Open Materials to find a datasheet, case study, brochure, presentation or certificate.',
      'Browse by folder, or search. Search covers the whole library and not only the folder currently open.',
      'Marketing adds documents: pick the folder, give it a product and a category, and either paste a Drive link, upload the file, or paste any other web address.'
    ],
    rules: [
      'A folder or document can be limited to specific roles. Limiting a folder limits everything inside it, so the SoP folders show each role only its own.',
      'For a Drive link, MatrixIQ stores the link and not the file. Where Drive reports the file as restricted, no other user can open it. Verify the link in a private browser window before adding it.',
      'Sharing with partners needs the document AND every folder above it shared. Ticking the document alone does nothing.'
    ]
  },
  'marketing-requests': {
    steps: [
      'Open Marketing Requests and raise the item to be designed or produced.',
      'State the purpose and the date required; the wizard asks for these in order.',
      'The request is approved, assigned, and returned to the requester as a final submission. Comments shall be made on the request rather than by mail to the designer.'
    ]
  },

  // ----------------------------------------------------------- Operations
  backoffice: {
    steps: [
      'Open Back Office Operations for delivery challans, dispatch and material returns.',
      'Raise the challan against the project it belongs to, print it, and record the dispatch.',
      'Record returns against the same project so the stock position stays true.'
    ]
  },

  // -------------------------------------------------------------- Reports
  analytics: {
    steps: [
      'Open Analytics for the pipeline and activity picture.',
      'Set the period first, then read — most figures are period-sensitive.'
    ],
    rules: ['Figures observe the user\'s data scope. Two users can legitimately see different totals on the same screen.']
  },
  targets: {
    steps: ['Open Target Details to set and review targets, and to see actuals against them.']
  },
  'performance-review': {
    steps: ['Open Performance Review for the per-person review view, and work from the recorded activity rather than from impression.']
  },
  'partner-analytics': {
    steps: ['Open Partner Analytics for the channel picture — which partners are producing, and what is stuck.']
  },

  // ------------------------------------------------------- Administration
  'user-management': {
    steps: [
      'Open User Management to create an account, set its role and department, and deactivate a leaver.',
      'Set the department: almost every scope, routing and daily-report rule in the app reads it.'
    ],
    rules: [
      'Role decides permissions; department decides what data is in scope. They are different questions and both matter.',
      'A new user must sign in once before per-user grants (such as who may create a partner) take effect for them.'
    ]
  },
  'role-management': {
    steps: [
      'Open Role Management to create a role or change what one may do.',
      'Set the per-module actions — view, create, edit, delete, export, print, approve, reject, assign, manage.',
      'Save, and tell the people affected. Their SoP changes with it.'
    ],
    rules: [
      'A module action left unset falls back to whether the role is privileged. Setting it explicitly removes the ambiguity.',
      'View All Departments is the only switch that decides org-wide versus own-records data visibility. It is not the same as being privileged.'
    ]
  },
  'department-master': {
    steps: [
      'Open Department Master to add a department and name its manager(s).',
      'The manager list is what routes approvals, daily-report mail, monthly reviews and dashboard badges.'
    ],
    rules: [
      'Department mail goes to the people on this list and nobody else. Holding a role is not the same as being the department\'s manager — the Accounts team hold the accounts role, but Accounts\' report mail goes to the manager named here.',
      'This list is not cleared when somebody is deactivated. Check it as part of an exit.'
    ]
  },
  'module-manager': {
    steps: [
      'Open Module Manager to enable or disable a module, re-order the sidebar, and set which roles and departments see each tile.',
      'Change it here rather than asking for a code change.'
    ],
    rules: ['Hiding a tile is presentation. The API behind it has its own gate — do not treat a hidden tile as a permission.']
  },
  'app-settings': {
    steps: [
      'Open Application Settings for the app-wide switches, including Partner Settings — who may create a partner.',
      'Tick the people, save, and have them sign in once.'
    ]
  },
  'product-master': {
    steps: [
      'Open Products to maintain the catalogue quotations are built from.',
      'Keep names and prices current — a quotation is only as good as this list.'
    ]
  },
  'product-catalog-overrides': {
    steps: ['Open Product Catalog to override catalogue behaviour where a product needs to behave differently from its default.']
  },
  'custom-modules': {
    steps: ['Open Custom Module Builder to add a tile for something this app does not have natively.']
  },
  'meta-lead-integration': {
    steps: [
      'Open Meta Lead Integration to connect lead forms so enquiries arrive in Lead Capture automatically.',
      'Check that leads are still arriving after any change at the Meta end.'
    ]
  },
  'audit-log': {
    steps: [
      'Open Audit Log to answer "who changed this, and when".',
      'Filter by entity, person or date. Start here before asking anybody what happened.'
    ]
  },
  'daily-report-config': {
    steps: [
      'Open Daily Report Configuration for working days, holidays, the four event times, the warning threshold and the per-department template assignment.',
      'Change a time and the sweep picks it up the same day — it re-reads the configuration on every hop.',
      'Use Run Live Sweep only deliberately: it sends real mail.'
    ],
    rules: [
      'Scheduler Enabled switches the whole module\'s sending off; Dry Run keeps it a rehearsal. Those are the two switches that matter.',
      'The sweep wakes at the configured event times, not on an interval. Four wake-ups a day, derived from these settings.'
    ]
  },

  // ------------------------------------------------------- Partner Portal
  'partner-dashboard': {
    steps: ['Sign in to the partner portal for the account\'s own dashboard: its leads, quotations, demos and documents in one place.']
  },
  'partner-profile': {
    steps: [
      'Open Company Profile and keep the organisation\'s details and GST registration current.',
      'Upload the Agreement, NDA and Payment Agreement here where the relationship manager has not already done so.'
    ],
    rules: ['Full portal access begins once all three documents are approved by the user who created the account.']
  },
  'partner-projects': {
    steps: ['Open My Leads / Projects to register a lead and follow it as it becomes a project.']
  },
  'partner-quotations': {
    steps: ['Open Quotations to request a quotation and to read what came back.']
  },
  'partner-demos': {
    steps: ['Open Demo Requests to request a demonstration for the customer, and to see when it is scheduled.']
  },
  'partner-materials': {
    steps: ['Open Marketing Materials for the brochures, datasheets, case studies and presentations published to partners.'],
    rules: ['Visibility is limited to the material published to partners. Where an expected item is missing, the relationship manager shall be asked rather than the item presumed not to exist.']
  },
  'partner-marketing-requests': {
    steps: ['Open Marketing Requests to request marketing collateral, and to track what was requested.']
  },
  'partner-support': {
    steps: ['Open Technical Support to raise a ticket and follow it. Keep the exchange on the ticket so the history stays in one place.']
  }
};

/**
 * The clause content every role's SoP shares.
 *
 * Written once rather than per role: these are the rules of the system
 * itself, and fourteen copies of them that could drift apart would be worse
 * than one copy everybody reads. The role-specific clauses — purpose, scope,
 * responsibility, access — are assembled in lib/sopDocument.ts, because they
 * depend on the role record and on the live module registry.
 *
 * The register is deliberately formal and uses "shall" for a requirement.
 * This is a controlled document that an auditor may read and that a manager
 * may have to hold somebody to; narrative asides belong in the module
 * procedures above, not here.
 */

export interface SopClauseBlock {
  /**
   * Position within the parent clause, so 7.1 is index '1' under clause 7.
   *
   * Assigned by lib/sopDocument.ts AFTER the blocks that do not apply to the
   * role have been dropped, so the numbering never skips. Authored here as ''
   * for that reason.
   */
  index: string;
  title: string;
  body: string[];
  /**
   * Which kind of account the clause applies to. Absent means both.
   *
   * It exists because of the partner roles. A Partner Admin files no Daily
   * Report, has no department and has no manager in Department Master —
   * printing those requirements in their procedure would be stating a
   * requirement that cannot be met, which is the fastest way to have the
   * whole document disregarded.
   */
  appliesTo?: 'internal' | 'partner';
}

/** 3.0 — the controlled sources this document is derived from. */
export const SOP_REFERENCES: { ref: string; source: string; heldIn: string }[] = [
  { ref: 'R1', source: 'Role permission matrix', heldIn: 'MatrixIQ > Role Management' },
  { ref: 'R2', source: 'Module visibility and enablement register', heldIn: 'MatrixIQ > Module Manager' },
  { ref: 'R3', source: 'Department and department-manager register', heldIn: 'MatrixIQ > Department Master' },
  { ref: 'R4', source: 'Daily reporting deadline and reminder schedule', heldIn: 'MatrixIQ > Application Settings' },
  { ref: 'R5', source: 'Record of configuration and data changes', heldIn: 'MatrixIQ > Audit Log' },
  { ref: 'R6', source: 'User account, role and department assignment', heldIn: 'MatrixIQ > User Management' }
];

/** 4.0 — terms that carry a specific meaning in MatrixIQ. */
export const SOP_DEFINITIONS: { term: string; meaning: string }[] = [
  { term: 'MatrixIQ', meaning: 'The internal business application to which this procedure applies.' },
  { term: 'Module', meaning: 'One functional screen, or group of screens, enabled and made visible through Module Manager (R2).' },
  { term: 'Role', meaning: 'The set of permissions assigned to a user account. A user account holds exactly one role.' },
  {
    term: 'Permission matrix',
    meaning:
      'The per-module, per-action grid held against a role in Role Management (R1). It governs every action that a module submits for a permission check.'
  },
  {
    term: 'Privileged role',
    meaning:
      'A role flagged as privileged in Role Management. Where the permission matrix is silent on an action, a privileged role is allowed it and a non-privileged role is not.'
  },
  {
    term: 'Department',
    meaning:
      'The organisational unit a user account is assigned to in User Management (R6). The department governs which records are in scope; the role governs which actions are permitted.'
  },
  {
    term: 'Department manager',
    meaning:
      'The user named as manager of a department in Department Master (R3). Approvals, reminders and escalations are routed to that named user and not to a role.'
  },
  {
    term: 'Daily Report',
    meaning: 'The mandatory record of a working day, filed on the form assigned to the department and submitted before the configured deadline.'
  },
  { term: 'Working day', meaning: 'A day on which a Daily Report is required, as determined by the organisation calendar and by approved leave.' },
  { term: 'BOM', meaning: 'Bill of Materials. A request for material against a task or project, routed for approval before issue.' },
  { term: 'TMS', meaning: 'Task Management System. The modules through which work is assigned, executed and closed.' },
  { term: 'GeM', meaning: 'Government e-Marketplace. The procurement portal against which tender and bid activity is recorded.' },
  {
    term: 'Partner',
    meaning: 'An external channel account. A partner user sees only material published to partners, and only their own organisation’s records.'
  },
  { term: 'IST', meaning: 'Indian Standard Time, UTC+05:30. Every deadline, timestamp and reporting period in MatrixIQ is evaluated in IST.' },
  { term: 'Shall', meaning: 'Denotes a mandatory requirement of this procedure.' },
  { term: 'Should', meaning: 'Denotes a recommended practice that is not mandatory.' }
];

/** 7.0 — the requirements that apply to every role, in shall-form. */
export const SOP_GENERAL_REQUIREMENTS: SopClauseBlock[] = [
  {
    index: '',
    title: 'Account and attribution',
    body: [
      'The user shall access MatrixIQ only through the account issued to them. Credentials shall not be shared, and work shall not be carried out on another person’s session.',
      'Every creation, amendment and deletion is recorded against the account that performed it in the Audit Log (R5). Work performed on a shared login is attributed to the account holder and not to the person at the keyboard.'
    ]
  },
  {
    index: '',
    title: 'Role and departmental scope',
    appliesTo: 'internal',
    body: [
      'The role determines which actions the user may perform. The department determines which records fall within the user’s scope. These are two independent settings, both held in User Management (R6).',
      'The user shall not seek access to records outside their departmental scope in order to complete a task. Where a task requires data held by another department, the request shall be routed through that department’s manager.'
    ]
  },
  {
    index: '',
    title: 'Permissions and unavailable functions',
    body: [
      'Where a screen, a field or an action is unavailable to the user, that is a configured decision recorded in the permission matrix (R1) or the module register (R2). It shall be treated as a control and not as a fault.',
      'The user shall not circumvent an unavailable function by any alternative route, including the use of another account, alteration of the same record through a different module, or export and re-entry of data. A permission that is genuinely required shall be requested through the authority named for it in clause 5.0.'
    ]
  },
  {
    index: '',
    title: 'Daily reporting',
    appliesTo: 'internal',
    body: [
      'Every user required to file a Daily Report shall submit it on each working day before the configured deadline, which is 11:30 IST unless altered in Application Settings (R4).',
      'Reminders are issued automatically at 21:00 IST on the preceding evening and again at 10:00 IST on the day. A missed deadline generates a warning without further intervention, and four active warnings are escalated to Human Resources.',
      'Where the user is unable to file, whether through approved leave, travel or illness, the department manager shall be informed and shall record the day as leave, which exempts it. An unreported absence is recorded as a missed day.'
    ]
  },
  {
    index: '',
    title: 'Data entered into the system',
    body: [
      'The user shall record data in the module that owns it rather than in a note, an attachment or a file outside the application, so that it remains reportable.',
      'Monetary values, quantities and dates shall be entered as agreed and shall not be adjusted to produce a desired total. A figure that is provisional shall be identified as such in the record.'
    ]
  },
  {
    index: '',
    title: 'Scope of a partner account',
    appliesTo: 'partner',
    body: [
      'The user shall access only the records of their own partner organisation. Records belonging to another partner are outside the scope of the account and shall not be sought.',
      'Material published to partners is provided for the user’s own sales activity. It shall not be re-branded, re-published or circulated outside the user’s organisation without written consent.',
      'Where the user’s organisation adds or releases staff, the Partner Admin shall update the portal users under Company Profile, so that access matches the people actually employed.'
    ]
  }
];

/**
 * 9.0 — the records generated under this procedure.
 *
 * Tagged like the clauses, and for the same reason: a partner files no Daily
 * Report, so listing one as a record of their work would be wrong.
 */
export const SOP_RECORDS: { record: string; location: string; retention: string; appliesTo?: 'internal' | 'partner' }[] = [
  {
    record: 'Daily Report entries and submissions',
    location: 'Daily Report; Team Daily Reports',
    retention: 'Application database; retained indefinitely',
    appliesTo: 'internal'
  },
  { record: 'Configuration and data change history', location: 'Audit Log (R5)', retention: 'Application database; retained indefinitely' },
  { record: 'Outbound notification and reminder ledger', location: 'Notification records', retention: 'Application database; retained indefinitely' },
  {
    record: 'Documents generated or uploaded, including quotations, challans and vouchers',
    location: 'The module that produced them',
    retention: 'Application file storage; served only to authorised users'
  },
  { record: 'Records created in the modules listed in clause 8', location: 'The respective module', retention: 'Application database; visible subject to clause 6' }
];

/** 10.0 — what to do when the system or the data does not look right. */
export const SOP_ESCALATION: SopClauseBlock[] = [
  {
    index: '',
    title: 'Incorrect or unexpected data',
    body: [
      'The user shall consult the Audit Log (R5) first, where access permits. Most questions of the form "who changed this" are answered there.',
      'Where the record remains unexplained, the matter shall be raised with the authority named in clause 5.0 before the record is corrected, so that the correction is itself deliberate and traceable.'
    ]
  },
  {
    index: '',
    title: 'Notifications not received',
    appliesTo: 'internal',
    body: [
      'A notification that does not arrive is in most cases a question of configuration — who is named as the department’s manager in Department Master (R3) — rather than a failure to send.',
      'The user shall verify the named manager before reporting a delivery fault.'
    ]
  },
  {
    index: '',
    title: 'Suspected access or permission defect',
    body: [
      'Where the user is able to see or alter a record belonging to another person, another department or another partner and believes they should not be, the matter shall be reported to a system administrator immediately and shall not be investigated further by the user.',
      'The user shall not demonstrate the defect to colleagues, and shall not export or circulate the data that was exposed.'
    ]
  },
  {
    index: '',
    title: 'Departure from this procedure',
    appliesTo: 'internal',
    body: [
      'Any departure from this procedure shall be authorised in advance by the department manager and shall be recorded in the Daily Report for the day on which it occurred.'
    ]
  },
  {
    index: '',
    title: 'Questions and departures',
    appliesTo: 'partner',
    body: [
      'Any question on this procedure, and any departure from it, shall be raised with the relationship manager through Technical Support, so that the exchange is recorded against the account rather than held in private correspondence.'
    ]
  }
];

/** What the ten module actions mean, in words a reader can use. */
export const ACTION_WORDS: Record<string, string> = {
  view: 'open and read records',
  create: 'create new records',
  edit: 'amend existing records',
  delete: 'delete records',
  export: 'export data to CSV or Excel',
  print: 'print or generate a PDF',
  approve: 'approve submissions made by others',
  reject: 'reject submissions made by others',
  assign: 'assign work to other users',
  manage: 'exercise full administrative control of the module'
};
