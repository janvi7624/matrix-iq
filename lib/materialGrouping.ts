import { MaterialCategory, MaterialFileKind } from './materialCategories';

// Turns the flat `materials` rows into what the library shows: one entry per
// PRODUCT, each with its own link —
//
//   Datasheet
//     Allbotix X200   → drive link
//     Allbotix X300   → drive link
//
// A product with more than one document (an English and a Hindi datasheet,
// say) is still ONE entry, with its documents listed underneath. That's the
// whole reason grouping exists rather than just listing rows.
//
// Pure: no DB. The API shapes its response with this and the tests exercise
// it directly.

// The subset of MaterialRecord this needs, declared structurally rather than
// imported, so grouping stays testable without the store — and therefore
// without the database.
export interface GroupableMaterial {
  id: string;
  product: string;
  category: MaterialCategory;
  title: string;
  description: string;
  webViewLink: string;
  isFolder: boolean;
  fileKind: MaterialFileKind;
  addedBy: string;
  updatedAt: string;
}

export interface ProductGroup {
  product: string;
  // Where the product's "Open" goes: its Drive FOLDER if one was given,
  // otherwise its single document. A folder wins even against several files,
  // because it's the one link that keeps working as documents are added.
  primaryLink: string;
  isFolder: boolean;
  documents: GroupableMaterial[];
  // The first description written for the product, so the row can carry a
  // line of explanation without a second place to store one.
  description: string;
  updatedAt: string;
  fileKind: MaterialFileKind;
}

export interface CategoryGroup {
  category: MaterialCategory;
  products: ProductGroup[];
  documentCount: number;
}

function newestOf(documents: GroupableMaterial[]): string {
  return documents.reduce((latest, d) => (d.updatedAt > latest ? d.updatedAt : latest), '');
}

// localeCompare with numeric:true keeps "X9" before "X10", which plain
// string order gets backwards — and product codes are exactly where that
// shows up.
function byProductName(a: ProductGroup, b: ProductGroup): number {
  return a.product.localeCompare(b.product, 'en', { numeric: true, sensitivity: 'base' });
}

export function groupByProduct(materials: GroupableMaterial[]): ProductGroup[] {
  const byProduct = new Map<string, GroupableMaterial[]>();
  for (const material of materials) {
    const key = material.product;
    const list = byProduct.get(key);
    if (list) list.push(material);
    else byProduct.set(key, [material]);
  }

  const groups: ProductGroup[] = [];
  for (const [product, documents] of byProduct) {
    const folder = documents.find((d) => d.isFolder);
    groups.push({
      product,
      primaryLink: folder?.webViewLink || documents[0]?.webViewLink || '',
      isFolder: Boolean(folder),
      documents,
      description: documents.find((d) => d.description)?.description ?? '',
      updatedAt: newestOf(documents),
      fileKind: folder ? 'folder' : documents[0]?.fileKind ?? 'file'
    });
  }

  return groups.sort(byProductName);
}

// Categories keep MATERIAL_CATEGORIES order (Datasheet and Case Study first)
// rather than being re-sorted here — the caller passes them in that order.
export function groupByCategory(materials: GroupableMaterial[], categories: readonly MaterialCategory[]): CategoryGroup[] {
  const out: CategoryGroup[] = [];

  for (const category of categories) {
    const inCategory = materials.filter((m) => m.category === category);
    if (!inCategory.length) continue;
    out.push({ category, products: groupByProduct(inCategory), documentCount: inCategory.length });
  }

  return out;
}
