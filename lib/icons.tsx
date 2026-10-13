// Single icon set for fixed, code-owned UI chrome (sidebar nav, dashboard
// attention panel, section headers) — replaces emoji glyphs with lucide-react
// line icons so the app reads as one consistent enterprise product instead of
// a template. Deliberately NOT used for the per-module `icon` field in
// lib/moduleConfigStore.ts / Module Manager / Custom Module Builder — that
// field is real admin-editable data (an emoji the admin typed in), and
// silently overriding it here would make that admin control look broken.
import {
  LayoutDashboard,
  Briefcase,
  Megaphone,
  Package,
  BarChart3,
  Building2,
  FolderKanban,
  FileText,
  MapPin,
  Monitor,
  LogOut,
  Clock,
  CheckCircle2,
  UserCheck,
  PenLine,
  Contact,
  ArrowRightLeft,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Car,
  User,
  Users,
  Shield,
  TrendingUp,
  Tag,
  DollarSign,
  Settings,
  Puzzle,
  Wrench,
  Share2,
  Layers,
  List,
  Inbox,
  Star,
  Flag,
  Target,
  Globe,
  Database,
  Bell,
  ShoppingCart,
  ReceiptIndianRupee,
  Cake,
  KanbanSquare,
  CheckSquare,
  Library,
  Truck,
  type LucideIcon
} from 'lucide-react';

export const SECTION_ICON: Record<string, LucideIcon> = {
  Sales: Briefcase,
  Marketing: Megaphone,
  Operations: Package,
  Reports: BarChart3,
  Administration: Building2,
  HR: Users,
  Accounts: ReceiptIndianRupee
};

export const DEFAULT_SECTION_ICON: LucideIcon = FolderKanban;

// Department marks for the Dashboard's health cards. Keyed on the
// department names lib/departmentScoring.ts actually scores — matched
// case-insensitively and by prefix, so "GEM - Sales" and "HR & Admin" land
// on something sensible without needing an exact string.
const DEPARTMENT_ICON: { match: string; icon: LucideIcon }[] = [
  { match: 'gem', icon: Globe },
  { match: 'sales', icon: Briefcase },
  { match: 'marketing', icon: Megaphone },
  { match: 'account', icon: ReceiptIndianRupee },
  { match: 'hr', icon: Users },
  { match: 'admin', icon: Building2 },
  { match: 'robot', icon: Wrench },
  { match: 'ai', icon: Puzzle },
  { match: 'av', icon: Monitor },
  { match: 'r&d', icon: Star },
  { match: 'research', icon: Star },
  { match: 'back office', icon: Package },
  { match: 'technical', icon: Wrench }
];

export function departmentIconFor(name: string): LucideIcon {
  const normalized = (name || '').trim().toLowerCase();
  // Longest match wins, so "GEM - Sales" doesn't get claimed by "sales" and
  // "Back Office" doesn't get claimed by a shorter token.
  const hit = [...DEPARTMENT_ICON]
    .sort((a, b) => b.match.length - a.match.length)
    .find((entry) => normalized.includes(entry.match));
  return hit ? hit.icon : DEFAULT_SECTION_ICON;
}

export function sectionIconFor(label: string): LucideIcon {
  return SECTION_ICON[label] || DEFAULT_SECTION_ICON;
}

export const QUICK_ACTION_ICON: Record<string, LucideIcon> = {
  quotation: FileText,
  'site-visits': MapPin,
  'demo-schedule': Monitor,
  projects: FolderKanban
};

export const CHROME_ICON = {
  dashboard: LayoutDashboard,
  logout: LogOut,
  menuOpen: Menu,
  menuClose: X,
  collapseLeft: ChevronLeft,
  collapseRight: ChevronRight
};

export const ATTENTION_ICON: Record<string, LucideIcon> = {
  followup: Clock,
  'demo-approvals': Monitor,
  dc: Package,
  'dc-dispatch': Truck,
  'dc-verify': CheckCircle2,
  leads: Contact,
  'meta-leads': Share2,
  marketing: Megaphone,
  'marketing-reminders': Clock,
  sitevisit: MapPin,
  'my-demo-confirm': UserCheck,
  'my-demo-approve': PenLine,
  handover: ArrowRightLeft,
  'technical-approval': Wrench,
  travel: Car,
  'project-confirm': CheckSquare
};

export const ALL_CAUGHT_UP_ICON: LucideIcon = CheckCircle2;
// The "Due" bar in the Dashboard's section list (Sales leadership only) —
// sits among module sections, so it needs an icon of the same shape as
// SECTION_ICON's, but it isn't a module section and must not be reachable
// through sectionIconFor.
export const DUE_SECTION_ICON: LucideIcon = Clock;
export const ANALYTICS_ICON: LucideIcon = BarChart3;

// Module Manager / Custom Module Builder icon picker — the `icon` field on
// ModuleConfigRecord (lib/moduleConfigStore.ts) stores one of these keys as
// plain text, same as it always stored a plain-text emoji, just constrained
// now to a curated professional set instead of free-typed emoji. A legacy
// row whose `icon` predates this (still a raw emoji) falls back to rendering
// that string as-is — see resolveModuleIcon.
export const MODULE_ICON_REGISTRY: Record<string, LucideIcon> = {
  'folder-kanban': FolderKanban,
  'file-text': FileText,
  'clipboard-list': ClipboardList,
  // My Tasks ships with icon 'check-square' (lib/moduleConfigStore.ts's seed),
  // which was missing here — so resolveModuleIcon returned null and the
  // sidebar fell back to printing the key as text in a 16px icon slot, i.e.
  // no icon. Every key any seeded module uses must exist in this registry.
  'check-square': CheckSquare,
  'map-pin': MapPin,
  contact: Contact,
  monitor: Monitor,
  car: Car,
  package: Package,
  megaphone: Megaphone,
  user: User,
  shield: Shield,
  building: Building2,
  'bar-chart': BarChart3,
  'trending-up': TrendingUp,
  clock: Clock,
  tag: Tag,
  'dollar-sign': DollarSign,
  settings: Settings,
  puzzle: Puzzle,
  wrench: Wrench,
  layers: Layers,
  list: List,
  inbox: Inbox,
  star: Star,
  flag: Flag,
  target: Target,
  briefcase: Briefcase,
  globe: Globe,
  database: Database,
  bell: Bell,
  'layout-dashboard': LayoutDashboard,
  'shopping-cart': ShoppingCart,
  'receipt-indian-rupee': ReceiptIndianRupee,
  cake: Cake,
  users: Users,
  'share-2': Share2,
  'log-out': LogOut,
  'kanban-square': KanbanSquare,
  library: Library
};

export const MODULE_ICON_OPTIONS = Object.keys(MODULE_ICON_REGISTRY);

export function resolveModuleIcon(icon: string): LucideIcon | null {
  return MODULE_ICON_REGISTRY[icon] || null;
}
