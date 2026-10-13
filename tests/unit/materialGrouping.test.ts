import { describe, it, expect } from 'vitest';
import { groupByCategory, groupByProduct, GroupableMaterial } from '../../lib/materialGrouping';
import { MATERIAL_CATEGORIES, MaterialCategory } from '../../lib/materialCategories';

function material(overrides: Partial<GroupableMaterial> = {}): GroupableMaterial {
  return {
    id: 'm1',
    product: 'X200',
    category: 'datasheet',
    title: 'X200 Datasheet',
    description: '',
    webViewLink: 'https://drive.google.com/file/d/m1/view',
    isFolder: false,
    fileKind: 'pdf',
    addedBy: 'Khushi',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides
  };
}

describe('groupByProduct', () => {
  it('gives one entry per product — the unit the library is browsed in', () => {
    const groups = groupByProduct([
      material({ id: 'a', product: 'X200' }),
      material({ id: 'b', product: 'X300' }),
      material({ id: 'c', product: 'X200', title: 'X200 Datasheet (Hindi)' })
    ]);

    expect(groups.map((g) => g.product)).toEqual(['X200', 'X300']);
    // Two documents, still one entry — the whole reason grouping exists.
    expect(groups[0].documents.map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('opens a product at its FOLDER when one was given', () => {
    const groups = groupByProduct([
      material({ id: 'a', webViewLink: 'https://drive.google.com/file/d/a/view' }),
      material({ id: 'b', isFolder: true, webViewLink: 'https://drive.google.com/drive/folders/f1' })
    ]);

    // A folder keeps working as documents are added; a file link doesn't.
    expect(groups[0].primaryLink).toBe('https://drive.google.com/drive/folders/f1');
    expect(groups[0].isFolder).toBe(true);
    expect(groups[0].fileKind).toBe('folder');
  });

  it('falls back to the single document when there is no folder', () => {
    const groups = groupByProduct([material({ id: 'a', webViewLink: 'https://drive.google.com/file/d/a/view' })]);

    expect(groups[0].primaryLink).toBe('https://drive.google.com/file/d/a/view');
    expect(groups[0].isFolder).toBe(false);
  });

  it('sorts product codes the way people read them, not byte order', () => {
    // Plain string sort puts X10 before X9 — wrong for product codes.
    const groups = groupByProduct([
      material({ id: 'a', product: 'X10' }),
      material({ id: 'b', product: 'X9' }),
      material({ id: 'c', product: 'X200' })
    ]);

    expect(groups.map((g) => g.product)).toEqual(['X9', 'X10', 'X200']);
  });

  it('is case-insensitive when ordering, so casing does not scatter the list', () => {
    const groups = groupByProduct([
      material({ id: 'a', product: 'zebra' }),
      material({ id: 'b', product: 'Alpha' })
    ]);

    expect(groups.map((g) => g.product)).toEqual(['Alpha', 'zebra']);
  });

  it('reports the freshest change across a product’s documents', () => {
    const groups = groupByProduct([
      material({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
      material({ id: 'b', updatedAt: '2026-06-01T00:00:00.000Z' })
    ]);

    expect(groups[0].updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('surfaces the first description written for a product', () => {
    const groups = groupByProduct([
      material({ id: 'a', description: '' }),
      material({ id: 'b', description: 'For tender submissions' })
    ]);

    expect(groups[0].description).toBe('For tender submissions');
  });

  it('handles an empty library without inventing groups', () => {
    expect(groupByProduct([])).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('groups every category by product', () => {
    const groups = groupByCategory(
      [
        material({ id: 'a', category: 'datasheet', product: 'X200' }),
        material({ id: 'b', category: 'datasheet', product: 'X300' }),
        material({ id: 'c', category: 'case_study', product: 'Reliance' })
      ],
      MATERIAL_CATEGORIES
    );

    expect(groups.map((g) => g.category)).toEqual(['datasheet', 'case_study']);
    expect(groups[0].products.map((p) => p.product)).toEqual(['X200', 'X300']);
    expect(groups[1].products.map((p) => p.product)).toEqual(['Reliance']);
  });

  it('keeps the declared category order, Datasheet and Case Study first', () => {
    const groups = groupByCategory(
      [
        material({ id: 'a', category: 'certificate', product: 'ISO 9001' }),
        material({ id: 'b', category: 'case_study', product: 'Reliance' }),
        material({ id: 'c', category: 'datasheet', product: 'X200' })
      ],
      MATERIAL_CATEGORIES
    );

    expect(groups.map((g) => g.category)).toEqual(['datasheet', 'case_study', 'certificate']);
  });

  it('keeps the same product name in two categories apart', () => {
    // X200 has both a datasheet and a case study — two entries, not one.
    const groups = groupByCategory(
      [
        material({ id: 'a', category: 'datasheet', product: 'X200' }),
        material({ id: 'b', category: 'case_study', product: 'X200' })
      ],
      MATERIAL_CATEGORIES
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].products[0].documents).toHaveLength(1);
    expect(groups[1].products[0].documents).toHaveLength(1);
  });

  it('omits categories with nothing in them', () => {
    const groups = groupByCategory([material({ category: 'datasheet' })], MATERIAL_CATEGORIES);

    expect(groups).toHaveLength(1);
    expect(groups.map((g) => g.category)).not.toContain('brochure');
  });

  it('counts documents as well as products, since one product holds several', () => {
    const groups = groupByCategory(
      [
        material({ id: 'a', product: 'X200' }),
        material({ id: 'b', product: 'X200', title: 'Hindi' }),
        material({ id: 'c', product: 'X300' })
      ],
      MATERIAL_CATEGORIES
    );

    expect(groups[0].products).toHaveLength(2);
    expect(groups[0].documentCount).toBe(3);
  });

  it('handles an empty library without inventing groups', () => {
    expect(groupByCategory([], MATERIAL_CATEGORIES)).toEqual([]);
  });

  it('covers every declared category — none can silently fail to render', () => {
    const everyCategory = MATERIAL_CATEGORIES.map((category: MaterialCategory, index) =>
      material({ id: `m${index}`, category, product: `P${index}` })
    );

    const groups = groupByCategory(everyCategory, MATERIAL_CATEGORIES);

    expect(groups).toHaveLength(MATERIAL_CATEGORIES.length);
    for (const group of groups) expect(group.products).toHaveLength(1);
  });
});
