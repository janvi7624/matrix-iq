import {
  FileText, FileSpreadsheet, Presentation, Image as ImageIcon, Video, FileArchive,
  FolderOpen, Award, Building2, Layers, ExternalLink,
  type LucideIcon
} from 'lucide-react';
import type { MaterialCategory, MaterialFileKind } from '@/lib/materialCategories';

// The Materials library's visual vocabulary, shared by the internal library
// (components/MaterialsView.tsx) and the partner-facing one
// (components/PartnerMaterialsView.tsx).
//
// Extracted so the two stay identical by construction. They were the same
// maps copied once; the moment a category or file kind is added, a copy is a
// pair of screens that disagree about what a datasheet looks like.

export const KIND_ICON: Record<MaterialFileKind, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slide: Presentation,
  image: ImageIcon,
  video: Video,
  archive: FileArchive,
  folder: FolderOpen,
  file: FileText,
  // Says "this one leaves MatrixIQ" at a glance, which a document icon would
  // not — a web page titled "X200 spec.pdf" would otherwise wear a PDF mark.
  link: ExternalLink
};

// A category reads faster with a mark beside it than as text alone — and the
// same icon then identifies it in the tab, the heading and the add form.
export const CATEGORY_ICON: Record<MaterialCategory, LucideIcon> = {
  datasheet: FileText,
  case_study: Award,
  company_profile: Building2,
  brochure: FileArchive,
  presentation: Presentation,
  certificate: Award,
  video: Video,
  other: Layers
};

export function formatWhen(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
