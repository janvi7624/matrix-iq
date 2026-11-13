import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { LineItem, ProductManagerNoteRecord, ProductManagerNoteType, ProductManagerRollup, ProductRecord } from './types';
import { listProducts } from './productStore';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

// A quotation's own status drives which bucket its linked line items land
// in — draft/sent haven't been decided yet, so both count as still "in
// play" for the Product Manager rather than splitting them further.
function bucketForStatus(status: string): 'pending' | 'won' | 'lost' | null {
  if (status === 'approved') return 'won';
  if (status === 'rejected') return 'lost';
  if (status === 'draft' || status === 'sent') return 'pending';
  return null;
}

interface ProductManagerAmounts {
  pending: number;
  won: number;
  lost: number;
}

// The actual shape QuotationCalculator.tsx's buildQuotationPayload persists
// into Quotation.products_json — {label, lineItems, remark}[], NOT the
// client-side ProductGroup type (which only holds start/end indices into a
// separate lineItems array before serialization).
interface PersistedProductGroup {
  label: string;
  lineItems: LineItem[];
  remark?: string;
}

// Scans every quotation's persisted products_json for line items that carry
// a productId (set only when that line was added via "+ Add from catalog",
// see CustomProductsList/composeQuote), and sums each by the status bucket
// of the quotation it's sitting in. Reading every quotation like this is
// the same trade this codebase already makes elsewhere for JSONB-backed
// aggregates (e.g. festivalStore, feedbackStore) — acceptable at this
// data volume; a normalized child table would be the fix if that changes.
async function sumAmountsByProductId(): Promise<Map<string, ProductManagerAmounts>> {
  const rows = await db.Quotation.findAll({ attributes: ['status', 'products_json'] });
  const totals = new Map<string, ProductManagerAmounts>();

  for (const row of rows) {
    const plain = row.get({ plain: true }) as { status: string; products_json: PersistedProductGroup[] | null };
    const bucket = bucketForStatus(plain.status);
    if (!bucket) continue;
    const groups = Array.isArray(plain.products_json) ? plain.products_json : [];
    for (const group of groups) {
      for (const item of group.lineItems || []) {
        if (!item.productId) continue;
        const entry = totals.get(item.productId) ?? { pending: 0, won: 0, lost: 0 };
        entry[bucket] += Number(item.amount) || 0;
        totals.set(item.productId, entry);
      }
    }
  }
  return totals;
}

/** Every product this user manages — explicit Product.managerId assignment, falling back to the creator when none was ever set. */
export async function listMyProducts(userId: string): Promise<ProductRecord[]> {
  const all = await listProducts();
  return all.filter((p) => p.manager_id === userId);
}

export async function getProductManagerRollup(userId: string): Promise<ProductManagerRollup | null> {
  if (!isUuid(userId)) return null;
  const user = await db.User.findByPk(userId, { attributes: ['id', 'username', 'name'] });
  if (!user) return null;

  const myProducts = await listMyProducts(userId);
  const amountsByProductId = await sumAmountsByProductId();

  let pending = 0;
  let won = 0;
  let lost = 0;
  for (const p of myProducts) {
    const amounts = amountsByProductId.get(p.id);
    if (!amounts) continue;
    pending += amounts.pending;
    won += amounts.won;
    lost += amounts.lost;
  }

  const plain = user.get({ plain: true }) as { id: string; username: string; name: string };
  return {
    pm_id: plain.id,
    pm_username: plain.username,
    pm_name: plain.name || plain.username,
    product_count: myProducts.length,
    pending_value: pending,
    won_value: won,
    lost_value: lost
  };
}

/** Admin/Superadmin overview — one rollup row per person who manages at least one product (explicit assignment, or by having created one). */
export async function listAllProductManagerRollups(): Promise<ProductManagerRollup[]> {
  const products = await listProducts();
  const managerIds = Array.from(new Set(products.map((p) => p.manager_id).filter((id): id is string => Boolean(id))));

  const rollups = await Promise.all(managerIds.map((id) => getProductManagerRollup(id)));
  return rollups.filter((r): r is ProductManagerRollup => Boolean(r)).sort((a, b) => b.pending_value + b.won_value - (a.pending_value + a.won_value));
}

const authorInclude = { model: db.User, as: 'author', attributes: ['id', 'username', 'name'] };

function toNoteRecord(row: Model): ProductManagerNoteRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const author = plain.author as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    product_manager_id: plain.product_manager_id as string,
    type: plain.type as ProductManagerNoteType,
    text: (plain.text as string) ?? '',
    created_at: isoOrEmpty(plain.created_at),
    created_by: author?.name || author?.username || ''
  };
}

/** A Product Manager's own running timeline — feedback they received, actions taken, what's planned next. Newest first. */
export async function listProductManagerNotes(productManagerId: string): Promise<ProductManagerNoteRecord[]> {
  if (!isUuid(productManagerId)) return [];
  const rows = await db.ProductManagerNote.findAll({
    where: { product_manager_id: productManagerId } as never,
    include: [authorInclude],
    order: [['created_at', 'DESC']]
  });
  return rows.map(toNoteRecord);
}

export async function addProductManagerNote(productManagerId: string, type: ProductManagerNoteType, text: string, createdBy: string): Promise<ProductManagerNoteRecord> {
  const row = await db.ProductManagerNote.create({
    product_manager_id: productManagerId,
    type,
    text,
    created_by: isUuid(createdBy) ? createdBy : null
  } as never);
  const full = await db.ProductManagerNote.findByPk(row.get('id') as string, { include: [authorInclude] });
  return toNoteRecord(full as Model);
}
