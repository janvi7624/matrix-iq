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

const MODEL_NAMES = ['DemoSchedule', 'MarketingRequest', 'Project', 'ReimbursementSheet', 'TmsProject', 'TmsBomRequest', 'TmsProcurement', 'TmsTask', 'TravelSchedule', 'Lead', 'Quotation', 'GeneralTask', 'LeaveRequest', 'Reimbursement', 'OfficeOperationExpense'] as const;

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
  tms_project: { href: (id) => `/tms/projects/${id}`, exists: (id) => existsIn('TmsProject', id) },
  tms_bom_request: { href: (id) => `/tms/bom-requests/${id}`, exists: (id) => existsIn('TmsBomRequest', id) },
  tms_procurement: { href: (id) => `/tms/procurement/${id}`, exists: (id) => existsIn('TmsProcurement', id) },
  tms_task: { href: (id) => `/tms/tasks/${id}`, exists: (id) => existsIn('TmsTask', id) },
  travel_schedule: { href: (id) => `/travel-schedule/${id}`, exists: (id) => existsIn('TravelSchedule', id) },
  lead: { href: () => '/leads', exists: (id) => existsIn('Lead', id) },
  // A batch of leads handed to a rep to call — opens their call queue rather
  // than one of the leads (lib/leadCall.ts, app/api/leads/assign).
  lead_assignment: { href: () => '/leads?filter=to-call', exists: (id) => existsIn('Lead', id) },
  // A card a colleague scanned and handed over (lib/leadHandover.ts) — opens
  // straight onto the recipient's "Assigned To Me" list, where it now sits.
  lead_handover: { href: () => '/leads?filter=assigned-to-me', exists: (id) => existsIn('Lead', id) },
  // Reuses the highlight-and-auto-expand row on My Quotations rather than a
  // dedicated per-quotation page (none exists) — see components/
  // MyQuotationsView.tsx / QuotationTable.tsx.
  quotation: { href: (id) => `/my-quotations?highlight=${id}`, exists: (id) => existsIn('Quotation', id) },
  // One universal detail page for a GeneralTask regardless of source_module
  // (admin- or hr-assigned) — authorization inside the page decides what the
  // viewer (assignee, reviewer, creator, or manager) may see/do.
  general_task: { href: (id) => `/my-tasks/${id}`, exists: (id) => existsIn('GeneralTask', id) },
  leave_request: { href: () => '/hr/leave', exists: (id) => existsIn('LeaveRequest', id) },
  // Both previously had NO resolver entry at all — every "ready for
  // Accounts" notification for these two sources silently resolved to
  // nothing and was filtered out as non-actionable (see
  // resolveActionableNotifications below). Now they open the unified
  // Accounts Payment Queue instead of a per-record page, since that's the
  // real destination for "go pay this" from here on.
  //
  // admin_expense's entity_id is a batch id (Reimbursement.admin_note, a
  // free-text string like "admin-<timestamp>"), not a row's UUID primary
  // key — existsIn's findByPk lookup doesn't apply, so this checks for any
  // row in that batch directly instead.
  admin_expense: {
    href: (id) => `/accounts/payments?highlight=admin_expense:${id}`,
    exists: async (id) => {
      const count = await db.Reimbursement.count({ where: { admin_note: id, is_admin_entry: true } as never });
      return count > 0;
    }
  },
  // A new entry's "ready for Accounts" notice — goes to Accounts staff.
  office_operation_expense: {
    href: () => '/accounts/payments',
    exists: (id) => existsIn('OfficeOperationExpense', id)
  },
  // Hold/resume on an Office Operation Expense monthly SHEET — goes the
  // other way, to the HR/Admin staff who logged its entries, so it opens
  // their own module (they can't reach the Accounts queue). entityId is one
  // of the sheet's entries: notifications.entityId is a UUID column, so the
  // sheet's month key ('2026-09') itself can't be stored there.
  office_expense_sheet: {
    href: () => '/office-operation-expenses',
    exists: (id) => existsIn('OfficeOperationExpense', id)
  }
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
