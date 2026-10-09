// Material categories — the tabs on the Material library, and the choice
// Marketing makes when adding one.
//
// Pure string/lookup work, no DB access, so the API and the UI classify
// identically.

// Order matters: it's the order the tabs appear in, and Datasheet and Case
// Study lead because they're what people come here for.
export const MATERIAL_CATEGORIES = [
  'datasheet',
  'case_study',
  'company_profile',
  'brochure',
  'presentation',
  'certificate',
  'video',
  'other'
] as const;

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export const MATERIAL_CATEGORY_LABEL: Record<MaterialCategory, string> = {
  datasheet: 'Datasheet',
  case_study: 'Case Study',
  company_profile: 'Company Profile',
  brochure: 'Brochure',
  presentation: 'Presentation',
  certificate: 'Certificate',
  video: 'Video & Images',
  other: 'Other'
};

// Shown under a category's heading, and as the hint in the add form. Says
// what belongs in the category, so two people filing the same document
// choose the same place for it.
export const MATERIAL_CATEGORY_HINT: Record<MaterialCategory, string> = {
  datasheet: 'Technical specifications, one per product.',
  case_study: 'Installations and success stories, by client or site.',
  company_profile: 'Who we are — the corporate profile and overview decks.',
  brochure: 'Product brochures, catalogues and leaflets.',
  presentation: 'Pitch decks and presentations used in client meetings.',
  certificate: 'ISO, CE, test reports and approvals — what tenders ask for.',
  video: 'Product videos, demo recordings and photography.',
  other: 'Anything that doesn’t fit the categories above.'
};

export function isMaterialCategory(value: unknown): value is MaterialCategory {
  return typeof value === 'string' && (MATERIAL_CATEGORIES as readonly string[]).includes(value);
}

// A rough "what kind of document is this" for the UI's icon. With no Drive
// API in the picture nothing reads the file, so this works off the name the
// person typed — which is why a wrong guess has to be harmless: it only ever
// picks an icon.
export type MaterialFileKind = 'pdf' | 'doc' | 'sheet' | 'slide' | 'image' | 'video' | 'archive' | 'folder' | 'file';

export function fileKindFromMime(mimeType: string, fileName = ''): MaterialFileKind {
  const mime = (mimeType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/.test(name)) return 'video';
  if (mime.includes('presentation') || mime.includes('powerpoint') || /\.pptx?$/.test(name)) return 'slide';
  if (mime.includes('spreadsheet') || mime.includes('excel') || /\.xlsx?$/.test(name) || name.endsWith('.csv')) return 'sheet';
  if (mime.includes('document') || mime.includes('msword') || /\.docx?$/.test(name)) return 'doc';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('compressed') || /\.(zip|rar|7z)$/.test(name)) return 'archive';
  return 'file';
}
