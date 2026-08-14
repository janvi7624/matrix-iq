import { DomainKey } from './types';
import { Bot, Camera, BrainCircuit, Cog, Phone, CalendarClock, FileText, Monitor, Factory, IndianRupee, MessageCircle, Mail, Sprout, Flame, Thermometer, Snowflake, type LucideIcon } from 'lucide-react';

// Ported verbatim from the original "Nanta Leads" HTML tool's interest
// tiles/pills — this is the taxonomy the sales team already uses at events,
// kept as-is rather than reinvented. Only 'visitiq' has no equivalent tile
// in the source tool, so it's left out here (unlike lib/domainProducts.ts,
// which covers every domain). Icons switched from emoji to lucide-react
// components as part of the enterprise UI refinement.
export const LEAD_DOMAIN_TILES: { key: DomainKey; icon: LucideIcon; label: string; hint: string }[] = [
  { key: 'robotics', icon: Bot, label: 'Robotics', hint: 'Cobots · AMR · Arms' },
  { key: 'av', icon: Camera, label: 'AV Systems', hint: 'Camera · Display' },
  { key: 'ai', icon: BrainCircuit, label: 'AI / NTRA', hint: 'Vision · Analytics' },
  { key: 'si', icon: Cog, label: 'System Integrator', hint: 'OEM · Infra · IT' }
];

export const LEAD_SUB_INTERESTS: Partial<Record<DomainKey, string[]>> = {
  robotics: ['Collaborative / Cobot / Robotic Arm', 'AMR / AGV', 'Cleaning Robots', 'Serving robot', 'Humanoid / Robo dog', 'Reception Robot'],
  av: ['360° Panoramic', 'PTZ camera', 'Laser projector', 'LED display wall', 'Conference system', 'Cabling / infra'],
  ai: ['Face recognition', 'Object detection', 'ANPR / vehicle', 'Safety / PPE', 'Crowd analytics', 'Retail analytics'],
  si: ['Factory / OEM', 'Building / infra', 'IT / networking', 'Govt / defence', 'Healthcare']
};

export const LEAD_FOLLOW_UP_ACTIONS: { tag: string; icon: LucideIcon }[] = [
  { tag: 'Call today', icon: Phone },
  { tag: 'Call in 3 days', icon: CalendarClock },
  { tag: 'Send brochure', icon: FileText },
  { tag: 'Schedule demo', icon: Monitor },
  { tag: 'Site visit', icon: Factory },
  { tag: 'Send quote', icon: IndianRupee },
  { tag: 'WhatsApp', icon: MessageCircle },
  { tag: 'Send email', icon: Mail },
  { tag: 'Add to nurture', icon: Sprout }
];

export const LEAD_BUDGET_OPTIONS: string[] = ['Not discussed', 'Under ₹5L', '₹5L – ₹25L', '₹25L – ₹1 Cr', 'Above ₹1 Cr'];

export const LEAD_PRIORITY_META: Record<'hot' | 'warm' | 'cool', { icon: LucideIcon; label: string; hint: string }> = {
  hot: { icon: Flame, label: 'Hot — needs now', hint: 'Active requirement · ready to decide' },
  warm: { icon: Thermometer, label: 'Warm — 1 to 3 months', hint: 'Evaluating · follow up soon' },
  cool: { icon: Snowflake, label: 'Cold — just exploring', hint: 'Nurture list · no urgency' }
};
