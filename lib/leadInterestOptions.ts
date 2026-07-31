import { DomainKey } from './types';

// Ported verbatim from the original "Nanta Leads" HTML tool's interest
// tiles/pills — this is the taxonomy the sales team already uses at events,
// kept as-is rather than reinvented. Only 'visitiq' has no equivalent tile
// in the source tool, so it's left out here (unlike lib/domainProducts.ts,
// which covers every domain).
export const LEAD_DOMAIN_TILES: { key: DomainKey; icon: string; label: string; hint: string }[] = [
  { key: 'robotics', icon: '🤖', label: 'Robotics', hint: 'Cobots · AMR · Arms' },
  { key: 'av', icon: '🎥', label: 'AV Systems', hint: 'Camera · Display' },
  { key: 'ai', icon: '🧠', label: 'AI / NTRA', hint: 'Vision · Analytics' },
  { key: 'si', icon: '⚙️', label: 'System Integrator', hint: 'OEM · Infra · IT' }
];

export const LEAD_SUB_INTERESTS: Partial<Record<DomainKey, string[]>> = {
  robotics: ['Collaborative / Cobot / Robotic Arm', 'AMR / AGV', 'Cleaning Robots', 'Serving robot', 'Humanoid / Robo dog', 'Reception Robot'],
  av: ['360° Panoramic', 'PTZ camera', 'Laser projector', 'LED display wall', 'Conference system', 'Cabling / infra'],
  ai: ['Face recognition', 'Object detection', 'ANPR / vehicle', 'Safety / PPE', 'Crowd analytics', 'Retail analytics'],
  si: ['Factory / OEM', 'Building / infra', 'IT / networking', 'Govt / defence', 'Healthcare']
};

export const LEAD_FOLLOW_UP_ACTIONS: { tag: string; icon: string }[] = [
  { tag: 'Call today', icon: '📞' },
  { tag: 'Call in 3 days', icon: '📅' },
  { tag: 'Send brochure', icon: '📄' },
  { tag: 'Schedule demo', icon: '🖥️' },
  { tag: 'Site visit', icon: '🏭' },
  { tag: 'Send quote', icon: '💰' },
  { tag: 'WhatsApp', icon: '💬' },
  { tag: 'Send email', icon: '📧' },
  { tag: 'Add to nurture', icon: '🌱' }
];

export const LEAD_BUDGET_OPTIONS: string[] = ['Not discussed', 'Under ₹5L', '₹5L – ₹25L', '₹25L – ₹1 Cr', 'Above ₹1 Cr'];

export const LEAD_PRIORITY_META: Record<'hot' | 'warm' | 'cool', { icon: string; label: string; hint: string }> = {
  hot: { icon: '🔥', label: 'Hot — needs now', hint: 'Active requirement · ready to decide' },
  warm: { icon: '♨️', label: 'Warm — 1 to 3 months', hint: 'Evaluating · follow up soon' },
  cool: { icon: '🧊', label: 'Cold — just exploring', hint: 'Nurture list · no urgency' }
};
