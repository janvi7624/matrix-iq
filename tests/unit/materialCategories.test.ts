import { describe, it, expect } from 'vitest';
import {
  fileKindFromMime,
  isMaterialCategory,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_HINT,
  MATERIAL_CATEGORY_LABEL
} from '../../lib/materialCategories';

describe('categories', () => {
  it('leads with Datasheet and Case Study — what people come here for', () => {
    expect(MATERIAL_CATEGORIES[0]).toBe('datasheet');
    expect(MATERIAL_CATEGORIES[1]).toBe('case_study');
  });

  it('labels and explains every category — a tab can never render blank', () => {
    for (const category of MATERIAL_CATEGORIES) {
      expect(MATERIAL_CATEGORY_LABEL[category]).toBeTruthy();
      expect(MATERIAL_CATEGORY_HINT[category]).toBeTruthy();
    }
  });

  it('accepts every category and rejects anything else', () => {
    for (const category of MATERIAL_CATEGORIES) expect(isMaterialCategory(category)).toBe(true);
    expect(isMaterialCategory('datasheets')).toBe(false);
    expect(isMaterialCategory('')).toBe(false);
    expect(isMaterialCategory(undefined)).toBe(false);
    expect(isMaterialCategory(7)).toBe(false);
  });
});

describe('fileKindFromMime', () => {
  // Nothing reads the file any more, so the icon comes from the typed name —
  // which makes the extension path the one that actually runs.
  it('recognises a document by its extension', () => {
    expect(fileKindFromMime('', 'X200-Datasheet.pdf')).toBe('pdf');
    expect(fileKindFromMime('', 'Deck.pptx')).toBe('slide');
    expect(fileKindFromMime('', 'Pricing.xlsx')).toBe('sheet');
    expect(fileKindFromMime('', 'Letter.docx')).toBe('doc');
    expect(fileKindFromMime('', 'Demo.mp4')).toBe('video');
    expect(fileKindFromMime('', 'Hero.png')).toBe('image');
    expect(fileKindFromMime('', 'Bundle.zip')).toBe('archive');
  });

  it('still reads a mime type when one is given', () => {
    expect(fileKindFromMime('application/pdf')).toBe('pdf');
    expect(fileKindFromMime('video/mp4')).toBe('video');
    expect(fileKindFromMime('application/vnd.google-apps.presentation')).toBe('slide');
  });

  it('falls back to a usable kind for a name with no extension', () => {
    // A product name typed as the document name — the common case, since
    // nobody is obliged to include a file extension.
    expect(fileKindFromMime('', 'Allbotix X200')).toBe('file');
    expect(fileKindFromMime('', '')).toBe('file');
  });
});
