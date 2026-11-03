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
      'Open Daily Report. It opens on today; the arrows and the date strip move between your working days.',
      'Fill in the form your department was assigned. The shape differs per department — a row per activity for most, one narrative for AV, a numeric grid for Sales and GEM Sales.',
      'Save as draft as often as you like. Nothing is reported until you submit.',
      'Submit before the deadline (11:30 IST by default). Your department manager is emailed that you filed.',
      'A submitted report is locked. To change it, raise an edit request from the same page and wait for your manager to approve it.'
    ],
    rules: [
      'Missing the deadline creates a WARNING against you automatically at 11:30. Four active warnings escalate you to HR.',
      'Reminders go out the evening before (21:00) and again at 10:00. If you are not going to file, tell your manager — they can mark you on leave, which exempts the day instead of warning you.',
      'Sales and GEM Sales rows that the system already knows about (quotation activity) are filled in and locked. Do not retype them elsewhere.',
      'Changing a row\'s activity type clears the fields belonging to the old one. The GEM activity picker asks first for exactly this reason.'
    ]
  },
  'team-daily-reports': {
    steps: [
      'Open Team Daily Reports to see your department\'s filing status for a day, week, fortnight or month.',
      'Click a cell to read what somebody filed, or to file on their behalf.',
      'Mark a team member on leave for a date they could not file — that exempts the day rather than letting it become a warning.',
      'Approve or decline edit requests on reports that are already submitted.'
    ],
    rules: [
      'You see your own department, plus any department you are listed as manager of in Department Master. Nothing wider.',
      'Filing on someone\'s behalf is recorded as on-behalf-of, not as them. The record stays honest.',
      'The Month preset counts every working day in the month, including ones that have not happened yet, so a mid-month figure reads lower than the department is actually running at.'
    ]
  },
  'my-tasks': {
    steps: [
      'Open My Tasks for everything assigned to you, across sales and admin work.',
      'Update status as you go, and add a remark when the status change needs explaining.',
      'Close the task when it is done.'
    ],
    rules: ['An overdue task stays overdue in analytics and on your manager\'s dashboard. Re-date it deliberately rather than leaving it to rot.']
  },
  'team-tasks': {
    steps: [
      'Open Team Tasks to see what your team is carrying.',
      'Reassign or re-date anything stuck, and read the remark trail before you chase.'
    ]
  },
  'admin-task-assignment': {
    steps: [
      'Open Task Planner to create work for somebody else.',
      'Pick the assignee — an individual, or a department\'s manager where you want them to distribute it.',
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
      'Move the project along its stages as reality changes, and add remarks as you go — the remark trail is what makes the timeline readable later.'
    ],
    rules: [
      'The duplicate suggestion copies the client ONLY — never the value, stage, departments or assignees. A second project for an existing client is the ordinary case, not a copy of their last deal.',
      '"Open the existing one" opens in a new tab on purpose, so it cannot discard the project you were typing.',
      'What you can see depends on your role\'s data scope: without org-wide visibility you see your own records plus any department you manage.'
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
      'Markup, discount, custom-product pricing and the AMC percentage are a separate permission from creating a quotation. If those inputs are locked for you, that is deliberate — ask rather than working around it.',
      'Revise an existing quotation rather than creating a near-duplicate: the revision keeps the history attached to the same client.'
    ]
  },
  'my-quotations': {
    steps: [
      'Open Existing Quotations to search what has already been raised and follow it up.',
      'Filter by client, status or date to find the one you mean.',
      'Open it to revise, re-print or record the outcome.'
    ]
  },
  leads: {
    steps: [
      'Open Lead Capture / Inquiry and add the enquiry with whatever you have — a phone number alone is enough to start.',
      'Record the call outcome each time you speak to them.',
      'Convert the lead to a project once there is something real to quote.'
    ],
    rules: [
      'Leads are scoped to the ones you created or were assigned, not org-wide. An expo drops hundreds of cards in here and they are not everybody\'s to work.',
      'A lead with no project yet shows in Client Master as a prospect rather than as a customer with zero projects.'
    ]
  },
  'client-master': {
    steps: [
      'Open Client Master for the single directory of everyone you deal with — customers (from projects) and prospects (from leads with no project yet).',
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
      'Collect the three onboarding documents — Agreement, NDA and Payment Agreement. Either the partner uploads them, or you upload on their behalf.',
      'Review each document. The partner gets full portal access only once all three are approved by the account creator.'
    ],
    rules: [
      'Who may create a partner is set in Application Settings → Partner Settings. A newly ticked person has to sign in once for it to take effect.',
      'A partner created before onboarding existed is grandfathered in and holds no documents — a "0 of 3 approved" label on such a partner is a display of document count, not a blocked account.'
    ]
  },
  'partner-workspace': {
    steps: [
      'Open Partner to see only the partners you created or are the relationship manager for.',
      'Track their documents, activity and requirements from here rather than from the admin list.'
    ],
    rules: ['The point of this module is that it is scoped to you. If you are seeing somebody else\'s partners, say so — that is a bug, not a feature.']
  },
  'my-sold-projects': {
    steps: [
      'Open My Sold Projects to follow what you sold through technical execution, without needing the whole TMS.',
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
      'Update status as you progress and attach what the next person needs.'
    ],
    rules: ['Engineers and Technicians see their own tasks. Full visibility across the team is a separate permission.']
  },
  'tms-bom-requests': {
    steps: [
      'Open BOM Request and raise the bill of materials you need.',
      'It goes to YOUR department\'s manager first — Robotics to the Robotics manager, not to every technical manager.',
      'After that manager approves, it goes to Mayank Jani.',
      'After that approval it goes to Accounts for payment.',
      'The request page shows where it currently sits and what has already been approved.'
    ],
    rules: [
      'The chain is sequential. A request waiting at stage one has not reached Mayank and will not until your own manager acts.',
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
      'Open Reimbursement and start a claim for the period.',
      'Add each expense as its own row — use the multi-row entry rather than one lumped line.',
      'Attach the bill for every row. A row without a bill will come back to you.',
      'Submit. It goes to your approver, then to Accounts for payment.'
    ],
    rules: [
      'Claims have a deadline per period. A late claim is a conversation, not an entitlement.',
      'Attachments must actually open. Photograph the whole bill, not a corner of it.'
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
      'Filter to the month and department you are reporting on, and export.'
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
      'You have two days to act. After that your HR manager is reminded that the action is still pending.',
      'The escalation mail goes to both the HR manager and HR, so "I didn\'t see it" is not where this ends up.'
    ]
  },
  'travel-schedule': {
    steps: [
      'Open Travel Schedule and raise the trip before you travel.',
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
      'Open Payments for the queue of things approved and waiting to be paid — reimbursements, BOM requests, travel bookings.',
      'Pay, then mark it paid here so the requester and the approver both see it closed.'
    ],
    rules: ['This queue is for the Accounts team and admins. Marking something paid is the signal everybody upstream is waiting for — do not batch it up for later.']
  },

  // -------------------------------------------------------------- Marketing
  materials: {
    steps: [
      'Open Materials to find a datasheet, case study, brochure, presentation or certificate.',
      'Browse by folder, or search — search looks through the whole library, not just the folder you are standing in.',
      'Marketing adds documents: pick the folder, give it a product and a category, and either paste a Drive link, upload the file, or paste any other web address.'
    ],
    rules: [
      'A folder or document can be limited to specific roles. Limiting a folder limits everything inside it, so the SoP folders show each role only its own.',
      'For a Drive link, MatrixIQ stores the LINK, not the file — if Drive says "Restricted", nobody else can open it. Check in a private window before you add it.',
      'Sharing with partners needs the document AND every folder above it shared. Ticking the document alone does nothing.'
    ]
  },
  'marketing-requests': {
    steps: [
      'Open Marketing Requests and raise what you need designed or produced.',
      'Say what it is for and when you need it — the wizard asks in order.',
      'It is approved, assigned, and comes back to you as a final submission. Comment on the request rather than mailing the designer.'
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
    rules: ['Figures respect your data scope. Two people can legitimately see different totals on the same screen.']
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
      'A module action left unset falls back to whether the role is privileged. Setting it explicitly is how you stop guessing.',
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
    steps: ['Sign in to the partner portal for your own dashboard — your leads, quotations, demos and documents in one place.']
  },
  'partner-profile': {
    steps: [
      'Open Company Profile and keep your organisation\'s details and GST current.',
      'Upload the Agreement, NDA and Payment Agreement here if your relationship manager has not uploaded them for you.'
    ],
    rules: ['Full portal access starts once all three documents are approved by the person who created your account.']
  },
  'partner-projects': {
    steps: ['Open My Leads / Projects to register a lead and follow it as it becomes a project.']
  },
  'partner-quotations': {
    steps: ['Open Quotations to request a quotation and to read what came back.']
  },
  'partner-demos': {
    steps: ['Open Demo Requests to ask for a demonstration for your customer, and to see when it is scheduled.']
  },
  'partner-materials': {
    steps: ['Open Marketing Materials for the brochures, datasheets, case studies and presentations published to partners.'],
    rules: ['You see what has been published to partners. If something you expect is missing, ask your relationship manager rather than assuming it does not exist.']
  },
  'partner-marketing-requests': {
    steps: ['Open Marketing Requests to ask for marketing collateral, and to track what you asked for.']
  },
  'partner-support': {
    steps: ['Open Technical Support to raise a ticket and follow it. Keep the exchange on the ticket so the history stays in one place.']
  }
};

/**
 * The pages every role's SoP opens with, before the module pages.
 *
 * Written once rather than per role: these are the rules of the system
 * itself, and fourteen copies of them that could drift apart would be worse
 * than one copy everybody reads.
 */
export const SOP_PREAMBLE: { heading: string; body: string[] }[] = [
  {
    heading: 'How to read this document',
    body: [
      'This SoP is written for one role. It covers only the modules that role can actually reach, and the "What you can do" line under each module is generated from that role\'s real permissions — not from a description of them.',
      'That means it is specific to how MatrixIQ is configured right now. If Role Management or Module Manager is changed, this document is out of date and should be regenerated rather than edited by hand.',
      'Each module page has the same four parts: what it is for, where it is, what you can do in it, and then the procedure and the rules. If you read only one part, read the rules — they are the things that go wrong silently.'
    ]
  },
  {
    heading: 'Before anything else',
    body: [
      'Sign in with your own account. Work done on a shared login is attributed to whoever owns it, and the audit log is what answers questions about who changed what.',
      'Your role decides what you may do. Your department decides what data is in scope for you. Those are two different things, and both are set in User Management.',
      'If a screen or a field is locked for you, that is a configured decision rather than a fault. Ask for the permission; do not route around it.'
    ]
  },
  {
    heading: 'The daily obligation',
    body: [
      'Everybody who owes a daily report files one before the deadline, 11:30 IST unless an admin has changed it.',
      'Reminders go out at 21:00 the evening before and again at 10:00. Missing the deadline creates a warning automatically; four active warnings escalate to HR.',
      'If you cannot file — leave, travel, illness — tell your department manager. They can mark the day as leave, which exempts it. Silence becomes a warning.'
    ]
  },
  {
    heading: 'When something looks wrong',
    body: [
      'Check the Audit Log first if you have access to it: most "who changed this" questions are answered there in a minute.',
      'A missing notification is usually a configuration question — who is named as the department\'s manager in Department Master — rather than a failure to send.',
      'Report anything that looks like a permissions leak immediately, especially seeing another person\'s or another partner\'s records.'
    ]
  }
];

/** What the ten module actions mean, in words a reader can use. */
export const ACTION_WORDS: Record<string, string> = {
  view: 'open and read it',
  create: 'add new records',
  edit: 'change existing records',
  delete: 'delete records',
  export: 'export to CSV or Excel',
  print: 'print or produce a PDF',
  approve: 'approve what others submit',
  reject: 'reject what others submit',
  assign: 'assign work to other people',
  manage: 'full administrative control of the module'
};
