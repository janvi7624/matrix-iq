// All copy for the public landing page (/) and /request-demo, in one place so
// wording can change without touching layout. Claims here were checked
// against the software (see the MatrixIQ brief) — keep it that way: do not
// advertise attendance/leave management or SLA escalation emails.

export const SITE = {
  url: 'https://matrix-iq.nantatech.com',
  company: 'NANTA TECH LIMITED',
  addressLines: [
    "204–207, 2nd Floor, 'F' Block, Shivalik Sharda Harmony",
    'Above Chelvies Coffee, Panjarapole Crossroads, Ambawadi',
    'Ahmedabad 380015, India'
  ],
  addressOneLine:
    "204–207, 2nd Floor, 'F' Block, Shivalik Sharda Harmony, Above Chelvies Coffee, Panjarapole Crossroads, Ambawadi, Ahmedabad 380015, India",
  phoneDisplay: '+91 99090 41673',
  phoneHref: 'tel:+919909041673',
  email: 'contact@nantatech.com',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=Shivalik+Sharda+Harmony+Panjarapole+Crossroads+Ambawadi+Ahmedabad+380015',
  seoTitle: 'MatrixIQ — AI-powered business platform | Every process, connected',
  seoDescription:
    'MatrixIQ by NANTA TECH LIMITED unifies CRM, AI lead intelligence, quotations, demos, project delivery, partner portal, HR, expenses and accounts in one connected platform — from first lead to final payment.'
};

export const CHAPTERS = [
  { id: 'top', label: 'Home' },
  { id: 'connected', label: 'Connected' },
  { id: 'modules', label: 'Modules' },
  { id: 'flow', label: 'How it flows' },
  { id: 'control', label: 'Control' },
  { id: 'demo', label: 'Get a demo' }
] as const;

export const HERO = {
  badge: 'AI-powered business platform',
  title: ['Every process,', 'connected.'],
  lead:
    'MatrixIQ brings sales, delivery, people and money into one living system — so every lead, task, approval and payment moves on its own, and nothing falls through the gaps.',
  chaos: ['Spreadsheets', 'Chats', 'Emails', 'Sticky notes', 'Follow-ups', 'Approvals']
};

export const DEPARTMENTS = [
  { key: 'sales', label: 'Sales & CRM' },
  { key: 'ai', label: 'AI' },
  { key: 'tech', label: 'Delivery' },
  { key: 'partners', label: 'Partners' },
  { key: 'hr', label: 'HR' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'leaders', label: 'Leadership' }
] as const;

export const CONNECTED = {
  eyebrow: 'One platform',
  title: 'Every department, finally on the same page.',
  body:
    'Work hands itself to the next team automatically. A won deal becomes a delivery project. A bill becomes a payment. A missed report becomes a reminder — not a phone call.',
  stats: [
    { value: '40+', label: 'connected modules' },
    { value: '1', label: 'source of truth' },
    { value: '0', label: 'spreadsheets to chase' }
  ],
  // Shown as floating bubbles in the "40+ connected modules" card — real
  // modules from the app, a sample rather than the full list.
  modules: [
    'Leads & CRM',
    'Quotations',
    'Projects',
    'TMS',
    'Daily reports',
    'Attendance',
    'Leave',
    'Reimbursements',
    'Office expenses',
    'Payments',
    'Purchase orders',
    'Delivery challans',
    'Demos',
    'Site visits',
    'Installation',
    'Travel',
    'Support tickets',
    'Marketing requests',
    'Festival campaigns',
    'Partner portal',
    'Materials',
    'Sales targets',
    'Analytics',
    'Custom modules'
  ],
  modulesMore: '+16 more'
};

export interface ModuleCard {
  icon: string;
  title: string;
  body: string;
  points: string[];
}

export const MODULES: ModuleCard[] = [
  {
    icon: 'target',
    title: 'Sales & CRM',
    body: 'Capture every lead and walk it to the close.',
    points: ['Scan a business card on your phone', 'Facebook & Instagram ad leads land automatically', 'Pipeline from prospect to commit', 'Duplicate-client warnings as you type']
  },
  {
    icon: 'sparkles',
    title: 'AI lead intelligence',
    body: 'Know which lead to call next — and what to say.',
    points: ['Reads every inquiry and scores intent', 'Suggests the next best action', 'Drafts a ready reply', 'Answers from your company knowledge']
  },
  {
    icon: 'file',
    title: 'Quotations & demos',
    body: 'Professional quotes and demos without the back-and-forth.',
    points: ['Smart product estimators', 'Versions, follow-ups, branded PDF & Excel', 'Demo approvals → dispatch → return', 'Delivery challans built in']
  },
  {
    icon: 'handshake',
    title: 'Partner portal',
    body: 'Your channel partners, plugged straight in.',
    points: ['Own login and team logins', 'Submit leads, request quotes, book demos', 'Support tickets with SLA timers', 'Marketing materials on tap']
  },
  {
    icon: 'layers',
    title: 'Project delivery',
    body: 'Won deals move straight into execution.',
    points: ['Phases, tasks and deadlines', 'BOM approvals and procurement', 'Sales can watch what they sold', 'Deadline-extension approvals']
  },
  {
    icon: 'calendar',
    title: 'Tasks & daily reports',
    body: 'Everyone knows what to do — and leaders know it got done.',
    points: ['Department-specific report formats', 'Rows that fill themselves from real work', 'Automatic reminders and escalation', 'Team tasks and planner']
  },
  {
    icon: 'users',
    title: 'HR, expenses & culture',
    body: 'People processes that run themselves.',
    points: ['Reimbursements: manager → HR → accounts', 'Travel, office and admin expenses', 'Employee appreciation wall', 'Birthdays, anniversaries & festivals']
  },
  {
    icon: 'chart',
    title: 'Leadership & analytics',
    body: 'The whole company on one screen.',
    points: ['Department health traffic lights', 'Targets vs achievement', 'Performance reviews', 'One-click executive report']
  }
];

export const FLOW = {
  eyebrow: 'How it flows',
  title: 'From first lead to final payment.',
  body: 'Follow one opportunity through MatrixIQ. Each step hands over to the next team — with approvals, emails and records created for you.',
  steps: [
    { title: 'Lead', body: 'Card scan, ad form or website — captured and assigned.' },
    { title: 'Project', body: 'Becomes a tracked opportunity with an owner.' },
    { title: 'Demo', body: 'Approved, dispatched and returned on record.' },
    { title: 'Quotation', body: 'Built, versioned and sent as a branded PDF.' },
    { title: 'Purchase order', body: 'Logged against the deal, terms and all.' },
    { title: 'Delivery', body: 'Handed to the technical team as a project.' },
    { title: 'Billing & payment', body: 'Billed, approved and paid — fully traceable.' }
  ]
};

export const CONTROL = {
  eyebrow: 'Secure & in control',
  title: 'Everyone sees exactly what they should.',
  items: [
    { icon: 'shield', title: 'Role & department access', body: 'Permissions per role, per department and per tab.' },
    { icon: 'history', title: 'Full audit trail', body: 'Every status change, by whom and when.' },
    { icon: 'lock', title: 'Secure sessions', body: 'Session timeouts, login history and remote sign-out.' },
    { icon: 'stamp', title: 'Protected documents', body: 'Downloads are stamped with the downloader’s name.' },
    { icon: 'blocks', title: 'Build without code', body: 'Create new modules and fields in minutes.' },
    { icon: 'phone', title: 'Works everywhere', body: 'Desktop, tablet and phone — installs like an app.' }
  ]
};

export const FINAL_CTA = {
  title: 'See MatrixIQ on your own workflow.',
  body: 'Book a 30-minute walkthrough. We will map your sales, delivery and back-office process onto MatrixIQ — live.',
  primary: 'Request a demo',
  secondary: 'Login'
};

export const INTEREST_OPTIONS = [
  'Sales & CRM',
  'AI lead intelligence',
  'Quotations & demos',
  'Partner portal',
  'Project delivery',
  'Tasks & daily reports',
  'HR & expenses',
  'Analytics'
];

export const TEAM_SIZE_OPTIONS = ['1–10', '11–50', '51–200', '201–500', '500+'];
