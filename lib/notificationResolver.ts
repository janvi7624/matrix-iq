import type { Model, ModelStatic } from 'sequelize';
import { NotificationRecord } from './types';
import { db, isUuid } from './db';

// Every entity_type ever passed to notifyUsers() (lib/notificationStore.ts),
// paired with (a) the route a notification of that type should open and (b)
// how to confirm the referenced record still exists. Notification.entityId
// is a polymorphic UUID with no FK/association (see db/models/notification.js),
// so a stale reference — the record was deleted after the notification was
// created — has to be checked explicitly rather than relying on a join.
//
// Add an entry here whenever a new notifyUsers() call site introduces a new
// entity_type; anything not listed below has no known destination and is
// treated as non-actionable.
interface EntityResolver {
  href: (entityId: string) => string;
  exists: (entityId: string) => Promise<boolean>;
}

const MODEL_NAMES = ['DemoSchedule', 'MarketingRequest', 'Project', 'ReimbursementSheet', 'TmsBomRequest', 'TmsProcurement', 'TmsTask', 'TravelSchedule', 'Lead', 'Quotation'] as const;

async function existsIn(modelName: (typeof MODEL_NAMES)[number], entityId: string): Promise<boolean> {
  if (!isUuid(entityId)) return false;
  const model = db[modelName] as unknown as ModelStatic<Model>;
  const row = await model.findByPk(entityId, { attributes: ['id'] });
  return !!row;
}

// Some entity types have no per-record detail route (see the modules
// listed in each case) — their notification still opens a real, useful
// page (the record's own list view), so it's a valid destination per "a
// valid route" in the actionability rule, just not a deep link.
const RESOLVERS: Record<string, EntityResolver> = {
  demo: { href: () => '/demo-schedule', exists: (id) => existsIn('DemoSchedule', id) },
  marketing_request: { href: () => '/marketing-requests', exists: (id) => existsIn('MarketingRequest', id) },
  project: { href: (id) => `/projects/${id}`, exists: (id) => existsIn('Project', id) },
  reimbursement_sheet: { href: () => '/reimbursement', exists: (id) => existsIn('ReimbursementSheet', id) },
  tms_bom_request: { href: (id) => `/tms/bom-requests/${id}`, exists: (id) => existsIn('TmsBomRequest', id) },
  tms_procurement: { href: (id) => `/tms/procurement/${id}`, exists: (id) => existsIn('TmsProcurement', id) },
  tms_task: { href: (id) => `/tms/tasks/${id}`, exists: (id) => existsIn('TmsTask', id) },
  travel_schedule: { href: (id) => `/travel-schedule/${id}`, exists: (id) => existsIn('TravelSchedule', id) },
  lead: { href: () => '/leads', exists: (id) => existsIn('Lead', id) },
  // Reuses the highlight-and-auto-expand row on My Quotations rather than a
  // dedicated per-quotation page (none exists) — see components/
  // MyQuotationsView.tsx / QuotationTable.tsx.
  quotation: { href: (id) => `/my-quotations?highlight=${id}`, exists: (id) => existsIn('Quotation', id) }
};

// Resolves each notification's real destination and drops any that don't
// have one — an entity_type this module doesn't recognize, a missing
// entity_id, or a reference to a record that's since been deleted. Runs the
// existence checks in parallel rather than per-row awaits in a loop.
export async function resolveActionableNotifications(
  notifications: Omit<NotificationRecord, 'href'>[]
): Promise<NotificationRecord[]> {
  const withHref = await Promise.all(
    notifications.map(async (n) => {
      const resolver = RESOLVERS[n.entity_type];
      if (!resolver || !n.entity_id) return null;
      const ok = await resolver.exists(n.entity_id);
      if (!ok) return null;
      return { ...n, href: resolver.href(n.entity_id) };
    })
  );
  return withHref.filter((n): n is NotificationRecord => n !== null);
}
