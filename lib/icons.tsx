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
  Shield,
  TrendingUp,
  Tag,
  DollarSign,
  Settings,
  Puzzle,
  Wrench,
  Layers,
  List,
  Inbox,
  Star,
  Flag,
  Target,
  Globe,
  Database,
  Bell,
  type LucideIcon
} from 'lucide-react';

export const SECTION_ICON: Record<string, LucideIcon> = {
  Sales: Briefcase,
  Marketing: Megaphone,
  Operations: Package,
  Reports: BarChart3,
  Administration: Building2
};

export const DEFAULT_SECTION_ICON: LucideIcon = FolderKanban;

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

// Dashboard "Needs Your Attention" row icons, keyed by AttentionItem.key.
export const ATTENTION_ICON: Record<string, LucideIcon> = {
  followup: Clock,
  'demo-approvals': Monitor,
  dc: Package,
  'dc-verify': CheckCircle2,
  leads: Contact,
  marketing: Megaphone,
  sitevisit: MapPin,
  'my-demo-confirm': UserCheck,
  'my-demo-approve': PenLine,
  handover: ArrowRightLeft
};

export const ALL_CAUGHT_UP_ICON: LucideIcon = CheckCircle2;
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
  bell: Bell
};

export const MODULE_ICON_OPTIONS = Object.keys(MODULE_ICON_REGISTRY);

export function resolveModuleIcon(icon: string): LucideIcon | null {
  return MODULE_ICON_REGISTRY[icon] || null;
}
